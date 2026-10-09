"""Read-only acceptance check for the dataset built by build_jionco_mix.py (does not train).

Prints PASS / FAIL / SKIPPED per check and exits non-zero on any FAIL. Importing ultralytics is slow (minutes).
Note: constructing the Ultralytics dataset writes its standard label cache file inside the (git-ignored) dataset dir.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_jionco_mix import VAL_DHASH_DIST, dhash, hamming  # noqa: E402

HERE = Path(__file__).resolve().parent
FAILS: list[str] = []


def report(tag: str, ok: bool | None, detail: str = "") -> None:
    status = "SKIPPED" if ok is None else ("PASS" if ok else "FAIL")
    if ok is False:
        FAILS.append(tag)
    print(f"[{status}] {tag}" + (f": {detail}" if detail else ""), flush=True)


def stems(d: Path) -> set[str]:
    return {p.stem for p in d.glob("*") if p.is_file()}


def list_entries(path: Path) -> list[Path]:
    return [path.parent / ln[2:] for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(HERE / "dataset" / "jionco_mix"))
    ds = Path(ap.parse_args().dataset)
    man = json.loads((ds / "manifest.json").read_text(encoding="utf-8"))
    recs = man["images"]
    splits = ("train", "val", "sanity")

    # a. images <-> labels
    bad = []
    for s in splits:
        im, lb = stems(ds / "images" / s), stems(ds / "labels" / s)
        bad += [f"{s}: {len(im - lb)} images without label, {len(lb - im)} labels without image"] if im != lb else []
    for lst in ("train.txt", "sanity.txt"):
        for p in list_entries(ds / lst):
            lab = Path(str(p).replace("images", "labels", 1).rsplit(".", 1)[0] + ".txt") if False else ds / "labels" / p.parent.name / f"{p.stem}.txt"
            if not p.is_file() or not lab.is_file():
                bad.append(f"{lst}: missing {p.name}")
                break
    report("a. every image has a label (and every list line resolves)", not bad, "; ".join(bad) or
           {s: len(stems(ds / 'images' / s)) for s in splits}.__str__())

    # b. leakage by source stem
    by = {s: {r["source_stem"] for r in recs if r["split"] == s} for s in splits}
    real_train = {r["source_stem"] for r in recs if r["split"] == "train" and r["kind"] == "real"}
    real_val = {r["source_stem"] for r in recs if r["split"] == "val"}
    problems = []
    if by["train"] & by["val"]:
        problems.append(f"{len(by['train'] & by['val'])} stems in train and val")
    if by["sanity"] & (by["train"] | by["val"]):
        problems.append("sanity stem in train/val")
    if any(r["kind"] != "real" for r in recs if r["split"] == "val"):
        problems.append("non-real image in val")
    if any(not p.name.startswith("real_") for p in (ds / "images" / "val").glob("*")):
        problems.append("val filename not real_*")
    report("b. no stem shared across train/val/sanity; val is real only", not problems, "; ".join(problems))

    # c. dHash near-duplicates of val real in train (recomputed from written files)
    h = {r["file"]: dhash(ds / "images" / r["split"] / r["file"]) for r in recs}
    val_h = [h[r["file"]] for r in recs if r["split"] == "val"]
    rt = [r for r in recs if r["split"] == "train" and r["kind"] == "real"]
    mt = [r for r in recs if r["split"] == "train" and r["kind"] == "mini"]
    near_real = [r["file"] for r in rt if any(hamming(h[r["file"]], v) <= VAL_DHASH_DIST for v in val_h)]
    near_mini = sum(any(hamming(h[r["file"]], v) <= VAL_DHASH_DIST for v in val_h) for r in mt)
    report(f"c. no real-train image within dHash<={VAL_DHASH_DIST} of a val image", not near_real,
           f"{len(near_real)} violations {near_real[:3]}; info: mini-train within {VAL_DHASH_DIST} of val: {near_mini}")

    # d. label sanity
    n_boxes, empty, errs = Counter(), Counter(), []
    for s in splits:
        for p in sorted((ds / "labels" / s).glob("*.txt")):
            lines = [ln for ln in p.read_text().splitlines() if ln.strip()]
            empty[s] += not lines
            for ln in lines:
                f = ln.split()
                try:
                    ok = len(f) == 5 and f[0] == "0" and all(0.0 <= float(v) <= 1.0 for v in f[1:])
                except ValueError:
                    ok = False
                if not ok and len(errs) < 3:
                    errs.append(f"{s}/{p.name}: {ln!r}")
                n_boxes[s] += 1
    report("d. class ids all 0, 5 fields, coords in [0,1]", not errs, "; ".join(errs))

    # e. counts
    tl = len(list_entries(ds / "train.txt"))
    rtn, rvn = len(rt), len(real_val)
    print("[INFO] e. counts")
    print(f"  real train {rtn}, real val {rvn}, mini train {len(mt)}, sanity {len(by['sanity'])}, train.txt lines {tl}")
    print(f"  empty fraction: real train {sum(1 for r in rt if r['boxes'] == 0) / max(rtn, 1):.1%}, "
          f"real val {sum(1 for r in recs if r['split'] == 'val' and r['boxes'] == 0) / max(rvn, 1):.1%}, "
          f"all train {empty['train'] / max(len(recs and [r for r in recs if r['split'] == 'train']), 1):.1%}")
    print(f"  boxes per split: {dict(n_boxes)} total {sum(n_boxes.values())}")
    for kind in ("mini", "sanity"):
        c = Counter((r["batch"], r["weather"]) for r in recs if r["kind"] == kind)
        print(f"  {kind} per (batch, weather): {dict(sorted(c.items(), key=str))}")
    print(f"  effective real:mini lines {(tl - len(mt))}:{len(mt)}; mini:real un-oversampled {len(mt) / max(rtn, 1):.2f}")
    print(f"  origin-unverified images: {sum(r['origin_unverified'] for r in recs)}; split method: {man['real_split_method']}")
    report("e. counts reported", True)

    # f. yaml + manifest
    ok_f, detail = True, ""
    for y in ("data.yaml", "data_sanity.yaml"):
        d = yaml.safe_load((ds / y).read_text(encoding="utf-8"))
        if d.get("names") != {0: "debris"}:
            ok_f, detail = False, f"{y} names {d.get('names')}"
    if man.get("synthetic") is not False:
        ok_f, detail = False, "manifest synthetic is not false"
    report("f. yamls load, names == {0: 'debris'}, manifest synthetic == false", ok_f, detail)

    # g. ultralytics
    try:
        from ultralytics.data.dataset import YOLODataset
        from ultralytics.data.utils import check_det_dataset
    except ImportError:
        report("g. ultralytics check_det_dataset", None, "ultralytics not installed; nothing was pip installed")
        sys.exit(1 if FAILS else 0)
    try:
        for y in ("data.yaml", "data_sanity.yaml"):
            d = check_det_dataset(str(ds / y))
            assert d["nc"] == 1 and d["names"] == {0: "debris"}, d["names"]
        report("g1. check_det_dataset loads data.yaml and data_sanity.yaml", True)
        d = check_det_dataset(str(ds / "data.yaml"))
        dset = YOLODataset(img_path=str(ds / "train.txt"), imgsz=640, augment=False, data=d, task="detect")
        report("g2. Ultralytics dataset length == train.txt lines (oversampled repeats kept)", len(dset) == tl,
               f"len(dataset)={len(dset)} train.txt={tl}")
    except Exception as e:
        report("g. ultralytics", False, f"{type(e).__name__}: {e}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
