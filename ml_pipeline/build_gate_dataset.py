"""Build the gate-only validation dataset `ml_pipeline/dataset_gate/` (git-ignored, never used for training).

Positives: the validation split of dataset_quick (TACO), copied with its batch_N folders.
Negatives: licence-clean Wikimedia Commons drain/road/canal photos (CC0, CC BY, public domain) from
ml_pipeline/baseline_data/commons, copied with EMPTY label files. Anything else is excluded.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
ALLOWED_LICENCES = ("CC0", "CC-BY", "Public-Domain")  # canonical_license prefixes (CC-BY-SA/NC/ND excluded below)


def licence_ok(canonical: str) -> bool:
    c = canonical or ""
    if any(tag in c for tag in ("-SA", "-NC", "-ND")):
        return False
    return c.startswith(ALLOWED_LICENCES)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--positives", default=str(HERE / "dataset_quick"))
    p.add_argument("--commons", default=str(HERE / "baseline_data" / "commons"))
    p.add_argument("--out", default=str(HERE / "dataset_gate"))
    args = p.parse_args()

    pos_root, commons, out = Path(args.positives), Path(args.commons), Path(args.out)
    img_out, lbl_out = out / "images" / "val", out / "labels" / "val"
    shutil.rmtree(out, ignore_errors=True)

    n_pos = 0
    for img in sorted((pos_root / "images" / "val").rglob("*")):
        if img.suffix.lower() not in IMAGE_EXTS:
            continue
        rel = img.relative_to(pos_root / "images" / "val")
        lbl = pos_root / "labels" / "val" / rel.with_suffix(".txt")
        if not lbl.is_file():
            continue
        for src, dst in ((img, img_out / rel), (lbl, lbl_out / rel.with_suffix(".txt"))):
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        n_pos += 1

    rows = json.loads((commons / "licences.json").read_text(encoding="utf-8"))
    kept, excluded = [], []
    for row in rows:
        src = commons / "images" / row["local_file"]
        if not src.is_file() or not licence_ok(row["canonical_license"]):
            excluded.append({"file": row["local_file"], "licence": row["canonical_license"]})
            continue
        dst = img_out / "commons" / row["local_file"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        lbl = lbl_out / "commons" / Path(row["local_file"]).with_suffix(".txt")
        lbl.parent.mkdir(parents=True, exist_ok=True)
        lbl.write_text("", encoding="utf-8")
        kept.append({k: row.get(k) for k in ("local_file", "title", "category", "page", "canonical_license",
                                               "license_url", "artist")})

    (out / "data.yaml").write_text(
        f"path: {out.as_posix()}\ntrain: images/val\nval: images/val\nnames:\n  0: debris\n", encoding="utf-8")
    manifest = {
        "purpose": "coverage gate only; never used for training",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "positives": {"count": n_pos, "source": "dataset_quick val split (TACO, per-image Flickr licences unverified)"},
        "negatives": {"count": len(kept), "source": "Wikimedia Commons (baseline_data/commons)",
                      "empty_labels": True, "excluded": excluded, "items": kept},
        "licence_evidence": "ml_pipeline/baseline_data/commons/licences.json (kept: CC0, CC BY, public domain)",
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"positives={n_pos} negatives={len(kept)} excluded={len(excluded)} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
