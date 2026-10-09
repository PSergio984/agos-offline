"""Licence-gated dataset ingestion for AGOS-Offline (single class: 0 = debris).

Pipeline: load sources.yaml (a source without a licence is a hard error) -> exclude sources whose
licence is not on the allowlist (NC / ND / SA / GPL / unknown) -> optional download -> convert COCO /
YOLO / plain images to YOLO boxes collapsed to class 0 -> dedupe by image hash -> blur faces and
licence plates (OpenCV Haar; plate recall is only partial) -> ~12% clean negatives with empty labels ->
group-wise 80/20 train/val split -> data.yaml + manifest.json + DATASET_LICENSES.md.

The synthetic generator only runs behind --generate-starter (manifest "synthetic": true) and must never
be used to train a shippable model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import random
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

import formats  # noqa: E402
import sources as srcs  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("prepare_dataset")

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
MAX_SIDE = 1280
NEG_TARGET, NEG_MIN = 0.12, 0.10
VAL_RATIO = 0.20
DEFAULT_LICENSES_OUT = Path(__file__).with_name("DATASET_LICENSES.md")


@dataclass
class Item:
    path: Path
    source: str
    role: str
    group: str
    boxes: list = field(default_factory=list)
    licence: str = ""
    licence_url: Optional[str] = None
    attribution: str = ""
    page: Optional[str] = None
    aspect: Optional[float] = None  # width / height recorded in the annotation, if any


# --------------------------------------------------------------------------- collection

def _yolo_names(local: Path, src: dict[str, Any]) -> list[str]:
    if src.get("class_names"):
        return [str(n) for n in src["class_names"]]
    for cand in sorted(local.glob("*.y*ml")) + sorted(local.glob("*/data.yaml")):
        names = (yaml.safe_load(cand.read_text(encoding="utf-8")) or {}).get("names")
        if isinstance(names, dict):
            return [str(names[k]) for k in sorted(names)]
        if names:
            return [str(n) for n in names]
    return []


def _per_image_evidence(local: Path) -> dict[str, dict[str, Any]]:
    path = local / "licences.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {e["local_file"]: e for e in data} if isinstance(data, list) else {}


def _tally(rejected: dict[str, int], key: str) -> None:
    rejected[key] = rejected.get(key, 0) + 1


def collect_source(
    name: str, src: dict[str, Any], local: Path, cache: Path, allow_network: bool,
) -> tuple[list[Item], dict[str, int]]:
    """Return (items, rejected-reason tally) for one included source."""
    kind, role = src["kind"], src.get("role", "positive")
    canon = srcs.normalize_license(src["licence"])
    attribution = str(src.get("attribution") or src.get("description") or name)
    base = dict(source=name, role=role, licence=canon or "per-image", attribution=attribution, page=src.get("homepage"))
    rejected: dict[str, int] = {}
    items: list[Item] = []

    if kind == "coco":
        ann_file = local / src.get("annotations_file", "annotations.json")
        coco = json.loads(ann_file.read_text(encoding="utf-8"))
        boxes = formats.coco_to_yolo(coco, src.get("include_classes"), src.get("exclude_classes"))
        evidence: dict[str, dict[str, Any]] = {}
        if src.get("licence_resolver") == "taco_flickr":
            cands = [im for im in coco["images"] if im.get("license") == "CC" and im.get("flickr_url") and boxes.get(im["id"])]
            evidence = srcs.taco_flickr_licences(cands, cache / f"{name}_flickr_licences.json", allow_network)
        elif src.get("per_image_licence"):
            evidence = _per_image_evidence(local)
        for im in coco["images"]:
            bx = boxes.get(im["id"], [])
            if role == "positive" and not bx:
                continue
            rel = im["file_name"]
            item = Item(path=local / rel, group=rel.split("/")[0] if "/" in rel else Path(rel).stem,
                        boxes=bx if role == "positive" else [], aspect=im["width"] / im["height"], **base)
            if src.get("per_image_licence"):
                ev = evidence.get(rel)
                lic = ev and ev.get("canonical_license")
                if lic not in srcs.ALLOWED_LICENSES:
                    _tally(rejected, f"no allowlisted per-image licence ({(ev or {}).get('error') or 'none recorded'})")
                    continue
                item.licence, item.licence_url, item.page = lic, ev.get("license_url"), ev.get("photo_page") or item.page
                item.attribution = ev.get("attribution") or f"Flickr user {ev.get('owner_nsid')}"
            items.append(item)

    elif kind in ("yolo", "images"):
        names = _yolo_names(local, src) if kind == "yolo" else []
        evidence = _per_image_evidence(local) if src.get("per_image_licence") else {}
        for img in sorted(p for p in local.rglob("*") if p.suffix.lower() in IMG_EXT):
            if kind == "yolo" and "images" not in img.relative_to(local).parts:
                continue
            group = img.stem.split(".rf.")[0]
            item = Item(path=img, group=group, **base)
            if kind == "yolo" and role == "positive":
                parts = list(img.relative_to(local).parts)
                parts[parts.index("images")] = "labels"
                item.boxes = formats.yolo_file_to_single_class(
                    local.joinpath(*parts).with_suffix(".txt"), names, src.get("include_classes"), src.get("exclude_classes"))
                if not item.boxes:
                    continue
            if src.get("per_image_licence"):
                ev = evidence.get(img.name)
                lic = ev and ev.get("canonical_license")
                if lic not in srcs.ALLOWED_LICENSES:
                    _tally(rejected, "no allowlisted per-image licence")
                    continue
                item.licence, item.licence_url, item.page = lic, ev.get("license_url"), ev.get("page") or item.page
                item.attribution = ev.get("artist") or item.attribution
            items.append(item)
    else:
        raise SystemExit(f"Source '{name}': unknown kind '{kind}'")
    cap = src.get("max_images")
    if cap and len(items) > cap:
        random.Random(0).shuffle(items)
        items = sorted(items[: int(cap)], key=lambda i: str(i.path))
    return items, rejected


# --------------------------------------------------------------------------- image processing

_CASCADES: dict[str, cv2.CascadeClassifier] = {}


def _cascade(name: str) -> cv2.CascadeClassifier:
    if name not in _CASCADES:
        _CASCADES[name] = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / name))
    return _CASCADES[name]


def blur_faces_and_plates(img: np.ndarray) -> tuple[np.ndarray, int, int]:
    """Gaussian-blur Haar-detected faces and plates. Returns (image, faces, plates). Recall is partial."""
    h, w = img.shape[:2]
    s = min(1.0, 640 / max(h, w))
    gray = cv2.cvtColor(cv2.resize(img, None, fx=s, fy=s) if s < 1 else img, cv2.COLOR_BGR2GRAY)
    found = {"faces": [], "plates": []}
    for cascade, key, neighbours in (
        ("haarcascade_frontalface_default.xml", "faces", 6),
        ("haarcascade_profileface.xml", "faces", 6),
        ("haarcascade_russian_plate_number.xml", "plates", 5),
    ):
        det = _cascade(cascade).detectMultiScale(gray, 1.1, neighbours, minSize=(24, 24))
        found[key].extend(det.tolist() if len(det) else [])
    for x, y, bw, bh in found["faces"] + found["plates"]:
        x1, y1, x2, y2 = (int(v / s) for v in (x, y, x + bw, y + bh))
        roi = img[max(y1, 0):y2, max(x1, 0):x2]
        if roi.size:
            k = max(3, (min(roi.shape[:2]) // 3) | 1)
            img[max(y1, 0):y2, max(x1, 0):x2] = cv2.GaussianBlur(roi, (k, k), 0)
    return img, len(found["faces"]), len(found["plates"])


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- split

def split_groups(positives: list[Item], negatives: list[Item], seed: int) -> dict[int, str]:
    """Group-wise ~80/20 split. Returns {id(item): 'train'|'val'}. Positives by group, negatives by image."""
    rng = random.Random(seed)
    out: dict[int, str] = {}
    groups: dict[tuple[str, str], list[Item]] = {}
    for it in positives:
        groups.setdefault((it.source, it.group), []).append(it)
    keys = sorted(groups)
    rng.shuffle(keys)
    target, val_n = max(1, round(VAL_RATIO * len(positives))), 0
    for k in keys:
        split = "val" if val_n < target and len(keys) > 1 else "train"
        val_n += len(groups[k]) if split == "val" else 0
        for it in groups[k]:
            out[id(it)] = split
    negs = list(negatives)
    rng.shuffle(negs)
    neg_val = max(1, round(VAL_RATIO * len(negs))) if len(negs) > 1 else 0
    for i, it in enumerate(negs):
        out[id(it)] = "val" if i < neg_val else "train"
    return out


# --------------------------------------------------------------------------- outputs

def write_data_yaml(output_dir: Path) -> Path:
    path = output_dir / "data.yaml"
    path.write_text(yaml.dump({
        "path": str(output_dir.resolve()), "train": "images/train", "val": "images/val", "names": {0: "debris"},
    }, sort_keys=False), encoding="utf-8")
    return path


def write_licences_md(path: Path, manifest: dict[str, Any]) -> None:
    lines = [
        "# Dataset licences",
        "",
        "Generated by `ml_pipeline/prepare_dataset.py`. Only allowlisted licences "
        f"({', '.join(srcs.ALLOWED_LICENSES)}) are ingested; images are used for training a single-class `debris` detector.",
        "Validated on public data only. Per-image evidence is in `manifest.json` of the dataset output.",
        "",
        "## Included sources",
        "",
        "| Source | Licence | URL | Attribution | Images (used) | Boxes |",
        "|---|---|---|---|---|---|",
    ]
    for s in manifest["sources"]:
        lines.append(f"| {s['name']} | {s['licence']} | {s['url']} | {s['attribution']} | {s['images']} | {s['boxes']} |")
    for s in manifest["sources"]:
        if s.get("per_image"):
            lines += ["", f"### Per-image attribution: {s['name']}", "", "| File | Licence | Author | Page |", "|---|---|---|---|"]
            for it in manifest["images"]:
                if it["source"] == s["name"]:
                    lines.append(f"| {it['file']} | {it['licence']} | {it['attribution']} | {it.get('page') or ''} |")
    for s in manifest["sources"]:
        if s.get("note"):
            lines += ["", f"Note ({s['name']}): {s['note']}"]
    lines += ["", "## Excluded sources", ""]
    if manifest["excluded"]:
        lines += ["| Source | Declared licence | Reason |", "|---|---|---|"]
        lines += [f"| {e['name']} | {e['licence']} | {e['reason']} |" for e in manifest["excluded"]]
    else:
        lines.append("None.")
    lines += ["", "## Rejected images (per-image licence filter / dedupe)", ""]
    rej = manifest["rejected"]
    lines += [f"- {k}: {v}" for k, v in sorted(rej.items())] or ["None."]
    lines += ["", f"Totals: {manifest['counts']}", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def prepare_output_dir(out: Path, overwrite: bool) -> None:
    if out.exists() and any(out.iterdir()):
        if not overwrite:
            raise SystemExit(f"Output dir {out} is not empty; pass --overwrite to replace the dataset files.")
        for sub in ("images", "labels"):
            shutil.rmtree(out / sub, ignore_errors=True)
        for f in ("data.yaml", "manifest.json"):
            (out / f).unlink(missing_ok=True)


# --------------------------------------------------------------------------- synthetic starter

def generate_synthetic_culvert_sample(has_debris: bool = True, width: int = 640, height: int = 480):
    """Synthetic drainage frame with rectangles as debris. Test fixture only."""
    img = np.full((height, width, 3), (55, 58, 60), dtype=np.uint8)
    rx1, ry1, rx2, ry2 = int(width * 0.2), int(height * 0.4), int(width * 0.8), int(height * 0.9)
    img[ry1:ry2, rx1:rx2] = (30, 48, 55)
    for bx in range(rx1 + 10, rx2, 35):
        cv2.line(img, (bx, ry1), (bx, ry2), (20, 20, 20), 4)
    boxes: list[list[float]] = []
    if has_debris:
        for _ in range(random.randint(1, 4)):
            dw, dh = random.randint(30, 80), random.randint(25, 60)
            dx, dy = random.randint(rx1 + 10, rx2 - dw - 10), random.randint(ry1 + 10, ry2 - dh - 10)
            cv2.rectangle(img, (dx, dy), (dx + dw, dy + dh), random.choice([(210, 215, 220), (180, 130, 50), (40, 140, 220)]), -1)
            boxes.append([0.0, (dx + dw / 2) / width, (dy + dh / 2) / height, dw / width, dh / height])
    return img, boxes


def populate_starter_dataset(out: Path, total: int = 120) -> None:
    n_val = int(total * VAL_RATIO)
    items = []
    for split, count in (("train", total - n_val), ("val", n_val)):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        neg = int(count * 0.15)
        for i in range(count):
            positive = i >= neg
            img, boxes = generate_synthetic_culvert_sample(positive)
            stem = f"{split}_{'pos' if positive else 'neg'}_{i:04d}"
            cv2.imwrite(str(out / "images" / split / f"{stem}.jpg"), img)
            (out / "labels" / split / f"{stem}.txt").write_text("".join(f"0 {b[1]:.6f} {b[2]:.6f} {b[3]:.6f} {b[4]:.6f}\n" for b in boxes))
            items.append({"file": f"{stem}.jpg", "split": split, "role": "positive" if positive else "negative", "source": "synthetic"})
    write_data_yaml(out)
    (out / "manifest.json").write_text(json.dumps({"synthetic": True, "created": _now(), "images": items}, indent=1), encoding="utf-8")
    logger.warning("Synthetic starter dataset written to %s. NOT for shippable training.", out)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- main flow

def resolve_sources(registry, cache: Path, download: bool):
    """Split registry into (included [(name, src, local)], excluded [dict])."""
    included, excluded = [], []
    for name, src in registry.items():
        ok, reason = srcs.check_source(name, src)
        if not ok:
            excluded.append({"name": name, "licence": src["licence"], "reason": reason})
            continue
        kind = src["kind"]
        if kind == "roboflow":
            projects = src.get("projects") or []
            if not projects:
                excluded.append({"name": name, "licence": src["licence"], "reason": "no projects configured"})
            for p in projects:
                pname = f"roboflow:{p['workspace']}/{p['project']}"
                dest = cache / f"roboflow_{p['workspace']}_{p['project']}_v{p['version']}"
                if download and not dest.exists():
                    res = srcs.fetch_roboflow(dest, p["workspace"], p["project"], int(p["version"]))
                    if not res or not res.get("downloaded"):
                        excluded.append({"name": pname, "licence": str((res or {}).get("rejected")), "reason": "roboflow download/licence check failed"})
                        continue
                lic_file = dest / "licences.json"
                if not lic_file.is_file():
                    excluded.append({"name": pname, "licence": src["licence"], "reason": "not downloaded (--no-download)"})
                    continue
                lic = json.loads(lic_file.read_text(encoding="utf-8")).get("license")
                if not srcs.is_allowed(lic):
                    excluded.append({"name": pname, "licence": str(lic), "reason": "licence not in allowlist"})
                    continue
                vsrc = {**src, "kind": "yolo", "licence": lic, "per_image_licence": False, "homepage": p.get("url") or f"https://universe.roboflow.com/{p['workspace']}/{p['project']}",
                        "attribution": f"Roboflow Universe {p['workspace']}/{p['project']} v{p['version']}", "note": f"Roboflow project version {p['version']}, licence read from the project API at download time."}
                included.append((pname, vsrc, dest))
            continue
        local = Path(src["local_path"]) if src.get("local_path") else cache / name
        if not local.is_absolute() and src.get("local_path"):
            local = (srcs.REGISTRY_PATH.parent / local).resolve()
        if download and kind == "images" and src.get("api_url") and not (local / "licences.json").is_file():
            srcs.fetch_commons(local, src["categories"], int(src.get("max_images", 400)))
        elif download and src.get("hf_repo") and not (local / "licences.json").is_file():
            hf = srcs.fetch_hf_yolo(local, src["hf_repo"], int(src.get("max_images", 2000)))
            src = {**src, "licence": hf["license"], "note": f"Licence read from the Hugging Face dataset card at download time ({hf['card_url']})."}
        if not local.is_dir():
            excluded.append({"name": name, "licence": src["licence"], "reason": f"local data not found at {local} (download skipped or failed)"})
            continue
        if src.get("hf_repo") and (local / "licences.json").is_file():
            hf_lic = json.loads((local / "licences.json").read_text(encoding="utf-8"))
            src = {**src, "licence": hf_lic["license"]}
            if not srcs.is_allowed(src["licence"]):
                excluded.append({"name": name, "licence": src["licence"], "reason": "licence not in allowlist"})
                continue
        included.append((name, src, local))
    return included, excluded


def ingest(args: argparse.Namespace) -> None:
    sources_path = Path(args.sources)
    registry = srcs.load_registry(sources_path)  # hard-fails on a missing licence before anything is written
    srcs.REGISTRY_PATH = sources_path.resolve() if sources_path.is_file() else srcs.REGISTRY_PATH
    out, cache = Path(args.output_dir), Path(args.cache_dir)
    prepare_output_dir(out, args.overwrite)
    included, excluded = resolve_sources(registry, cache, not args.no_download)

    rejected: dict[str, int] = {}
    seen: dict[str, str] = {}
    pos_items: list[Item] = []
    neg_items: list[Item] = []
    sha: dict[int, str] = {}
    src_meta: dict[str, dict[str, Any]] = {}
    for name, src, local in included:
        items, rej = collect_source(name, src, local, cache, not args.no_download)
        for k, v in rej.items():
            rejected[f"{name}: {k}"] = v
        for it in items:
            if not it.path.is_file():
                _tally(rejected, f"{name}: missing file")
                continue
            digest = sha256_file(it.path)
            if digest in seen:
                _tally(rejected, f"{name}: duplicate image (same sha256)")
                continue
            seen[digest] = name
            sha[id(it)] = digest
            (pos_items if it.role == "positive" else neg_items).append(it)
        src_meta[name] = {"name": name, "licence": srcs.normalize_license(src["licence"]) or "per-image (allowlisted)",
                          "url": src.get("homepage", ""), "attribution": src.get("attribution") or src.get("description", ""),
                          "per_image": bool(src.get("per_image_licence")), "note": src.get("note"), "images": 0, "boxes": 0}

    if not pos_items:
        raise SystemExit("No licence-clean positive images found; nothing to prepare.")
    need = math.ceil(NEG_MIN * len(pos_items) / (1 - NEG_MIN))
    if len(neg_items) < need:
        raise SystemExit(f"Only {len(neg_items)} licence-clean negatives available; need >= {need} (10% of the set).")
    target = round(NEG_TARGET * len(pos_items) / (1 - NEG_TARGET))
    random.Random(args.seed).shuffle(neg_items)
    neg_items = sorted(neg_items[:max(target, need)], key=lambda i: str(i.path))

    splits = split_groups(pos_items, neg_items, args.seed)
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    faces = plates = modified = 0
    records: list[dict[str, Any]] = []
    for n, it in enumerate(pos_items + neg_items):
        img = cv2.imread(str(it.path))
        if img is None:
            _tally(rejected, f"{it.source}: unreadable image")
            continue
        h, w = img.shape[:2]
        if it.aspect and abs(w / h - it.aspect) > 0.03:
            _tally(rejected, f"{it.source}: annotation/image aspect mismatch")
            continue
        scale = min(1.0, MAX_SIDE / max(h, w))
        if scale < 1.0:
            img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
        if not args.no_blur:
            img, nf, npl = blur_faces_and_plates(img)
            faces, plates, modified = faces + nf, plates + npl, modified + (1 if nf or npl else 0)
        split = splits[id(it)]
        stem = f"{it.source.replace(':', '_').replace('/', '_')}_{n:05d}"
        cv2.imwrite(str(out / "images" / split / f"{stem}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        formats.write_yolo_labels(out / "labels" / split / f"{stem}.txt", it.boxes)
        meta = src_meta[it.source]
        meta["images"] += 1
        meta["boxes"] += len(it.boxes)
        records.append({"file": f"{stem}.jpg", "split": split, "role": it.role, "source": it.source, "group": it.group,
                        "licence": it.licence, "licence_url": it.licence_url, "attribution": it.attribution,
                        "page": it.page, "sha256": sha[id(it)], "boxes": len(it.boxes)})

    n_pos = sum(r["role"] == "positive" for r in records)
    n_neg = len(records) - n_pos
    manifest = {
        "synthetic": False, "created": _now(), "seed": args.seed,
        "counts": {"positives": n_pos, "negatives": n_neg, "train": sum(r["split"] == "train" for r in records),
                   "val": sum(r["split"] == "val" for r in records), "boxes": sum(r["boxes"] for r in records)},
        "blur": {"enabled": not args.no_blur, "faces": faces, "plates": plates, "images_modified": modified,
                 "note": "OpenCV Haar cascades; face recall and especially plate recall are partial."},
        "sources": [m for m in src_meta.values() if m["images"]], "excluded": excluded, "rejected": rejected, "images": records,
    }
    write_data_yaml(out)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    write_licences_md(Path(args.licenses_out), manifest)
    logger.info("Dataset ready at %s: %s", out.resolve(), manifest["counts"])
    if n_neg / max(len(records), 1) < NEG_MIN:
        raise SystemExit("Negative share fell below 10% after filtering.")


def main() -> None:
    p = argparse.ArgumentParser(description="Prepare the licence-gated single-class debris dataset")
    p.add_argument("--sources", default=str(srcs.REGISTRY_PATH), help="sources.yaml registry")
    p.add_argument("--output-dir", default="ml_pipeline/dataset_public")
    p.add_argument("--licenses-out", default=str(DEFAULT_LICENSES_OUT))
    p.add_argument("--cache-dir", default="ml_pipeline/dataset_cache", help="Download cache (git-ignored)")
    p.add_argument("--no-download", action="store_true", help="No network: use local paths and caches only")
    p.add_argument("--no-blur", action="store_true", help="Skip face/plate blur (tests only)")
    p.add_argument("--overwrite", action="store_true", help="Replace an existing non-empty output dir")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--generate-starter", action="store_true", help="Write a SYNTHETIC starter set (test fixture only)")
    p.add_argument("--samples", type=int, default=120, help="Sample count for --generate-starter")
    args = p.parse_args()

    if args.generate_starter:
        prepare_output_dir(Path(args.output_dir), args.overwrite)
        populate_starter_dataset(Path(args.output_dir), args.samples)
    else:
        ingest(args)


if __name__ == "__main__":
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    main()
