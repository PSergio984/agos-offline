"""Shared detector evaluator (plan decision 12), used by the baseline and the export gate.

Runs an ONNX model through the production `YOLOInference` (same pre/postprocess) at
conf 0.35 / NMS IoU 0.50 and scores it against single-class YOLO labels.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

import cv2
import numpy as np
import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.ml.occlusion import OcclusionStatus, classify_occlusion, compute_occlusion  # noqa: E402

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}
FULL_FRAME_ROI = [0.0, 0.0, 1.0, 1.0]
WARNING_COVERAGE = 20.0  # production Clear/Warning threshold (percent)
STATUS_TELEMETRY = {OcclusionStatus.CLEAR: "clear", OcclusionStatus.WARNING: "partial",
                    OcclusionStatus.CRITICAL: "blocked"}


def load_engine(weights: Path, conf: float = 0.35, nms_iou: float = 0.50) -> Any:
    """Build the production YOLOInference for `weights`."""
    from app.ml.inference import YOLOInference

    engine = YOLOInference(weights_path=weights, conf_threshold=conf, iou_threshold=nms_iou)
    if not engine.is_loaded:
        raise RuntimeError(f"Could not load ONNX weights: {weights}")
    return engine


def read_labels(label_path: Path, width: int, height: int) -> list[list[float]]:
    """Read class-0 YOLO labels as pixel [x1, y1, x2, y2] boxes."""
    boxes = []
    if label_path.is_file():
        for line in label_path.read_text().splitlines():
            p = line.split()
            if len(p) >= 5:
                cx, cy, w, h = (float(v) for v in p[1:5])
                boxes.append([(cx - w / 2) * width, (cy - h / 2) * height, (cx + w / 2) * width, (cy + h / 2) * height])
    return boxes


def iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def match_boxes(preds: list[tuple[float, list[float]]], gts: list[list[float]], iou_match: float) -> int:
    """Greedy one-to-one matching by descending confidence; returns the number of true positives."""
    used: set[int] = set()
    tp = 0
    for _, pb in sorted(preds, key=lambda x: -x[0]):
        best, best_i = 0.0, -1
        for i, gb in enumerate(gts):
            if i in used:
                continue
            v = iou(pb, gb)
            if v > best:
                best, best_i = v, i
        if best >= iou_match and best_i >= 0:
            used.add(best_i)
            tp += 1
    return tp


def evaluate_onnx(
    weights: Path,
    images_dir: Path,
    labels_dir: Path,
    conf: float = 0.35,
    iou_match: float = 0.5,
    nms_iou: float = 0.50,
    engine: Optional[Any] = None,
) -> dict[str, Any]:
    """Score `weights` on images_dir/labels_dir. An image with an empty/missing label is a negative."""
    engine = engine or load_engine(Path(weights), conf, nms_iou)
    tp = fp = fn = 0
    pos_images = pos_hit = neg_images = 0
    fp_files: list[str] = []
    for img_path in sorted(p for p in Path(images_dir).iterdir() if p.suffix.lower() in IMAGE_EXTS):
        frame = cv2.imread(str(img_path))
        if frame is None:
            continue
        h, w = frame.shape[:2]
        gts = read_labels(Path(labels_dir) / f"{img_path.stem}.txt", w, h)
        preds = [(d.confidence, list(d.box)) for d in engine.infer(frame)]
        if gts:
            pos_images += 1
            t = match_boxes(preds, gts, iou_match)
            tp += t
            fp += len(preds) - t
            fn += len(gts) - t
            pos_hit += 1 if preds else 0
        else:
            neg_images += 1
            fp += len(preds)
            if preds:
                fp_files.append(img_path.name)
    return {
        "box_recall": tp / (tp + fn) if tp + fn else 0.0,
        "box_precision": tp / (tp + fp) if tp + fp else 0.0,
        "image_recall": pos_hit / pos_images if pos_images else 0.0,
        "negative_fp_rate": len(fp_files) / neg_images if neg_images else 0.0,
        "positive_images": pos_images,
        "negative_images": neg_images,
        "gt_boxes": tp + fn,
        "tp": tp, "fp": fp, "fn": fn,
        "fp_negative_files": fp_files,
        "conf": conf, "iou_match": iou_match, "nms_iou": nms_iou,
    }


# --------------------------------------------------------------------------- coverage gate

Detector = Callable[[np.ndarray], Sequence[Sequence[float]]]


def load_detector(weights: Path, conf: float = 0.35, nms_iou: float = 0.50) -> Detector:
    """Production YOLOInference as a `frame -> [[x1, y1, x2, y2], ...]` callable."""
    engine = load_engine(Path(weights), conf, nms_iou)
    return lambda frame: [list(d.box) for d in engine.infer(frame)]


def resolve_val_dirs(data_yaml: Path) -> tuple[Path, Path]:
    """Validation (images_dir, labels_dir) from an Ultralytics data.yaml (labels mirror images/)."""
    data_yaml = Path(data_yaml)
    cfg = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
    root = Path(cfg.get("path") or ".")
    if not root.is_absolute():
        root = data_yaml.parent / root
    val = cfg.get("val")
    if not isinstance(val, str):
        raise ValueError(f"{data_yaml} needs a single 'val' directory entry")
    images_dir = root / val
    parts = list(Path(val).parts)
    if "images" not in parts:
        raise ValueError(f"val entry {val!r} must contain an 'images' folder to locate labels")
    parts[parts.index("images")] = "labels"
    return images_dir, root.joinpath(*parts)


def frame_coverage(boxes: Sequence[Sequence[float]], height: int, width: int) -> float:
    """Width-span coverage (%) over the full frame, using the production formula."""
    return compute_occlusion(FULL_FRAME_ROI, boxes, frame_shape=(height, width)).ratio


def iter_images(images_dir: Path) -> list[Path]:
    """Images under images_dir, recursively (TACO keeps batch_N subfolders), sorted."""
    return sorted(p for p in Path(images_dir).rglob("*") if p.suffix.lower() in IMAGE_EXTS)


def build_coverage_records(detect: Detector, images_dir: Path, labels_dir: Path) -> list[dict[str, Any]]:
    """True (label) and predicted (detector) full-frame coverage for every validation image."""
    records = []
    for img_path in iter_images(images_dir):
        frame = cv2.imread(str(img_path))
        if frame is None:
            continue
        h, w = frame.shape[:2]
        rel = img_path.relative_to(images_dir)
        gts = read_labels(Path(labels_dir) / rel.with_suffix(".txt"), w, h)
        records.append({
            "name": rel.as_posix(),
            "positive": bool(gts),
            "true": frame_coverage(gts, h, w),
            "pred": frame_coverage(detect(frame), h, w),
        })
    return records


def _status(ratio: float) -> str:
    return STATUS_TELEMETRY[classify_occlusion(ratio)]


def summarize_coverage(records: list[dict[str, Any]], max_error: float = 15.0) -> dict[str, Any]:
    """Coverage-error statistics. Error stats use positive images; negatives give the false-coverage rate."""
    pos = [r for r in records if r["positive"]]
    neg = [r for r in records if not r["positive"]]
    errors = np.array([abs(r["pred"] - r["true"]) for r in pos], dtype=float)
    false_cov = [r["name"] for r in neg if r["pred"] >= WARNING_COVERAGE]
    return {
        "positive_images": len(pos),
        "negative_images": len(neg),
        "median_abs_error": round(float(np.median(errors)), 2) if len(errors) else None,
        "p90_abs_error": round(float(np.percentile(errors, 90)), 2) if len(errors) else None,
        "within_fraction": float(np.mean(errors <= max_error + 1e-9)) if len(errors) else 0.0,
        "max_coverage_error": max_error,
        "negative_fp_rate": len(false_cov) / len(neg) if neg else 0.0,
        "negative_false_coverage_files": false_cov,
        "status_agreement": (sum(_status(r["pred"]) == _status(r["true"]) for r in records) / len(records)
                             if records else 0.0),
    }
