"""Baseline measurement of the shipped backend/app/ml/weights/best.onnx on public data.

Downloads licence-filtered TACO positives and Wikimedia Commons clean negatives into
ml_pipeline/baseline_data/ (git-ignored), evaluates the current weights with the same
evaluator the export gate uses, and writes .agents/tasks/baseline-report.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2

import evaluate
import formats
import sources

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = ROOT / "backend" / "app" / "ml" / "weights" / "best.onnx"
DATA_DIR = Path(__file__).resolve().parent / "baseline_data"
REPORT = ROOT / ".agents" / "tasks" / "baseline-report.md"

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("baseline_eval")


def decide(recall: float, neg_fp: float) -> tuple[str, str]:
    """Plan decision 12: <0.5 RETRAIN, >0.8 KEEP, between = tie-break with reasoning."""
    if recall < 0.5:
        return "RETRAIN", f"box recall {recall:.3f} < 0.50"
    if recall > 0.8:
        return "KEEP", f"box recall {recall:.3f} > 0.80"
    if recall < 0.65 or neg_fp > 0.15:
        return "RETRAIN", f"box recall {recall:.3f} is in 0.50-0.80 and (recall < 0.65 or negative FP rate {neg_fp:.3f} > 0.15)"
    return "KEEP", f"box recall {recall:.3f} is in 0.65-0.80 and negative FP rate {neg_fp:.3f} <= 0.15"


def build_dataset(n_pos: int, n_neg: int, taco_dir: Optional[Path] = None) -> tuple[dict, dict, list[dict]]:
    """Fetch sources and assemble DATA_DIR/{images,labels}. Returns (taco summary, commons summary, licence rows)."""
    reg = sources.load_registry()
    for d in ("images", "labels"):
        shutil.rmtree(DATA_DIR / d, ignore_errors=True)
        (DATA_DIR / d).mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    ok, why = sources.check_source("taco", reg["taco"])
    local = taco_dir is not None and (taco_dir / "annotations.json").is_file()
    if local:
        # User-downloaded TACO (read-only). Per-image licences unverified: baseline only.
        shutil.rmtree(DATA_DIR / "taco", ignore_errors=True)
        taco = sources.load_taco_local(taco_dir, DATA_DIR / "taco", n_pos)
    else:
        taco = sources.fetch_taco(DATA_DIR / "taco", n_pos) if ok else {"source": "taco", "downloaded": 0, "excluded": why}
    if ok or local:
        coco = json.loads((DATA_DIR / "taco" / "annotations_subset.json").read_text(encoding="utf-8"))
        boxes = formats.coco_to_yolo(coco)  # all classes collapsed to class 0 (debris)
        lic = {} if local else {r["local_file"]: r for r in json.loads((DATA_DIR / "taco" / "licences.json").read_text(encoding="utf-8"))}
        for im in coco["images"]:
            name = f"taco_{im['id']:04d}.jpg"
            if not boxes[im["id"]]:
                continue  # all boxes degenerate: not a usable positive
            shutil.copy(DATA_DIR / "taco" / "images" / name, DATA_DIR / "images" / name)
            formats.write_yolo_labels(DATA_DIR / "labels" / f"{Path(name).stem}.txt", boxes[im["id"]])
            if local:
                rows.append({"file": name, "source": "taco", "role": "positive", "canonical_license": "UNVERIFIED (baseline only)",
                             "license_url": None, "photo_page": im.get("flickr_url"), "attribution": "TACO / Flickr"})
            else:
                rows.append({"file": name, "source": "taco", "role": "positive", **{k: lic[name].get(k) for k in ("canonical_license", "license_url", "photo_page", "attribution")}})

    ok, why = sources.check_source("commons_negatives", reg["commons_negatives"])
    commons = (
        sources.fetch_commons(DATA_DIR / "commons", reg["commons_negatives"]["categories"], n_neg)
        if ok else {"source": "commons_negatives", "downloaded": 0, "excluded": why}
    )
    if ok:
        for r in json.loads((DATA_DIR / "commons" / "licences.json").read_text(encoding="utf-8")):
            shutil.copy(DATA_DIR / "commons" / "images" / r["local_file"], DATA_DIR / "images" / r["local_file"])
            (DATA_DIR / "labels" / f"{Path(r['local_file']).stem}.txt").write_text("")
            rows.append({"file": r["local_file"], "source": "commons_negatives", "role": "negative",
                         "canonical_license": r["canonical_license"], "license_url": r.get("license_url"),
                         "photo_page": r.get("page"), "attribution": r.get("artist") or r["title"]})
    (DATA_DIR / "licences_all.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    return taco, commons, rows


def write_report(res: dict, taco: dict, commons: dict, rows: list[dict], decision: str, why: str, sha: str, size: int, rf_note: str) -> None:
    lic_counts = Counter((r["source"], r["canonical_license"]) for r in rows)
    bad = [r for r in rows if r["canonical_license"] not in sources.ALLOWED_LICENSES]
    lines = [
        "# AGOS baseline: shipped weights on public data",
        "",
        f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} by `ml_pipeline/baseline_eval.py`.",
        "",
        "**validated on public data only** (no LGU/CCTV footage; no hand labelling).",
        "",
        "**baseline only, TACO per-image licences unverified.** TACO images came from a user-downloaded local checkout "
        "(read-only); they are NOT shippable training data and stay out of `ml_pipeline/dataset` until per-image licences are verified.",
        "All TACO classes are collapsed to a single class 0: debris.",
        "Retrain rule: recall < 0.5 RETRAIN, > 0.8 KEEP, between = judgement (decision 12 tie-break).",
        "",
        f"- Weights: `backend/app/ml/weights/best.onnx` ({size} bytes), SHA-256 `{sha}`",
        f"- Thresholds: conf {res['conf']}, NMS IoU {res['nms_iou']}, match IoU {res['iou_match']}, run through backend `YOLOInference`",
        f"- Roboflow: {rf_note}",
        "",
        "## Metrics",
        "",
        f"- Positive images: {res['positive_images']} (TACO), ground-truth boxes: {res['gt_boxes']}",
        f"- Negative images: {res['negative_images']} (Wikimedia Commons, not hand-verified litter-free)",
        f"- Box recall @IoU0.5: {res['box_recall']:.4f} (TP {res['tp']}, FN {res['fn']})",
        f"- Box precision @IoU0.5: {res['box_precision']:.4f} (FP {res['fp']} incl. negatives)",
        f"- Image recall: {res['image_recall']:.4f}",
        f"- Negative FP rate: {res['negative_fp_rate']:.4f} ({len(res['fp_negative_files'])}/{res['negative_images']})",
        f"- Gate preview (recall >= 0.80, neg FP <= 0.10, >= 20 negatives): "
        f"{'PASS' if res['box_recall'] >= 0.8 and res['negative_fp_rate'] <= 0.10 and res['negative_images'] >= 20 else 'FAIL'}",
        "",
        "Note: TACO labels are fine-grained litter classes collapsed to one class, photographed at close range on "
        "streets/beaches; this is a different domain from a drain grate camera, so numbers are indicative, not a field result.",
        "",
        "## Negative images with false positives (eyeball these; some may genuinely contain litter)",
        "",
        *([f"- {f}" for f in res["fp_negative_files"]] or ["- none"]),
        "",
        "## Sources and licence evidence",
        "",
        "Licence policy: allowlist CC0-1.0, CC-BY-2.0/3.0/4.0, MIT, Apache-2.0, public domain. NC/ND/SA/GPL/custom/unknown rejected.",
        "Licences were fetched at download time (Flickr photo page for TACO; Commons `extmetadata` for negatives).",
        "Full per-image evidence: `ml_pipeline/baseline_data/licences_all.json` (git-ignored) and the table below.",
        "",
        f"- TACO: {json.dumps(taco)}",
        f"- Wikimedia Commons: {json.dumps(commons)}",
        "",
        "Used images by licence:",
        "",
        *[f"- {s} / {lic}: {n}" for (s, lic), n in sorted(lic_counts.items())],
        f"- Images used with a licence outside the allowlist or unverified: {len(bad)} (all TACO rows when using a local checkout; baseline only)",
        "",
        "## Decision",
        "",
        f"Reasoning: {why}.",
        "",
        f"DECISION: {decision}",
        "",
        "## Per-image licence table",
        "",
        "| file | role | licence | source page | attribution |",
        "|---|---|---|---|---|",
        *[f"| {r['file']} | {r['role']} | {r['canonical_license']} | {r.get('photo_page') or ''} | {str(r.get('attribution') or '').replace('|', '/')[:60]} |" for r in rows],
        "",
    ]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--positives", type=int, default=300)
    ap.add_argument("--negatives", type=int, default=60)
    ap.add_argument("--weights", type=Path, default=WEIGHTS)
    ap.add_argument("--taco-dir", type=Path, default=Path(r"D:\Github\TACO\data"),
                    help="local TACO checkout (read-only; baseline only, per-image licences unverified)")
    args = ap.parse_args()

    taco, commons, rows = build_dataset(args.positives, args.negatives, args.taco_dir)
    if not rows:
        raise SystemExit("No licence-clean images could be downloaded; cannot evaluate.")
    res = evaluate.evaluate_onnx(args.weights, DATA_DIR / "images", DATA_DIR / "labels")
    decision, why = decide(res["box_recall"], res["negative_fp_rate"])
    sha = hashlib.sha256(args.weights.read_bytes()).hexdigest()
    rf_note = "ROBOFLOW_API_KEY set but no project configured; not used" if os.environ.get("ROBOFLOW_API_KEY") \
        else "ROBOFLOW_API_KEY absent; continued with TACO + Wikimedia Commons only"
    write_report(res, taco, commons, rows, decision, why, sha, args.weights.stat().st_size, rf_note)
    cv2.destroyAllWindows()
    logger.info("recall=%.4f precision=%.4f image_recall=%.4f neg_fp=%.4f -> DECISION: %s",
                res["box_recall"], res["box_precision"], res["image_recall"], res["negative_fp_rate"], decision)
    logger.info("Report: %s", REPORT)


if __name__ == "__main__":
    main()
