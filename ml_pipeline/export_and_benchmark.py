"""ONNX export, recall gate, CPU benchmark and gated deploy for AGOS-Offline.

Flow: (optional) export best.pt -> check the single-class contract -> evaluate on the held-out
public validation split with the production inference code -> gate -> CPU benchmark -> deploy.

`backend/app/ml/weights/best.onnx` is only ever replaced when `--deploy` is given AND the gate
passes (box recall >= --min-recall, negative false-positive rate <= --max-neg-fp-rate, and at
least --min-neg-images negative validation images). A failed gate exits with code 2 and leaves
the production weights untouched. Results are "validated on public data only".
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import logging
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("export_and_benchmark")

REPO_ROOT = Path(__file__).resolve().parents[1]
PROD_WEIGHTS = REPO_ROOT / "backend" / "app" / "ml" / "weights" / "best.onnx"
EXIT_GATE_FAILED = 2
EXPECTED_INPUT = [1, 3, 640, 640]
EXPECTED_OUTPUT = [1, 5, 8400]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_to_onnx(pt_path: Path, imgsz: int = 640, opset: int = 12, simplify: bool = True) -> Path:
    """Export PyTorch YOLOv8 weights to ONNX format."""
    pt_path = pt_path.resolve()
    if not pt_path.exists():
        raise FileNotFoundError(f"PyTorch weights not found at: {pt_path}")

    from ultralytics import YOLO

    logger.info("Exporting %s to ONNX (imgsz=%d, opset=%d)...", pt_path, imgsz, opset)
    exported = YOLO(str(pt_path)).export(format="onnx", imgsz=imgsz, opset=opset, simplify=simplify, dynamic=False)
    return Path(exported).resolve()


def check_contract(onnx_path: Path) -> list[str]:
    """Return a list of contract violations (empty when the model is a single-class [1,5,8400] detector)."""
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    problems = []
    in_shape, out_shape = list(session.get_inputs()[0].shape), list(session.get_outputs()[0].shape)
    if in_shape != EXPECTED_INPUT:
        problems.append(f"input shape {in_shape} != {EXPECTED_INPUT}")
    if out_shape != EXPECTED_OUTPUT:
        problems.append(f"output shape {out_shape} != {EXPECTED_OUTPUT}")
    names = session.get_modelmeta().custom_metadata_map.get("names")
    if names is not None:
        try:
            parsed = eval_names(names)
        except ValueError:
            parsed = None
        if parsed is None or list(parsed.values()) != ["debris"]:
            problems.append(f"class names {names!r} != {{0: 'debris'}}")
    return problems


def eval_names(text: str) -> dict[int, str]:
    """Parse the Ultralytics names metadata ("{0: 'debris'}") without eval()."""
    import ast

    try:
        value = ast.literal_eval(text)
    except (ValueError, SyntaxError) as exc:
        raise ValueError(text) from exc
    if not isinstance(value, dict):
        raise ValueError(text)
    return {int(k): str(v) for k, v in value.items()}


def benchmark_cpu(onnx_path: Path, image: np.ndarray, iterations: int = 50, warmup: int = 5) -> dict[str, Any]:
    """Time raw ONNX Runtime CPU inference (4 intra-op threads) on a real validation image."""
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.intra_op_num_threads = 4
    session = ort.InferenceSession(str(onnx_path), sess_options=opts, providers=["CPUExecutionProvider"])
    in_name = session.get_inputs()[0].name
    blob = cv2.dnn.blobFromImage(image, 1 / 255.0, (640, 640), swapRB=True, crop=False).astype(np.float32)
    for _ in range(warmup):
        session.run(None, {in_name: blob})
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        session.run(None, {in_name: blob})
        times.append((time.perf_counter() - t0) * 1000.0)
    mean_ms = float(np.mean(times))
    return {
        "mean_latency_ms": round(mean_ms, 2),
        "p95_latency_ms": round(float(np.percentile(times, 95)), 2),
        "effective_cpu_fps": round(1000.0 / mean_ms, 1) if mean_ms > 0 else 0.0,
        "iterations": iterations,
        "intra_op_threads": 4,
        "model_size_mb": round(onnx_path.stat().st_size / (1024 * 1024), 2),
    }


def apply_gate(metrics: dict[str, Any], min_recall: float, max_neg_fp: float, min_neg: int) -> list[str]:
    """Return the reasons the gate fails (empty list == pass)."""
    reasons = []
    if metrics["negative_images"] < min_neg:
        reasons.append(f"only {metrics['negative_images']} negative val images (< {min_neg})")
    if metrics["box_recall"] < min_recall:
        reasons.append(f"box recall {metrics['box_recall']:.4f} < {min_recall}")
    if metrics["negative_fp_rate"] > max_neg_fp:
        reasons.append(f"negative FP rate {metrics['negative_fp_rate']:.4f} > {max_neg_fp}")
    return reasons


def deploy_weights(onnx_path: Path, report: dict[str, Any], training_source: str, prod: Path = PROD_WEIGHTS) -> dict[str, Any]:
    """Back up current production weights, copy the new ones and write the sidecar."""
    prod.parent.mkdir(parents=True, exist_ok=True)
    if prod.exists():
        backup = prod.parent / f"best.previous.{sha256_of(prod)[:8]}.onnx"
        shutil.copy2(prod, backup)
        logger.info("Backed up current weights to %s", backup.name)
    if onnx_path.resolve() != prod.resolve():
        shutil.copy2(onnx_path, prod)
    digest = sha256_of(prod)
    sidecar = {
        "model_version": f"debris-yolov8n-{dt.date.today():%Y%m%d}-{digest[:8]}",
        "sha256": digest,
        "size_bytes": prod.stat().st_size,
        "training_source": training_source,
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "license": "AGPL-3.0 (Ultralytics YOLOv8)",
        "validated_on": "public data only",
        "metrics": {k: report["metrics"][k] for k in ("box_recall", "box_precision", "image_recall", "negative_fp_rate",
                                                     "positive_images", "negative_images")},
    }
    prod.with_name(prod.name + ".json").write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    logger.info("Deployed %s (%s)", prod, sidecar["model_version"])
    return sidecar


def write_reports(report: dict[str, Any], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "gate_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    m = report["metrics"]
    lines = [
        "# Export gate report", "", "Validated on public data only.", "",
        f"- Weights: `{report['weights']}` (SHA-256 `{report['sha256']}`)",
        f"- Positive val images: {m['positive_images']}, negative val images: {m['negative_images']}",
        f"- Box recall @IoU0.5: {m['box_recall']:.4f}",
        f"- Box precision: {m['box_precision']:.4f}",
        f"- Image recall: {m['image_recall']:.4f}",
        f"- Negative FP rate: {m['negative_fp_rate']:.4f}",
        f"- Gate: {'PASS' if report['gate_passed'] else 'FAIL'}",
    ]
    lines += [f"  - {r}" for r in report["gate_failures"]]
    if report.get("benchmark"):
        b = report["benchmark"]
        lines += ["", f"CPU benchmark ({b['intra_op_threads']} threads, {b['iterations']} runs): "
                      f"{b['mean_latency_ms']} ms mean, {b['p95_latency_ms']} ms p95, {b['effective_cpu_fps']} FPS"]
    (out_dir / "gate_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description="Export YOLOv8 to ONNX, gate on recall, benchmark CPU, optionally deploy")
    p.add_argument("--weights", default="ml_pipeline/runs/debris_yolov8n/weights/best.pt", help="best.pt or an .onnx file")
    p.add_argument("--dataset", default="ml_pipeline/dataset_public", help="Dataset root with data.yaml and manifest.json")
    p.add_argument("--images-dir", default=None, help="Override validation images dir (default <dataset>/images/val)")
    p.add_argument("--labels-dir", default=None, help="Override validation labels dir (default <dataset>/labels/val)")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--iterations", type=int, default=50)
    p.add_argument("--min-recall", type=float, default=0.80)
    p.add_argument("--max-neg-fp-rate", type=float, default=0.10)
    p.add_argument("--min-neg-images", type=int, default=20)
    p.add_argument("--deploy", action="store_true", help="Replace production best.onnx (only if the gate passes)")
    p.add_argument("--allow-synthetic", action="store_true", help="Allow a synthetic dataset (smoke test only, never deploys)")
    p.add_argument("--report-dir", default="ml_pipeline/runs/gate")
    args = p.parse_args()

    dataset = Path(args.dataset)
    manifest_path = dataset / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    if manifest.get("synthetic") and not args.allow_synthetic:
        logger.error("%s is marked synthetic; refusing. Use --allow-synthetic for a smoke test.", manifest_path)
        return EXIT_GATE_FAILED
    if manifest.get("synthetic") and args.deploy:
        logger.error("Synthetic datasets can never be used to deploy.")
        return EXIT_GATE_FAILED

    images_dir = Path(args.images_dir) if args.images_dir else dataset / "images" / "val"
    labels_dir = Path(args.labels_dir) if args.labels_dir else dataset / "labels" / "val"
    if not images_dir.is_dir():
        logger.error("Validation images not found at %s; cannot evaluate, refusing.", images_dir)
        return EXIT_GATE_FAILED

    target = Path(args.weights)
    if not target.exists():
        logger.error("Weights not found: %s", target)
        return EXIT_GATE_FAILED
    onnx_file = export_to_onnx(target, imgsz=args.imgsz) if target.suffix == ".pt" else target.resolve()

    problems = check_contract(onnx_file)
    if problems:
        logger.error("Contract violations: %s", "; ".join(problems))
        return EXIT_GATE_FAILED

    metrics = evaluate.evaluate_onnx(onnx_file, images_dir, labels_dir)
    failures = apply_gate(metrics, args.min_recall, args.max_neg_fp_rate, args.min_neg_images)
    first_img = next((q for q in sorted(images_dir.iterdir()) if q.suffix.lower() in evaluate.IMAGE_EXTS), None)
    benchmark = benchmark_cpu(onnx_file, cv2.imread(str(first_img)), args.iterations) if first_img else None

    report = {
        "weights": onnx_file.name, "sha256": sha256_of(onnx_file), "metrics": metrics,
        "gate": {"min_recall": args.min_recall, "max_neg_fp_rate": args.max_neg_fp_rate, "min_neg_images": args.min_neg_images},
        "gate_passed": not failures, "gate_failures": failures, "benchmark": benchmark,
        "validated_on": "public data only",
    }
    write_reports(report, Path(args.report_dir))
    logger.info("recall=%.4f neg_fp=%.4f pos=%d neg=%d gate=%s", metrics["box_recall"], metrics["negative_fp_rate"],
                metrics["positive_images"], metrics["negative_images"], "PASS" if not failures else "FAIL")

    if failures:
        logger.error("Gate FAILED: %s. Production weights untouched.", "; ".join(failures))
        return EXIT_GATE_FAILED
    if args.deploy:
        sources = ", ".join(s["name"] for s in manifest.get("sources", [])) or "unknown"
        deploy_weights(onnx_file, report, f"public datasets: {sources}")
    else:
        logger.info("Gate passed. Re-run with --deploy to replace production weights.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
