"""YOLOv8 fine-tuning script specialized for urban flood drainage & debris detection.

Loads pretrained yolov8n.pt weights, trains on the unified 'debris' dataset with
environmental augmentations (lighting shifts, water reflections, scale variation),
and outputs the optimized best.pt checkpoint.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("train_debris")


def train_yolo(
    data_yaml: Path,
    epochs: int = 30,
    imgsz: int = 640,
    batch_size: int = 16,
    device: str = "cpu",
    output_project: Path = Path("ml_pipeline/runs"),
    run_name: str = "debris_yolov8n",
) -> Path:
    """Train YOLOv8n with Ultralytics."""
    try:
        from ultralytics import YOLO
    except ImportError:
        logger.error(
            "Ultralytics is not installed. Install training requirements: "
            "pip install -r ml_pipeline/requirements-train.txt"
        )
        raise

    data_yaml = data_yaml.resolve()
    if not data_yaml.exists():
        raise FileNotFoundError(f"data.yaml not found at {data_yaml}. Run prepare_dataset.py first.")

    logger.info("Initializing YOLOv8n pretrained weights...")
    model = YOLO("yolov8n.pt")

    logger.info(
        "Starting fine-tuning: epochs=%d, imgsz=%d, batch=%d, device=%s",
        epochs,
        imgsz,
        batch_size,
        device,
    )

    # Train with flood & drainage environmental augmentations
    results = model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch_size,
        device=device,
        project=str(output_project),
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
    )

    best_pt = output_project / run_name / "weights" / "best.pt"
    logger.info("Training complete. Best checkpoint saved at: %s", best_pt)
    return best_pt


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune YOLOv8n for AGOS-Offline debris detection")
    parser.add_argument("--data", type=str, default="ml_pipeline/dataset/data.yaml", help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=30, help="Number of training epochs")
    parser.add_argument("--imgsz", type=int, default=640, help="Input image size")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--device", type=str, default="cpu", help="Computation device ('cpu' or '0')")
    parser.add_argument("--project", type=str, default="ml_pipeline/runs", help="Output runs directory")
    parser.add_argument("--name", type=str, default="debris_yolov8n", help="Experiment name")
    args = parser.parse_args()

    train_yolo(
        data_yaml=Path(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch_size=args.batch,
        device=args.device,
        output_project=Path(args.project),
        run_name=args.name,
    )


if __name__ == "__main__":
    main()
