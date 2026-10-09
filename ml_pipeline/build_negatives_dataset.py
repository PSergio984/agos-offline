"""Build the TRAINING-ONLY negatives set and the dataset `ml_pipeline/dataset_quick_neg/` (git-ignored).

fetch    Download permissive (CC0, CC BY 2.0/3.0/4.0, public domain) Wikimedia Commons photos from
         categories that are NOT used by the gate set, skipping every gate image by Commons title,
         by SHA-256 and by a perceptual (dHash) near-duplicate check. Writes _candidates/ + candidates.json.
sheets   Render contact sheets of the candidates for manual review of visible litter/debris.
assemble Copy dataset_quick train/val, add the reviewed negatives (empty labels) and write data.yaml,
         manifest.json and negatives_manifest.json. The gate set (dataset_gate) is never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import shutil
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sources import ALLOWED_LICENSES, http_get, load_registry, normalize_license  # noqa: E402

OUT = HERE / "dataset_quick_neg"
GATE = HERE / "dataset_gate"
QUICK = HERE / "dataset_quick"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
# Gate set used: Drains, Storm drains, Canals, Culverts, Street gutters. These are different.
CATEGORIES = [
    "Creeks", "Brooks", "Streams", "Ditches", "Irrigation canals", "Roadside ditches", "Manholes",
    "Manhole covers", "Gratings", "Drain covers", "Kerbs", "Wet streets", "Wet roads", "Puddles",
    "Asphalt roads", "Cobblestone streets", "Sidewalks", "Roads in the Philippines", "Streets in Manila",
    "Streets in the Philippines", "Streets in Cebu City", "Rivers of the Philippines", "Sewers",
    "Drainage", "Stormwater management",
]
NEG_LICENCES = ("CC0-1.0", "CC-BY-2.0", "CC-BY-3.0", "CC-BY-4.0", "Public-Domain")
assert set(NEG_LICENCES) <= set(ALLOWED_LICENSES)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def dhash(img: np.ndarray) -> int:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    s = cv2.resize(g, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (s[:, 1:] > s[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def gate_fingerprints() -> tuple[set[str], set[str], list[int]]:
    """Titles (normalised), file SHA-256s and dHashes of every gate image."""
    manifest = json.loads((GATE / "manifest.json").read_text(encoding="utf-8"))
    titles = {t["title"].replace("_", " ").lower() for t in manifest["negatives"]["items"] if t.get("title")}
    shas, hashes = set(), []
    for p in (GATE / "images" / "val").rglob("*"):
        if p.suffix.lower() not in IMAGE_EXTS:
            continue
        shas.add(sha256_bytes(p.read_bytes()))
        img = cv2.imread(str(p))
        if img is not None:
            hashes.append(dhash(img))
    return titles, shas, hashes


def list_category(api: str, cat: str, width: int) -> tuple[list[dict], dict[str, int]]:
    items, rejected, cont = [], {}, {}
    for _ in range(4):
        params = {
            "action": "query", "format": "json", "generator": "categorymembers",
            "gcmtitle": f"Category:{cat}", "gcmtype": "file", "gcmlimit": "50",
            "prop": "imageinfo", "iiprop": "url|extmetadata|mime|size", "iiurlwidth": str(width), **cont,
        }
        data = json.loads(http_get(api + "?" + urllib.parse.urlencode(params)))
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("mime") not in ("image/jpeg", "image/png"):
                continue
            meta = info.get("extmetadata", {})
            lic = (meta.get("LicenseShortName") or {}).get("value")
            canon = normalize_license(lic)
            if canon not in NEG_LICENCES:
                rejected[lic or "missing licence"] = rejected.get(lic or "missing licence", 0) + 1
                continue
            artist = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip()
            items.append({
                "title": page["title"], "category": cat, "url": info.get("thumburl") or info["url"],
                "page": info.get("descriptionurl"), "license_name": lic, "canonical_license": canon,
                "license_url": (meta.get("LicenseUrl") or {}).get("value"), "artist": artist,
                "width": info.get("thumbwidth") or info.get("width"),
            })
        if "continue" not in data:
            break
        cont = {"gcmcontinue": data["continue"]["gcmcontinue"]}
        time.sleep(0.3)
    return items, rejected


def cmd_fetch(args: argparse.Namespace) -> int:
    api = load_registry()["commons_negatives"]["api_url"]
    gate_titles, gate_shas, gate_hashes = gate_fingerprints()
    cand_dir = OUT / "_candidates"
    rng = random.Random(args.seed)
    deadline = time.time() + args.minutes * 60
    chosen: list[dict] = []
    rejected_total: dict[str, int] = {}
    stats = {"gate_title": 0, "gate_sha": 0, "gate_near_dup": 0, "undecodable": 0, "too_small": 0, "dup_sha": 0,
             "dup_near": 0}
    done_cats: set[str] = set()
    if args.resume and (OUT / "candidates.json").is_file():
        prev = json.loads((OUT / "candidates.json").read_text(encoding="utf-8"))
        chosen = [it for it in prev["items"] if (cand_dir / it["local_file"]).is_file()]
        stats.update(prev.get("stats", {}))
        rejected_total = dict(prev.get("rejected_licences", {}))
        done_cats = {it["category"] for it in chosen} | set(prev.get("done_categories", []))
        known = {it["local_file"] for it in chosen}
        for p in cand_dir.iterdir():  # files from an interrupted category have no licence evidence
            if p.name not in known:
                p.unlink()
    else:
        shutil.rmtree(cand_dir, ignore_errors=True)  # stale files would have no licence evidence
    cand_dir.mkdir(parents=True, exist_ok=True)
    seen_titles = {it["title"].replace("_", " ").lower() for it in chosen}
    seen_shas = {it["sha256"] for it in chosen}
    seen_hashes = [dhash(cv2.imread(str(cand_dir / it["local_file"]))) for it in chosen]
    next_id = 1 + max((int(it["local_file"][4:8]) for it in chosen), default=-1)

    def save() -> None:  # after every category, so an interrupted fetch keeps its licence evidence
        (OUT / "candidates.json").write_text(json.dumps(
            {"items": chosen, "stats": stats, "rejected_licences": rejected_total,
             "done_categories": sorted(done_cats)}, indent=1), encoding="utf-8")

    for cat in CATEGORIES:
        if cat in done_cats:
            continue
        if time.time() > deadline:
            print("time budget reached")
            break
        try:
            items, rej = list_category(api, cat, args.width)
        except Exception as e:  # noqa: BLE001
            print(f"category {cat}: {e}")
            continue
        for k, v in rej.items():
            rejected_total[k] = rejected_total.get(k, 0) + v
        rng.shuffle(items)
        taken = 0
        for it in items:
            if taken >= args.per_category or time.time() > deadline:
                break
            tnorm = it["title"].replace("_", " ").lower()
            if tnorm in seen_titles:
                continue
            if tnorm in gate_titles:
                stats["gate_title"] += 1
                continue
            try:
                data = http_get(it["url"], retries=2)  # a throttled thumbnail is skipped, not waited on for minutes
            except Exception as e:  # noqa: BLE001
                print(f"skip {it['title']}: {e}")
                continue
            sha = sha256_bytes(data)
            reason = None
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if sha in gate_shas:
                reason = "gate_sha"
            elif sha in seen_shas:
                reason = "dup_sha"
            elif img is None:
                reason = "undecodable"
            elif min(img.shape[:2]) < 300:
                reason = "too_small"
            elif any(bin(dhash(img) ^ g).count("1") <= 6 for g in gate_hashes):
                reason = "gate_near_dup"
            elif any(bin(dhash(img) ^ g).count("1") <= 6 for g in seen_hashes):
                reason = "dup_near"  # keeps held-out val negatives from near-copying train negatives
            if reason:
                stats[reason] += 1
                continue
            ext = ".png" if it["url"].lower().endswith(".png") else ".jpg"
            name = f"neg_{next_id:04d}{ext}"
            next_id += 1
            (cand_dir / name).write_bytes(data)
            seen_titles.add(tnorm)
            seen_shas.add(sha)
            seen_hashes.append(dhash(img))
            chosen.append({"local_file": name, "sha256": sha, **it})
            taken += 1
            time.sleep(0.5)
        done_cats.add(cat)
        save()
        print(f"{cat}: +{taken} (total {len(chosen)})", flush=True)
    save()
    print(f"candidates={len(chosen)} stats={stats} rejected_licences={rejected_total}")
    return 0


def cmd_sheets(args: argparse.Namespace) -> int:
    cands = json.loads((OUT / "candidates.json").read_text(encoding="utf-8"))["items"]
    sheets = OUT / "_sheets"
    shutil.rmtree(sheets, ignore_errors=True)
    sheets.mkdir(parents=True)
    cols, rows, tile = 6, 5, 200
    per = cols * rows
    for s in range(0, len(cands), per):
        canvas = np.full((rows * tile, cols * tile, 3), 30, np.uint8)
        for k, it in enumerate(cands[s:s + per]):
            img = cv2.imread(str(OUT / "_candidates" / it["local_file"]))
            if img is None:
                continue
            img = cv2.resize(img, (tile - 4, tile - 4), interpolation=cv2.INTER_AREA)
            r, c = divmod(k, cols)
            canvas[r * tile + 2:r * tile + 2 + tile - 4, c * tile + 2:c * tile + 2 + tile - 4] = img
            label = it["local_file"][4:8]
            cv2.rectangle(canvas, (c * tile, r * tile), (c * tile + 48, r * tile + 20), (0, 0, 0), -1)
            cv2.putText(canvas, label, (c * tile + 3, r * tile + 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        cv2.imwrite(str(sheets / f"sheet_{s // per:02d}.jpg"), canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f"{len(cands)} candidates -> {(len(cands) + per - 1) // per} sheets in {sheets}")
    return 0


def cmd_assemble(args: argparse.Namespace) -> int:
    doc = json.loads((OUT / "candidates.json").read_text(encoding="utf-8"))
    excluded_ids = {x.strip() for x in args.exclude.split(",") if x.strip()}  # four-digit ids, e.g. 0007
    review_notes = json.loads(Path(args.notes).read_text(encoding="utf-8")) if args.notes else {}
    kept = [it for it in doc["items"] if it["local_file"][4:8] not in excluded_ids]
    removed = [{"local_file": it["local_file"], "title": it["title"],
                "reason": review_notes.get(it["local_file"][4:8], "visible litter/debris, logo, drawing or unclear")}
               for it in doc["items"] if it["local_file"][4:8] in excluded_ids]
    rng = random.Random(args.seed)
    order = list(kept)
    rng.shuffle(order)
    val_negs, train_negs = order[:args.val_negatives], order[args.val_negatives:]

    for sub in ("images", "labels"):
        for split in ("train", "val"):
            shutil.rmtree(OUT / sub / split, ignore_errors=True)
    n = {"train_pos": 0, "val_pos": 0}
    for split, key in (("train", "train_pos"), ("val", "val_pos")):
        for img in sorted((QUICK / "images" / split).rglob("*")):
            if img.suffix.lower() not in IMAGE_EXTS:
                continue
            rel = img.relative_to(QUICK / "images" / split)
            lbl = QUICK / "labels" / split / rel.with_suffix(".txt")
            if not lbl.is_file():
                continue
            for src, dst in ((img, OUT / "images" / split / rel), (lbl, OUT / "labels" / split / rel.with_suffix(".txt"))):
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
            n[key] += 1
    for split, items in (("train", train_negs), ("val", val_negs)):
        for it in items:
            src = OUT / "_candidates" / it["local_file"]
            dst = OUT / "images" / split / "commons_neg" / it["local_file"]
            lbl = OUT / "labels" / split / "commons_neg" / Path(it["local_file"]).with_suffix(".txt")
            dst.parent.mkdir(parents=True, exist_ok=True)
            lbl.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            lbl.write_text("", encoding="utf-8")
            it["split"] = split

    lic_counts: dict[str, int] = {}
    for it in kept:
        lic_counts[it["canonical_license"]] = lic_counts.get(it["canonical_license"], 0) + 1
    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (OUT / "negatives_manifest.json").write_text(json.dumps({
        "purpose": "TRAINING/VALIDATION-selection negatives (empty labels); disjoint from dataset_gate",
        "created": created,
        "source": "Wikimedia Commons API (extmetadata LicenseShortName), categories: " + ", ".join(CATEGORIES),
        "allowed_licences": list(NEG_LICENCES),
        "licence_counts": lic_counts,
        "counts": {"kept": len(kept), "train": len(train_negs), "val": len(val_negs), "manually_removed": len(removed)},
        "gate_exclusion": doc.get("stats"),
        "gate_exclusion_method": "Commons title, SHA-256 of file bytes, and dHash hamming <= 6 vs every dataset_gate image",
        "manually_removed": removed,
        "items": [{k: it.get(k) for k in ("local_file", "split", "title", "category", "url", "page", "artist",
                                          "license_name", "canonical_license", "license_url", "sha256")}
                  for it in kept],
    }, indent=1), encoding="utf-8")
    (OUT / "data.yaml").write_text(
        f"path: {OUT.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: debris\n", encoding="utf-8")
    (OUT / "manifest.json").write_text(json.dumps({
        "synthetic": False,
        "created": created,
        "sources": [
            {"name": "TACO", "path": "D:\\Github\\TACO\\data (via ml_pipeline/dataset_quick)",
             "licence": "annotations CC BY 4.0; images are Flickr, per-image licences UNVERIFIED",
             "train": n["train_pos"], "val": n["val_pos"]},
            {"name": "Wikimedia Commons negatives", "licence_counts": lic_counts,
             "evidence": "ml_pipeline/dataset_quick_neg/negatives_manifest.json",
             "train": len(train_negs), "val": len(val_negs), "empty_labels": True},
        ],
        "notes": "val here is only for Ultralytics checkpoint selection; the real gate is dataset_gate.",
    }, indent=2), encoding="utf-8")
    print(f"train: {n['train_pos']} pos + {len(train_negs)} neg | val: {n['val_pos']} pos + {len(val_negs)} neg | "
          f"removed {len(removed)} | licences {lic_counts}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--per-category", type=int, default=14)
    f.add_argument("--minutes", type=float, default=12)
    # Commons only serves pre-rendered thumbnail sizes without throttling (250, 330, 500, 960, 1280, ...).
    f.add_argument("--width", type=int, default=960)
    f.add_argument("--seed", type=int, default=0)
    f.add_argument("--resume", action="store_true", help="keep candidates.json items and skip finished categories")
    f.set_defaults(fn=cmd_fetch)
    s = sub.add_parser("sheets")
    s.set_defaults(fn=cmd_sheets)
    a = sub.add_parser("assemble")
    a.add_argument("--exclude", default="", help="comma-separated candidate ids (e.g. 0003,0017) failing manual review")
    a.add_argument("--notes", default=None, help="JSON {id: reason} for excluded ids")
    a.add_argument("--val-negatives", type=int, default=20)
    a.add_argument("--seed", type=int, default=0)
    a.set_defaults(fn=cmd_assemble)
    args = p.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
