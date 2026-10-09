"""ONNX export, coverage gate, CPU benchmark and gated deploy for AGOS-Offline.

Flow: (optional) export best.pt -> check the single-class contract -> measure, on the validation
split of --data, the full-frame width coverage implied by the labels (true) and by the model
detections (predicted, production inference code and production coverage formula) -> gate ->
CPU benchmark -> deploy.

The gate PASSES only when at least --min-within-fraction of the positive images have a coverage
error <= --max-coverage-error points AND no more than --max-neg-fp-rate of the clean negative
images show coverage >= 20 (the warning threshold). With fewer than --min-neg-images negatives
the negative check fails closed unless --allow-no-negatives is given (then the result is marked
"negatives not checked"). `backend/app/ml/weights/best.onnx` is only replaced when `--deploy` is
given AND the gate passes; a failed gate exits with code 2. Results are "validated on public data only".

Explicit override: `--deploy --override-gate "<reason>"` deploys even when the gate FAILS. It is loud and
recorded (warning log, `gate_report.json/.md`, sidecar fields gate_passed=false, gate_overridden=true,
override_reason, gate_failures, and a `-gate-overridden` model_version suffix). Thresholds never change;
without the override a failing gate still exits 2 and leaves the production weights untouched.
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


def apply_gate(
    metrics: dict[str, Any],
    min_within_fraction: float = 0.80,
    max_neg_fp_rate: float = 0.10,
    min_neg_images: int = 20,
    allow_no_negatives: bool = False,
) -> dict[str, Any]:
    """Pure gate decision from `evaluate.summarize_coverage` metrics.

    Returns {"passed", "failures", "negatives_checked", "note"}; an empty failures list means pass.
    """
    failures = []
    if metrics["positive_images"] == 0:
        failures.append("no positive validation images; coverage error cannot be measured")
    elif metrics["within_fraction"] < min_within_fraction:
        failures.append(f"only {metrics['within_fraction']:.1%} of positive images within "
                        f"{metrics['max_coverage_error']} points (< {min_within_fraction:.0%})")
    negatives_checked = metrics["negative_images"] >= min_neg_images
    note = ""
    if negatives_checked:
        if metrics["negative_fp_rate"] > max_neg_fp_rate:
            failures.append(f"negative false-coverage rate {metrics['negative_fp_rate']:.1%} "
                            f"> {max_neg_fp_rate:.0%}")
    elif allow_no_negatives:
        note = (f"negatives not checked: only {metrics['negative_images']} negative val images "
                f"(< {min_neg_images}); --allow-no-negatives given")
    else:
        failures.append(f"only {metrics['negative_images']} negative val images (< {min_neg_images}); "
                        "negative check fails closed (use --allow-no-negatives to override)")
    return {"passed": not failures, "failures": failures, "negatives_checked": negatives_checked, "note": note}


SIDECAR_METRICS = ("median_abs_error", "p90_abs_error", "within_fraction", "max_coverage_error",
                   "negative_fp_rate", "status_agreement", "positive_images", "negative_images")


OVERRIDE_SUFFIX = "-gate-overridden"


def non_empty_reason(text: str) -> str:
    """argparse type for --override-gate: a blank reason is not an acceptable audit trail."""
    if not text.strip():
        raise argparse.ArgumentTypeError("override reason must be a non-empty string")
    return text.strip()


def deploy_weights(onnx_path: Path, report: dict[str, Any], training_source: str, prod: Path = PROD_WEIGHTS) -> dict[str, Any]:
    """Back up current production weights, copy the new ones and write the sidecar.

    When report["gate_overridden"] is true the sidecar records the failed gate and the override reason.
    """
    prod.parent.mkdir(parents=True, exist_ok=True)
    if prod.exists():
        backup = prod.parent / f"best.previous.{sha256_of(prod)[:8]}.onnx"
        shutil.copy2(prod, backup)
        logger.info("Backed up current weights to %s", backup.name)
    if onnx_path.resolve() != prod.resolve():
        shutil.copy2(onnx_path, prod)
    digest = sha256_of(prod)
    overridden = bool(report.get("gate_overridden"))
    suffix = OVERRIDE_SUFFIX if overridden else ""
    sidecar = {
        "model_version": f"debris-yolov8n-{dt.date.today():%Y%m%d}-{digest[:8]}{suffix}",
        "sha256": digest,
        "size_bytes": prod.stat().st_size,
        "training_source": training_source,
        "trained_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "license": "AGPL-3.0 (Ultralytics YOLOv8)",
        "validated_on": "public data only",
        "metrics": {k: report["metrics"][k] for k in SIDECAR_METRICS},
        "negatives_checked": report["negatives_checked"],
        "gate_note": report["gate_note"],
        "gate_passed": report["gate_passed"],
        "gate_overridden": overridden,
        "override_reason": report.get("override_reason") if overridden else None,
        "gate_failures": list(report["gate_failures"]),
    }
    prod.with_name(prod.name + ".json").write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    logger.info("Deployed %s (%s)", prod, sidecar["model_version"])
    return sidecar


def write_reports(report: dict[str, Any], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "gate_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    m = report["metrics"]
    g = report["gate"]
    lines = [
        "# Export gate report", "", "Validated on public data only.", "",
        f"- Weights: `{report['weights']}` (SHA-256 `{report['sha256']}`)",
        f"- Positive val images: {m['positive_images']}, negative val images: {m['negative_images']}",
        f"- Coverage error (positives): median {m['median_abs_error']} pts, p90 {m['p90_abs_error']} pts",
        f"- Within {g['max_coverage_error']} points: {m['within_fraction']:.1%} (need >= {g['min_within_fraction']:.0%})",
        f"- Negative false-coverage rate (>= 20%): {m['negative_fp_rate']:.1%} (max {g['max_neg_fp_rate']:.0%})",
        f"- Status agreement (clear/partial/blocked, informational): {m['status_agreement']:.1%}",
        f"- Gate: {'PASS' if report['gate_passed'] else 'FAIL'}",
    ]
    if report.get("gate_overridden"):
        lines.insert(3, "**GATE OVERRIDDEN: these weights were deployed although the coverage gate FAILED.**")
        lines.insert(4, "")
    lines += [f"  - {r}" for r in report["gate_failures"]]
    if report["gate_note"]:
        lines.append(f"  - {report['gate_note']}")
    if report.get("gate_overridden"):
        lines.append(f"- OVERRIDDEN by user: {report['override_reason']}")
    if report.get("benchmark"):
        b = report["benchmark"]
        lines += ["", f"CPU benchmark ({b['intra_op_threads']} threads, {b['iterations']} runs): "
                      f"{b['mean_latency_ms']} ms mean, {b['p95_latency_ms']} ms p95, {b['effective_cpu_fps']} FPS"]
    (out_dir / "gate_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Export YOLOv8 to ONNX, gate on coverage error, benchmark CPU, optionally deploy")
    p.add_argument("--weights", default="ml_pipeline/runs/debris_yolov8n/weights/best.pt", help="best.pt or an .onnx file")
    p.add_argument("--data", default="ml_pipeline/dataset_quick/data.yaml", help="Ultralytics data.yaml; its val split is used")
    p.add_argument("--images-dir", default=None, help="Override validation images dir (default from --data)")
    p.add_argument("--labels-dir", default=None, help="Override validation labels dir (default from --data)")
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--iterations", type=int, default=50)
    p.add_argument("--max-coverage-error", type=float, default=15.0, help="Tolerated |predicted - true| coverage, in points")
    p.add_argument("--min-within-fraction", type=float, default=0.80, help="Fraction of positive images that must be within tolerance")
    p.add_argument("--max-neg-fp-rate", type=float, default=0.10)
    p.add_argument("--min-neg-images", type=int, default=20)
    p.add_argument("--allow-no-negatives", action="store_true",
                   help="Pass without a negative check when too few negatives exist (flagged 'negatives not checked')")
    p.add_argument("--deploy", action="store_true", help="Replace production best.onnx (only if the gate passes)")
    p.add_argument("--override-gate", metavar="REASON", type=non_empty_reason, default=None,
                   help="With --deploy, deploy even though the gate FAILS; REASON is recorded in the sidecar and reports")
    p.add_argument("--allow-synthetic", action="store_true", help="Allow a synthetic dataset (smoke test only, never deploys)")
    p.add_argument("--report-dir", default="ml_pipeline/runs/gate")
    args = p.parse_args(argv)

    data_yaml = Path(args.data)
    if not data_yaml.is_file():
        logger.error("data.yaml not found at %s; refusing.", data_yaml)
        return EXIT_GATE_FAILED
    images_dir, labels_dir = evaluate.resolve_val_dirs(data_yaml)
    images_dir = Path(args.images_dir) if args.images_dir else images_dir
    labels_dir = Path(args.labels_dir) if args.labels_dir else labels_dir
    manifest_path = data_yaml.parent / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
    if manifest.get("synthetic") and not args.allow_synthetic:
        logger.error("%s is marked synthetic; refusing. Use --allow-synthetic for a smoke test.", manifest_path)
        return EXIT_GATE_FAILED
    if manifest.get("synthetic") and args.deploy:
        logger.error("Synthetic datasets can never be used to deploy.")
        return EXIT_GATE_FAILED

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

    records = evaluate.build_coverage_records(evaluate.load_detector(onnx_file), images_dir, labels_dir)
    metrics = evaluate.summarize_coverage(records, args.max_coverage_error)
    gate = apply_gate(metrics, args.min_within_fraction, args.max_neg_fp_rate, args.min_neg_images,
                      args.allow_no_negatives)
    failures = gate["failures"]
    overridden = bool(failures and args.override_gate and args.deploy)
    first_img = next(iter(evaluate.iter_images(images_dir)), None)
    benchmark = benchmark_cpu(onnx_file, cv2.imread(str(first_img)), args.iterations) if first_img else None

    report = {
        "weights": onnx_file.name, "sha256": sha256_of(onnx_file), "metrics": metrics,
        "gate": {"max_coverage_error": args.max_coverage_error, "min_within_fraction": args.min_within_fraction,
                 "max_neg_fp_rate": args.max_neg_fp_rate, "min_neg_images": args.min_neg_images,
                 "allow_no_negatives": args.allow_no_negatives},
        "gate_passed": gate["passed"], "gate_failures": failures, "negatives_checked": gate["negatives_checked"],
        "gate_note": gate["note"], "gate_overridden": overridden,
        "override_reason": args.override_gate if overridden else None, "benchmark": benchmark, "validated_on": "public data only",
        "per_image": records,
    }
    write_reports(report, Path(args.report_dir))
    logger.info("coverage error median=%s p90=%s within=%.1f%% neg_fp=%.1f%% pos=%d neg=%d status_agree=%.1f%% gate=%s",
                metrics["median_abs_error"], metrics["p90_abs_error"], 100 * metrics["within_fraction"],
                100 * metrics["negative_fp_rate"], metrics["positive_images"], metrics["negative_images"],
                100 * metrics["status_agreement"], "PASS" if gate["passed"] else "FAIL")
    if gate["note"]:
        logger.warning(gate["note"])

    if failures and overridden:
        logger.warning("GATE OVERRIDDEN: gate FAILED (%s) but deploying anyway. Reason: %s",
                       "; ".join(failures), args.override_gate)
    elif failures:
        logger.error("Gate FAILED: %s. Production weights untouched.", "; ".join(failures))
        if args.override_gate:
            logger.error("--override-gate ignored: it only takes effect together with --deploy.")
        return EXIT_GATE_FAILED
    if args.deploy:
        source = manifest.get("source") or ", ".join(s["name"] for s in manifest.get("sources", [])) or "unknown"
        deploy_weights(onnx_file, report, f"public datasets: {source}", PROD_WEIGHTS)
    else:
        logger.info("Gate passed. Re-run with --deploy to replace production weights.")
    return 0


if __name__ == "__main__":
    sys.exit(main())