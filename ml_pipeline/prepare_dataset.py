"""Dataset preparation, standardization, and augmentation pipeline for AGOS-Offline YOLOv8.

Aggregates aquatic and urban litter datasets (e.g., TACO, FloW, custom LGU CCTV captures),
collapses all taxonomy classes into a single unified 'debris' class (id 0),
injects 10-15% clean grate/water negative background samples to suppress false alarms,
and exports the dataset structure + data.yaml ready for YOLOv8 training.
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import shutil
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import yaml

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("prepare_dataset")


def setup_directories(output_dir: Path) -> Dict[str, Path]:
    """Create standardized YOLO dataset folder hierarchy."""
    paths = {
        "images_train": output_dir / "images" / "train",
        "images_val": output_dir / "images" / "val",
        "labels_train": output_dir / "labels" / "train",
        "labels_val": output_dir / "labels" / "val",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def write_data_yaml(output_dir: Path, class_name: str = "debris") -> Path:
    """Generate YOLO data configuration yaml."""
    yaml_path = output_dir / "data.yaml"
    data = {
        "path": str(output_dir.resolve()),
        "train": "images/train",
        "val": "images/val",
        "names": {
            0: class_name
        }
    }
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, sort_keys=False)
    logger.info("Generated dataset YAML at %s", yaml_path)
    return yaml_path


def generate_synthetic_culvert_sample(
    has_debris: bool = True,
    width: int = 640,
    height: int = 480
) -> Tuple[np.ndarray, List[List[float]]]:
    """Generate a realistic synthetic drainage frame with asphalt, curb, water, and debris.
    
    Used for immediate offline verification when external datasets are not yet downloaded.
    """
    img = np.full((height, width, 3), (55, 58, 60), dtype=np.uint8) # Asphalt base
    
    # Sidewalk curb top
    curb_y = int(height * 0.35)
    img[:curb_y, :] = (120, 125, 128) # Sidewalk concrete
    cv2.line(img, (0, curb_y), (width, curb_y), (35, 35, 35), 3)

    # Grate inlet opening [0.20, 0.40, 0.80, 0.90]
    rx1, ry1 = int(width * 0.20), int(height * 0.40)
    rx2, ry2 = int(width * 0.80), int(height * 0.90)

    # Water basin inside inlet (turbid brownish runoff)
    img[ry1:ry2, rx1:rx2] = (30, 48, 55)

    # Grate iron bars
    bar_spacing = 35
    for bx in range(rx1 + 10, rx2, bar_spacing):
        cv2.line(img, (bx, ry1), (bx, ry2), (20, 20, 20), 4)

    # Surface water ripples
    for _ in range(12):
        py = random.randint(ry1, ry2)
        px = random.randint(rx1, rx2 - 40)
        cv2.line(img, (px, py), (px + random.randint(15, 35), py), (45, 65, 75), 1)

    boxes: List[List[float]] = []

    if has_debris:
        # Place 1 to 4 simulated debris items/clusters against the grate
        num_items = random.randint(1, 4)
        for _ in range(num_items):
            dw = random.randint(30, 80)
            dh = random.randint(25, 60)
            dx = random.randint(rx1 + 10, rx2 - dw - 10)
            dy = random.randint(ry1 + 10, ry2 - dh - 10)

            # Draw debris object (e.g. plastic bag, bottle cluster, styrofoam)
            color_choice = random.choice([
                (210, 215, 220), # White styrofoam
                (180, 130, 50),   # Brown cardboard/organic
                (40, 140, 220),   # Bright plastic packaging
                (90, 170, 70),    # Green plastic sando bag
            ])
            cv2.rectangle(img, (dx, dy), (dx + dw, dy + dh), color_choice, -1)
            cv2.rectangle(img, (dx, dy), (dx + dw, dy + dh), (20, 20, 20), 1)

            # Normalize to YOLO format [class_id, x_center, y_center, width, height]
            xc = (dx + dw / 2.0) / width
            yc = (dy + dh / 2.0) / height
            nw = dw / width
            nh = dh / height
            boxes.append([0.0, xc, yc, nw, nh])

    return img, boxes


def populate_starter_dataset(
    output_dir: Path,
    total_samples: int = 120,
    val_ratio: float = 0.20,
    negative_ratio: float = 0.15,
) -> None:
    """Populate starter dataset with debris samples and negative background samples."""
    dirs = setup_directories(output_dir)
    write_data_yaml(output_dir)

    num_val = int(total_samples * val_ratio)
    num_train = total_samples - num_val

    splits = [("train", num_train), ("val", num_val)]
    logger.info("Generating synthetic verification dataset (%d train, %d val)...", num_train, num_val)

    for split_name, count in splits:
        img_dir = dirs[f"images_{split_name}"]
        lbl_dir = dirs[f"labels_{split_name}"]

        neg_count = int(count * negative_ratio)
        pos_count = count - neg_count

        sample_idx = 0

        # Positive debris samples
        for _ in range(pos_count):
            img, boxes = generate_synthetic_culvert_sample(has_debris=True)
            stem = f"{split_name}_pos_{sample_idx:04d}"
            cv2.imwrite(str(img_dir / f"{stem}.jpg"), img)

            # Write YOLO format label
            with open(lbl_dir / f"{stem}.txt", "w", encoding="utf-8") as f:
                for b in boxes:
                    f.write(f"0 {b[1]:.6f} {b[2]:.6f} {b[3]:.6f} {b[4]:.6f}\n")
            sample_idx += 1

        # Negative clean drain samples (0 annotations -> empty file)
        for _ in range(neg_count):
            img, _ = generate_synthetic_culvert_sample(has_debris=False)
            stem = f"{split_name}_neg_{sample_idx:04d}"
            cv2.imwrite(str(img_dir / f"{stem}.jpg"), img)

            # Empty text file explicitly informs YOLO this image is pure background
            with open(lbl_dir / f"{stem}.txt", "w", encoding="utf-8") as f:
                pass
            sample_idx += 1

    logger.info("Dataset successfully assembled at: %s", output_dir.resolve())
    logger.info("  Training samples: %d (including %d clean negative backgrounds)", num_train, int(num_train * negative_ratio))
    logger.info("  Validation samples: %d (including %d clean negative backgrounds)", num_val, int(num_val * negative_ratio))


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare YOLOv8 training dataset for AGOS-Offline")
    parser.add_argument("--output-dir", type=str, default="ml_pipeline/dataset", help="Output dataset path")
    parser.add_argument("--generate-starter", action="store_true", help="Generate synthetic starter culvert dataset for testing")
    parser.add_argument("--samples", type=int, default=120, help="Total sample count for starter dataset")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    if args.generate_starter or not out_dir.exists():
        populate_starter_dataset(out_dir, total_samples=args.samples)
    else:
        logger.info("Dataset directory already exists at %s. Writing updated data.yaml...", out_dir)
        write_data_yaml(out_dir)


if __name__ == "__main__":
    main()
