"""Annotation format converters: COCO / Pascal VOC / YOLO -> single-class YOLO boxes.

Every box is collapsed to class 0 ("debris"). Boxes are clipped to the image and
degenerate boxes are dropped. Only stdlib is used here.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable, Optional, Sequence

MIN_BOX_NORM = 0.002  # drop boxes thinner than 0.2% of the image side

YoloBox = tuple[float, float, float, float]  # (cx, cy, w, h) normalized


def _norm(names: Optional[Iterable[str]]) -> Optional[set[str]]:
    return {str(n).strip().lower() for n in names} if names else None


def keep_class(name: str, include: Optional[Iterable[str]], exclude: Optional[Iterable[str]]) -> bool:
    """Apply include_classes / exclude_classes (case-insensitive). Empty include = all."""
    inc, exc = _norm(include), _norm(exclude)
    n = str(name).strip().lower()
    if exc and n in exc:
        return False
    return inc is None or n in inc


def xyxy_to_yolo(x1: float, y1: float, x2: float, y2: float, width: float, height: float) -> Optional[YoloBox]:
    """Clip a pixel box to the image and return normalized (cx, cy, w, h), or None if degenerate."""
    if width <= 0 or height <= 0:
        return None
    x1, x2 = sorted((min(max(x1, 0.0), width), min(max(x2, 0.0), width)))
    y1, y2 = sorted((min(max(y1, 0.0), height), min(max(y2, 0.0), height)))
    w, h = (x2 - x1) / width, (y2 - y1) / height
    if w < MIN_BOX_NORM or h < MIN_BOX_NORM:
        return None
    return ((x1 + x2) / 2 / width, (y1 + y2) / 2 / height, w, h)


def coco_to_yolo(
    coco: dict,
    include_classes: Optional[Sequence[str]] = None,
    exclude_classes: Optional[Sequence[str]] = None,
) -> dict[int, list[YoloBox]]:
    """Return {coco image id: [boxes]} for every image in `coco["images"]` (possibly empty lists)."""
    cats = {c["id"]: c["name"] for c in coco.get("categories", [])}
    sizes = {im["id"]: (im["width"], im["height"]) for im in coco["images"]}
    out: dict[int, list[YoloBox]] = {i: [] for i in sizes}
    for ann in coco.get("annotations", []):
        img_id = ann["image_id"]
        if img_id not in sizes or ann.get("iscrowd"):
            continue
        if not keep_class(cats.get(ann["category_id"], ""), include_classes, exclude_classes):
            continue
        x, y, w, h = ann["bbox"]
        box = xyxy_to_yolo(x, y, x + w, y + h, *sizes[img_id])
        if box:
            out[img_id].append(box)
    return out


def voc_to_yolo(
    xml_path: Path,
    include_classes: Optional[Sequence[str]] = None,
    exclude_classes: Optional[Sequence[str]] = None,
) -> list[YoloBox]:
    """Convert one Pascal VOC XML file to single-class YOLO boxes."""
    root = ET.parse(xml_path).getroot()
    size = root.find("size")
    width, height = float(size.findtext("width")), float(size.findtext("height"))
    boxes: list[YoloBox] = []
    for obj in root.iter("object"):
        if not keep_class(obj.findtext("name", ""), include_classes, exclude_classes):
            continue
        bb = obj.find("bndbox")
        box = xyxy_to_yolo(
            float(bb.findtext("xmin")), float(bb.findtext("ymin")),
            float(bb.findtext("xmax")), float(bb.findtext("ymax")), width, height,
        )
        if box:
            boxes.append(box)
    return boxes


def yolo_file_to_single_class(
    label_path: Path,
    class_names: Sequence[str],
    include_classes: Optional[Sequence[str]] = None,
    exclude_classes: Optional[Sequence[str]] = None,
) -> list[YoloBox]:
    """Read a multi-class YOLO .txt label file and collapse it to class 0."""
    boxes: list[YoloBox] = []
    if not label_path.is_file():
        return boxes
    for line in label_path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        cls = int(float(parts[0]))
        name = class_names[cls] if 0 <= cls < len(class_names) else str(cls)
        if not keep_class(name, include_classes, exclude_classes):
            continue
        cx, cy, w, h = (float(v) for v in parts[1:5])
        box = xyxy_to_yolo((cx - w / 2) * 1000, (cy - h / 2) * 1000, (cx + w / 2) * 1000, (cy + h / 2) * 1000, 1000, 1000)
        if box:
            boxes.append(box)
    return boxes


def write_yolo_labels(path: Path, boxes: Iterable[YoloBox]) -> None:
    """Write boxes as class-0 YOLO lines (an empty file marks a negative image)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n" for cx, cy, w, h in boxes))
