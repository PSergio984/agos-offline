"""YOLOv8 fine-tuning for the single-class 'debris' detector (class 0).

Starts from pretrained yolov8n.pt and trains on the licence-gated dataset produced by
prepare_dataset.py, with flood/drainage-style augmentation. Refuses a synthetic dataset
(manifest.json "synthetic": true) unless --allow-synthetic is given.

Ultralytics and the resulting weights are AGPL-3.0.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("train_debris")


def default_device() -> str:
    """'0' when CUDA is available, else 'cpu'."""
    try:
        import torch

        return "0" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def check_not_synthetic(data_yaml: Path, allow_synthetic: bool) -> None:
    manifest = data_yaml.parent / "manifest.json"
    if manifest.is_file() and json.loads(manifest.read_text(encoding="utf-8")).get("synthetic") and not allow_synthetic:
        raise SystemExit(f"{manifest} is marked synthetic; refusing to train. Use --allow-synthetic for a smoke test only.")


def train_yolo(
    data_yaml: Path,
    epochs: int = 50,
    imgsz: int = 640,
    batch_size: int = 16,
    device: Optional[str] = None,
    workers: int = 2,
    hours: Optional[float] = None,
    patience: int = 20,
    output_project: Path = Path("ml_pipeline/runs"),
    run_name: str = "debris_yolov8n",
    allow_synthetic: bool = False,
    weights: str = "yolov8n.pt",
) -> Path:
    """Train YOLOv8n with Ultralytics and return the best.pt path."""
    data_yaml = data_yaml.resolve()
    if not data_yaml.exists():
        raise FileNotFoundError(f"data.yaml not found at {data_yaml}. Run prepare_dataset.py first.")
    check_not_synthetic(data_yaml, allow_synthetic)
    try:
        from ultralytics import YOLO
    except ImportError:
        logger.error("Ultralytics is not installed. See ml_pipeline/requirements-train.txt")
        raise

    device = device or default_device()
    logger.info("Training: epochs=%d imgsz=%d batch=%d device=%s workers=%d hours=%s patience=%d",
                epochs, imgsz, batch_size, device, workers, hours, patience)
    model = YOLO(weights)
    kwargs = {"time": hours} if hours else {}
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch_size,
        device=device,
        workers=workers,
        patience=patience,
        project=str(output_project.resolve()),
        name=run_name,
        exist_ok=True,
        # Augmentation settings for turbid water & street runoff
        hsv_h=0.015,
        hsv_s=0.6,
        hsv_v=0.4,
        scale=0.5,
        translate=0.1,
        fliplr=0.5,
        mosaic=1.0,
        close_mosaic=5,
        verbose=True,
        **kwargs,
    )
    best_pt = output_project / run_name / "weights" / "best.pt"
    logger.info("Training complete. Best checkpoint: %s", best_pt)
    return best_pt


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune YOLOv8n for AGOS-Offline debris detection")
    parser.add_argument("--data", default="ml_pipeline/dataset_public/data.yaml", help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default=None, help="'0' (GPU) or 'cpu'; default: 0 if CUDA is available")
    parser.add_argument("--workers", type=int, default=2, help="Dataloader workers (keep <=2 on Windows)")
    parser.add_argument("--hours", type=float, default=None, help="Wall-clock budget (Ultralytics time=)")
    parser.add_argument("--patience", type=int, default=20, help="Early-stopping patience in epochs")
    parser.add_argument("--project", default="ml_pipeline/runs")
    parser.add_argument("--name", default="debris_yolov8n")
    parser.add_argument("--allow-synthetic", action="store_true", help="Allow the synthetic starter set (smoke test only)")
    parser.add_argument("--weights", default="yolov8n.pt", help="Starting checkpoint (e.g. a previous best.pt to fine-tune)")
    args = parser.parse_args()

    train_yolo(
        data_yaml=Path(args.data), epochs=args.epochs, imgsz=args.imgsz, batch_size=args.batch,
        device=args.device, workers=args.workers, hours=args.hours, patience=args.patience,
        output_project=Path(args.project), run_name=args.name, allow_synthetic=args.allow_synthetic,
        weights=args.weights,
    )


if __name__ == "__main__":
    main()
