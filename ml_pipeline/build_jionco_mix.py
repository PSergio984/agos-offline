"""Build a leakage-safe real + miniature YOLO dataset (single class: 0 = debris).

REAL   = Jionco field frames (images on disk, CVAT YOLO 1.1 labels in a zip). Validation comes ONLY from here.
MINI   = miniature (Eurobox + simulated crate) frames: labels in CVAT zips, images fetched from the user's own
         Cloudinary folder 'agos' (only the ones selected for the mix). Used for TRAIN, plus a small separate
         'sanity' split that is never the headline metric.

Real split: contiguous blocks of Cloudinary created_at (filenames are random hashes) -> whole blocks go to val.
Fallback (created_at unusable): dHash clusters. A dHash safety net always removes real-train images that are
near-duplicates of real-val images. Oversampling of real train is done by repeating lines in train.txt.

Never reads or prints .env values; the Cloudinary helper is only imported at build time (not for --dry-run).
No training here. See .agents/tasks/jionco-mix-plan.md.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import random
import shutil
import sys
import time
import urllib.request
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import yaml
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

import formats  # noqa: E402
import prepare_dataset as prep  # noqa: E402

DEFAULT_ROOT = r"D:\Github\YOLO training-20261009T135403Z-1-001\YOLO training"
REAL_DIRS = ("Jiongco_2026-10-09_22_22", "Jiongco_missing")
REAL_LABEL_ZIP = ("Jionco Batch", "project_448377_annotations_*yolo 1.1.zip")
RAIN4_ZIP = ("New Batch 4 - 2100 images", "training_raining4_*.zip")
# code, batch, weather (None = inferred later), folder under ROOT, zip glob, label for reports
MINI_SETS = [
    ("b2n", "B2", "normal", "New Batch 2", "training_normal_capture2_new.zip"),
    ("b2r", "B2", "rain", "New Batch 2", "training_raining_2.zip"),
    ("b3n", "B3", "normal", "New batch 3", "training_normal_new_batch_3.zip"),
    ("b3r", "B3", "rain", "New batch 3", "training_raining__new_batch_3.zip"),
    ("b4", "B4", None, "New Batch 4 - 2100 images", "project_439676_annotations_*yolo 1.1.zip"),
    ("rootn", "root", "normal", "", "training_normal_capture_whole_batch.zip"),
    ("rootr", "root", "rain", "", "training_raining_capture.zip"),
]
CORE = ["b2n", "b2r", "b3n", "b3r", "b4n", "b4r"]
ROOT_CODES = ["rootn", "rootr"]
VAL_DHASH_DIST = 4          # real-train vs real-val near-duplicate threshold
FALLBACK_DHASH_DIST = 6     # clustering threshold for the dHash-group fallback
DHASH_WEIGHT = 3.0          # weight of the dHash-exclusion share in the block-choice score
SAFETY_NET_MAX = 0.15       # stop if dHash exclusions remove more than this share of real train
DEDUP_MIN_KEEP = 0.60       # skip miniature dHash dedup if it would keep fewer than this share
SANITY_MIN_KEEP = 0.30      # skip sanity dHash filter if it rejects more than 70%


def say(*a: Any) -> None:
    print(*a, flush=True)


# --------------------------------------------------------------------------- hashing

def dhash(path: Path) -> int:
    """64-bit difference hash (PIL, grayscale 9x8)."""
    with Image.open(path) as im:
        im.draft("L", (64, 64))
        g = np.asarray(im.convert("L").resize((9, 8), Image.BILINEAR), dtype=np.int16)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return int.from_bytes(np.packbits(bits).tobytes(), "big")


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


# --------------------------------------------------------------------------- inputs

def load_listing(path: Path) -> dict[str, dict[str, Any]]:
    """{stem: meta} for uploaded images. stem = last path segment of public_id."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return {pid.split("/")[-1]: {**m, "public_id": pid} for pid, m in raw.items() if m.get("type") == "upload"}


def find_zip(root: Path, folder: str, pattern: str) -> Path:
    hits = sorted((root / folder).glob(pattern))
    if len(hits) != 1:
        raise SystemExit(f"Expected exactly one zip matching '{pattern}' in '{root / folder}', found {len(hits)}")
    return hits[0]


def read_label_zip(zip_path: Path) -> tuple[dict[str, str], list[str], set[str]]:
    """(labels {stem: text} from obj_train_data/*.txt, obj.names, jpg stems in zip). Read in memory only."""
    labels: dict[str, str] = {}
    names: list[str] = []
    jpgs: set[str] = set()
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            p = n.replace("\\", "/")
            if p.startswith("obj_train_data/") and p.endswith(".txt"):
                labels[p[len("obj_train_data/"):-4]] = z.read(n).decode("utf-8")
            elif p == "obj.names":
                names = [x.strip() for x in z.read(n).decode("utf-8").splitlines() if x.strip()]
            elif p.lower().endswith(".jpg") and "/" not in p:
                jpgs.add(p[:-4])
    return labels, names, jpgs


def count_boxes(text: str) -> int:
    return sum(1 for ln in text.splitlines() if len(ln.split()) >= 5)


def find_real(root: Path, listing: dict) -> tuple[list[dict], dict]:
    """Pair real images on disk with Jionco labels. Returns (records, info)."""
    labels, names, _ = read_label_zip(find_zip(root, *REAL_LABEL_ZIP))
    if names != ["debris"]:
        raise SystemExit(f"Jionco obj.names is {names}, expected ['debris']")
    imgs: dict[str, Path] = {}
    for d in REAL_DIRS:
        for p in sorted((root / d).glob("*.jpg")):
            imgs.setdefault(p.stem, p)
    stray_labels = sorted(set(labels) - set(imgs))
    unlabelled = sorted(set(imgs) - set(labels))
    if unlabelled:
        raise SystemExit(f"{len(unlabelled)} real images have no label (e.g. {unlabelled[:3]})")
    recs = []
    for stem in sorted(imgs):
        with Image.open(imgs[stem]) as im:
            w, h = im.size
        recs.append(dict(stem=stem, path=imgs[stem], label=labels[stem], n_boxes=count_boxes(labels[stem]),
                         created_at=(listing.get(stem) or {}).get("created_at"), w=w, h=h, small=w < 2000))
    return recs, {"stray_labels": stray_labels, "labels": len(labels)}


# --------------------------------------------------------------------------- real split

def gate_created_at(recs: list[dict], block_size: int) -> tuple[bool, dict]:
    ts = [r["created_at"] for r in recs]
    if not all(ts):
        return False, {"reason": "some images have no created_at"}
    stats = {"distinct_minutes": len({t[:16] for t in ts}), "distinct_timestamps": len(set(ts)),
             "max_per_timestamp": max(Counter(ts).values())}
    stats["ok"] = stats["distinct_minutes"] >= 10 and stats["distinct_timestamps"] >= 100 and stats["max_per_timestamp"] <= block_size
    return stats["ok"], stats


def make_blocks(order: list[int], block_size: int) -> list[list[int]]:
    blocks = [order[i:i + block_size] for i in range(0, len(order), block_size)]
    if len(blocks) > 1 and len(blocks[-1]) < block_size / 2:
        blocks[-2] += blocks.pop()
    return blocks


def choose_units(units: list[list[int]], recs: list[dict], val_ratio: float, seed: int, trials: int = 5000,
                 extra=None) -> list[int]:
    """Seeded random search over whole units (blocks/clusters) -> val. Keeps size, empty share and image-size mix.
    `extra(members) -> float` is an optional additive penalty (used for the dHash-exclusion count)."""
    n = len(recs)
    tgt = max(1, round(val_ratio * n))
    e_all = sum(r["n_boxes"] == 0 for r in recs) / n
    s_all = sum(r["small"] for r in recs) / n
    def score_of(chosen: list[int]) -> float:
        members = [i for u in chosen for i in units[u]]
        if not members:
            return math.inf
        e_dev = abs(sum(recs[i]["n_boxes"] == 0 for i in members) / len(members) - e_all)
        score = (abs(len(members) - tgt) / tgt + 2 * e_dev
                 + abs(sum(recs[i]["small"] for i in members) / len(members) - s_all))
        return score + (extra(members) if extra else 0.0)

    rng = random.Random(seed)
    best, best_score = [], math.inf
    for _ in range(trials):
        idx = list(range(len(units)))
        rng.shuffle(idx)
        chosen, size = [], 0
        for u in idx:
            if abs(size + len(units[u]) - tgt) < abs(size - tgt):
                chosen.append(u)
                size += len(units[u])
        sc = score_of(chosen)
        if sc < best_score:
            best, best_score = sorted(chosen), sc
    # deterministic hill-climb from the best random draw: toggle one unit or swap one in/out
    improved = True
    while improved and best:
        improved = False
        out_ = [u for u in range(len(units)) if u not in best]
        moves = [[x for x in best if x != u] for u in best] + [best + [u] for u in out_] \
            + [[x for x in best if x != u] + [v] for u in best for v in out_]
        for cand in moves:
            sc = score_of(cand)
            if sc < best_score - 1e-12:
                best, best_score, improved = sorted(cand), sc, True
    return best


def split_real_blocks(recs: list[dict], args: argparse.Namespace, hashes: Optional[list[int]] = None,
                      ) -> tuple[dict[int, str], list[list[int]], list[int]]:
    """Whole created_at blocks -> val. With `hashes`, the block choice also penalises blocks whose neighbours are
    dHash near-duplicates (<= VAL_DHASH_DIST) of val frames, so fewer train images must be dropped later."""
    order = sorted(range(len(recs)), key=lambda i: (recs[i]["created_at"], recs[i]["stem"]))
    blocks = make_blocks(order, args.block_size)
    extra = None
    if hashes is not None:
        n = len(recs)
        near = [{j for j in range(n) if j != i and hamming(hashes[i], hashes[j]) <= VAL_DHASH_DIST} for i in range(n)]

        def extra(members: list[int]) -> float:
            val = set(members)
            hit = set().union(*(near[v] for v in val)) - val
            return DHASH_WEIGHT * len(hit) / max(n - len(val), 1)

    chosen = choose_units(blocks, recs, args.val_ratio, args.seed, extra=extra)
    split = {i: "train" for i in order}
    for b, members in enumerate(blocks):
        for i in members:
            recs[i]["block"] = b
            if b in chosen:
                split[i] = "val"
    pos = {i: p for p, i in enumerate(order)}
    val_pos = {pos[i] for i in order if split[i] == "val"}
    for p, i in enumerate(order):
        if split[i] == "train" and any((p + d) in val_pos for d in range(-args.guard, args.guard + 1) if d):
            split[i] = "guard"
    return split, blocks, chosen


def cluster_dhash(hashes: list[int], dist: int) -> list[list[int]]:
    parent = list(range(len(hashes)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(len(hashes)):
        for j in range(i):
            if hamming(hashes[i], hashes[j]) <= dist:
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(hashes)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def split_real_dhash(recs: list[dict], hashes: list[int], args: argparse.Namespace) -> tuple[dict[int, str], list[list[int]], list[int]]:
    clusters = cluster_dhash(hashes, FALLBACK_DHASH_DIST)
    biggest = max(len(c) for c in clusters)
    if biggest > 0.4 * len(recs):
        raise SystemExit(f"dHash fallback: one cluster holds {biggest}/{len(recs)} images; too few distinct scenes, "
                         "use K-fold by block instead.")
    chosen = choose_units(clusters, recs, args.val_ratio, args.seed)
    split = {i: "train" for i in range(len(recs))}
    for b, members in enumerate(clusters):
        for i in members:
            recs[i]["block"] = b
            if b in chosen:
                split[i] = "val"
    return split, clusters, chosen


def dhash_exclusions(split: dict[int, str], hashes: list[int], dist: int) -> list[int]:
    val = [hashes[i] for i, s in split.items() if s == "val"]
    return [i for i, s in split.items() if s == "train" and any(hamming(hashes[i], v) <= dist for v in val)]


# --------------------------------------------------------------------------- miniature planning

class Stratum:
    def __init__(self, code: str, batch: str, weather: str, stems: list[str], inferred: bool, unverified: bool):
        self.code, self.batch, self.weather = code, batch, weather
        self.stems, self.inferred, self.unverified = stems, inferred, unverified
        self.quota = 0
        self.sanity_n = 0
        self.cands: list[str] = []
        self.reserve: list[str] = []
        self.window: list[str] = []
        self.sanity_cands: list[str] = []
        self.sanity_reserve: list[str] = []
        self.kept: list[str] = []
        self.sanity: list[str] = []
        self.hashes: dict[str, int] = {}
        self.dedup_skipped = False
        self.sanity_filter_skipped = False
        self.dups_dropped = 0


def evenly(seq: list, n: int) -> list:
    if n >= len(seq):
        return list(seq)
    return [seq[i] for i in np.unique(np.linspace(0, len(seq) - 1, n).round().astype(int))]


def load_mini(root: Path, listing: dict, real_stems: set[str]) -> tuple[list[Stratum], dict, dict, dict]:
    """Read miniature label zips and build strata. Returns (strata, labels {stem: text}, coverage, info)."""
    owner: dict[str, str] = {}
    labels: dict[str, str] = {}
    coverage: dict[str, dict] = {}
    overlaps: Counter = Counter()
    rain4 = read_label_zip_jpgs(find_zip(root, *RAIN4_ZIP))
    groups: dict[str, list[str]] = {}
    for code, _batch, _weather, folder, pattern in MINI_SETS:
        lab, names, _ = read_label_zip(find_zip(root, folder, pattern))
        if names != ["debris"]:
            raise SystemExit(f"{code}: obj.names is {names}, expected ['debris']")
        missing = sorted(s for s in lab if s not in listing and not (code == "b4" and s in rain4))
        coverage[code] = {"labels": len(lab), "in_listing": len(lab) - len(missing), "missing": missing}
        for stem in sorted(lab):
            if stem in missing:
                continue
            if stem in real_stems:
                overlaps[(code, "REAL")] += 1
            elif stem in owner:
                overlaps[(code, owner[stem])] += 1
            else:
                owner[stem] = code
                labels[stem] = lab[stem]
                groups.setdefault(code, []).append(stem)
    key = lambda s: ((listing.get(s) or {}).get("created_at") or "", s)  # noqa: E731
    strata = []
    for code, batch, weather, *_ in MINI_SETS:
        stems = sorted(groups.get(code, []), key=key)
        if code == "b4":
            for c, w, sel in (("b4n", "normal", [s for s in stems if s not in rain4]), ("b4r", "rain", [s for s in stems if s in rain4])):
                strata.append(Stratum(c, "B4", w, sel, True, False))
        else:
            strata.append(Stratum(code, batch, weather, stems, False, batch == "root"))
    b4 = sorted(groups.get("b4", []), key=key)
    flags = [s in rain4 for s in b4]
    runs = sum(1 for i, f in enumerate(flags) if f and (i == 0 or not flags[i - 1]))
    longest = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        longest = max(longest, cur)
    pos = [i for i, f in enumerate(flags) if f]
    info = {"overlaps": {f"{a}<-{b}": n for (a, b), n in overlaps.items()}, "b4_rain": len(pos),
            "b4_rain_not_in_labels": len(rain4 - set(groups.get("b4", [])) ),
            "b4_rain_runs": runs, "b4_rain_longest_run": longest,
            "b4_rain_span": (pos[-1] - pos[0] + 1) if pos else 0}
    return strata, labels, coverage, info


def read_label_zip_jpgs(zip_path: Path) -> set[str]:
    return read_label_zip(zip_path)[2]


def plan_miniature(strata: list[Stratum], args: argparse.Namespace) -> None:
    """Quotas, sanity windows (held out in time, with a gap), train candidates and reserve queues. No pixels."""
    core = [s for s in strata if s.code in CORE]
    for i, st in enumerate(core):
        st.quota = args.mini_count // len(core) + (1 if i < args.mini_count % len(core) else 0)
        st.sanity_n = args.sanity_count // len(core) + (1 if i < args.sanity_count % len(core) else 0)
    for st in strata:
        rng = random.Random(f"{args.seed}-{st.code}")
        n = len(st.stems)
        blocked: set[int] = set()
        if st.sanity_n:
            w = min(2 * st.sanity_n, n)
            start = rng.randrange(0, n - w + 1)
            win = list(range(start, start + w))
            blocked = set(range(start - args.sanity_gap, start + w + args.sanity_gap))
            st.window = [st.stems[p] for p in win]
            st.sanity_cands = [st.stems[p] for p in win[::2]][:st.sanity_n]
            st.sanity_reserve = [st.stems[p] for p in win if st.stems[p] not in st.sanity_cands]
        avail = [p for p in range(n) if p not in blocked]
        cand = evenly(avail, math.ceil(1.3 * st.quota)) if st.quota else []
        st.cands = [st.stems[p] for p in cand]
        rest = [st.stems[p] for p in avail if p not in set(cand)]
        rng.shuffle(rest)
        st.reserve = rest


# --------------------------------------------------------------------------- Cloudinary fetch (images only)

class Fetcher:
    """Downloads selected miniature images into the cache dir. Never prints URLs, the cloud name or .env values."""

    def __init__(self, listing: dict, cache: Path, helper: Path, rain4_zip: Path):
        spec = importlib.util.spec_from_file_location("cloudinary_helper", helper)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # reads .env inside the helper; values are never echoed
        self._cloud = mod.CLOUD
        self.listing, self.cache, self.rain4_zip = listing, cache, rain4_zip
        self.rain4 = read_label_zip_jpgs(rain4_zip)
        self.failed: dict[str, str] = {}
        self.downloaded = 0
        cache.mkdir(parents=True, exist_ok=True)

    def _one(self, stem: str) -> Optional[Path]:
        dest = self.cache / f"{stem}.jpg"
        if dest.is_file():
            return dest
        tmp = dest.with_suffix(".part")
        err = "Unknown"
        for attempt in range(3):
            try:
                if stem in self.rain4:
                    with zipfile.ZipFile(self.rain4_zip) as z:
                        data = z.read(f"{stem}.jpg")
                else:
                    m = self.listing[stem]
                    url = f"https://res.cloudinary.com/{self._cloud}/image/upload/v{m['version']}/{m['public_id']}.{m['format']}"
                    with urllib.request.urlopen(url, timeout=120) as r:
                        data = r.read()
                tmp.write_bytes(data)
                with Image.open(tmp) as im:
                    im.verify()
                tmp.replace(dest)
                self.downloaded += 1
                return dest
            except Exception as e:  # exception text can contain the URL: keep only the class name
                err = type(e).__name__
                tmp.unlink(missing_ok=True)
                time.sleep(1 + attempt)
        self.failed[stem] = err
        return None

    def get(self, stems: list[str]) -> dict[str, Optional[Path]]:
        with ThreadPoolExecutor(4) as ex:
            return dict(zip(stems, ex.map(self._one, stems)))


def _is_dup(h: int, others: list[int], dist: int) -> bool:
    return any(hamming(h, o) <= dist for o in others)


def select_train(st: Stratum, f: Fetcher, dist: int) -> None:
    """Download train candidates, thin near-duplicates by dHash, trim evenly to quota."""
    paths = f.get(st.cands)
    ok = [s for s in st.cands if paths[s]]
    for s in ok:
        st.hashes[s] = dhash(paths[s])
    kept: list[str] = []
    for s in ok:
        if _is_dup(st.hashes[s], [st.hashes[k] for k in kept], dist):
            st.dups_dropped += 1
        else:
            kept.append(s)
    if ok and len(kept) < DEDUP_MIN_KEEP * len(ok):
        st.dedup_skipped, st.dups_dropped, kept = True, 0, list(ok)
    st.kept = evenly(kept, st.quota)
    fill_train(st, f, dist)


def fill_train(st: Stratum, f: Fetcher, dist: int) -> None:
    """Top up to the (possibly raised) quota from the reserve queue; also replaces failed downloads."""
    while len(st.kept) < st.quota and st.reserve:
        n_take = max(8, math.ceil(1.3 * (st.quota - len(st.kept))))
        take, st.reserve = st.reserve[:n_take], st.reserve[n_take:]
        paths = f.get(take)
        for s in take:
            if not paths[s] or len(st.kept) >= st.quota:
                continue
            st.hashes[s] = dhash(paths[s])
            if not st.dedup_skipped and _is_dup(st.hashes[s], [st.hashes[k] for k in st.kept], dist):
                st.dups_dropped += 1
                continue
            st.kept.append(s)
    st.kept.sort(key=lambda s: (f.listing.get(s) or {}).get("created_at") or "")


def select_sanity(st: Stratum, f: Fetcher, dist: int) -> None:
    train_h = [st.hashes[k] for k in st.kept]
    pool = st.sanity_cands + st.sanity_reserve
    paths = f.get(st.sanity_cands)
    hs = {s: dhash(paths[s]) for s in st.sanity_cands if paths[s]}
    clean = [s for s, h in hs.items() if not _is_dup(h, train_h, dist)]
    if hs and len(clean) < SANITY_MIN_KEEP * len(hs):
        st.sanity_filter_skipped, clean = True, list(hs)
    st.sanity = clean
    rest = [s for s in pool if s not in st.sanity_cands]
    if len(st.sanity) < st.sanity_n and rest:
        paths = f.get(rest)
        for s in rest:
            if len(st.sanity) >= st.sanity_n:
                break
            if paths[s] and (st.sanity_filter_skipped or not _is_dup(dhash(paths[s]), train_h, dist)):
                st.sanity.append(s)
    st.sanity = st.sanity[:st.sanity_n]


# --------------------------------------------------------------------------- writing

def process_and_write(src: Path, label_text: str, name: str, split: str, out: Path, cache: Path, blur: bool) -> dict:
    img = cv2.imread(str(src))
    if img is None:
        raise SystemExit(f"Unreadable image {src.name}")
    h, w = img.shape[:2]
    scale = min(1.0, prep.MAX_SIDE / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    faces = plates = 0
    if blur:
        img, faces, plates = prep.blur_faces_and_plates(img)
    dest = out / "images" / split / f"{name}.jpg"
    dest.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dest), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    tmp = cache / "_label_tmp.txt"
    tmp.write_text(label_text, encoding="utf-8")
    boxes = formats.yolo_file_to_single_class(tmp, ["debris"])
    formats.write_yolo_labels(out / "labels" / split / f"{name}.txt", boxes)
    return {"file": f"{name}.jpg", "boxes": len(boxes), "sha256": prep.sha256_file(dest), "faces": faces, "plates": plates}


def write_list(path: Path, split: str, names: list[str], repeat: int = 1) -> None:
    path.write_text("".join(f"./images/{split}/{n}.jpg\n" for n in names for _ in range(repeat)), encoding="utf-8")


# --------------------------------------------------------------------------- plan / main

def gather(args: argparse.Namespace):
    root = Path(args.root)
    listing = load_listing(Path(args.listing))
    recs, real_info = find_real(root, listing)
    strata, mini_labels, coverage, mini_info = load_mini(root, listing, {r["stem"] for r in recs})
    plan_miniature(strata, args)
    real_cov = {"labels": real_info["labels"], "in_listing": sum(1 for r in recs if r["created_at"]),
                "images": len(recs), "stray_labels": real_info["stray_labels"]}
    return recs, real_cov, strata, mini_labels, coverage, mini_info


def print_plan(args, recs, real_cov, strata, coverage, mini_info, split, gate, chosen, blocks, method) -> dict:
    n = len(recs)
    say("== Cloudinary coverage (label stems found in listing / label files) ==")
    say(f"  REAL jionco: images {real_cov['images']}, labels {real_cov['labels']}, images in listing {real_cov['in_listing']}, "
        f"stray labels (no image): {real_cov['stray_labels']}")
    for code, c in coverage.items():
        say(f"  {code:6s} {c['in_listing']}/{c['labels']}  missing stems: {len(c['missing'])} {c['missing'][:5]}")
    say(f"  stem overlaps removed (kept first owner): {mini_info['overlaps'] or 'none'}")
    say("== Real ==")
    say(f"  pairs {n}, empty negatives {sum(r['n_boxes'] == 0 for r in recs)}, boxes {sum(r['n_boxes'] for r in recs)}, "
        f"sizes {dict(Counter((r['w'], r['h']) for r in recs))}")
    say(f"  split method: {method}; gate: {gate}")
    if split:
        cnt = Counter(split.values())
        val = [recs[i] for i, s in split.items() if s == "val"]
        say(f"  blocks {len(blocks)}, val blocks {chosen}, val n {cnt['val']} "
            f"(empty {sum(r['n_boxes'] == 0 for r in val) / max(len(val), 1):.1%}), train n {cnt['train']}, guard-excluded {cnt['guard']}")
        say("  PRELIMINARY (metadata only): the build re-chooses val blocks with a dHash-aware score (needs pixels), then the <=4 safety net runs")
    else:
        say("  gate failed: dHash-group fallback will run at build time (needs pixels): deferred")
    say("== Miniature strata ==")
    say(f"  {'stratum':7s} {'stems':>5s} {'quota':>5s} {'cands':>5s} {'reserve':>7s} {'sanity':>6s} {'window':>6s}  flags")
    for st in strata:
        flags = ("weather-inferred " if st.inferred else "") + ("origin-unverified (fill only)" if st.unverified else "")
        say(f"  {st.code:7s} {len(st.stems):5d} {st.quota:5d} {len(st.cands):5d} {len(st.reserve):7d} {st.sanity_n:6d} {len(st.window):6d}  {flags}")
    say(f"  B4 rain stems {mini_info['b4_rain']} (zip jpgs not in labels: {mini_info['b4_rain_not_in_labels']}); in created_at order: "
        f"{mini_info['b4_rain_runs']} run(s), longest {mini_info['b4_rain_longest_run']}, span {mini_info['b4_rain_span']}")
    real_train = sum(1 for s in split.values() if s == "train") if split else round((1 - args.val_ratio) * n)
    mini_n = sum(s.quota for s in strata)
    ratio = mini_n / max(real_train, 1)
    say("== Mix ==")
    say(f"  real train (upper bound, before dHash exclusions) {real_train} x{args.oversample} = {real_train * args.oversample}; "
        f"mini train {mini_n}; train.txt lines ~{real_train * args.oversample + mini_n}")
    say(f"  mini:real (un-oversampled) {ratio:.2f}; effective after oversampling {mini_n / max(real_train * args.oversample, 1):.2f}")
    if not 1.0 <= ratio <= 2.0:
        say("  WARNING: mini:real ratio is outside 1.0 to 2.0")
    return {"ratio": ratio}


def main() -> None:
    p = argparse.ArgumentParser(description="Build the leakage-safe real + miniature dataset (no training)")
    p.add_argument("--root", default=DEFAULT_ROOT)
    p.add_argument("--output-dir", default=str(HERE / "dataset" / "jionco_mix"))
    p.add_argument("--cache-dir", default=str(HERE / "dataset_cache" / "jionco_mix_downloads"))
    p.add_argument("--listing", default=str(REPO / ".agents" / "tasks" / "cloudinary_agos_listing.json"))
    p.add_argument("--cloudinary-helper", default=str(REPO / ".agents" / "tasks" / "cloudinary_fetch.py"))
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--mini-count", type=int, default=900, help="Miniature train images (600-1200)")
    p.add_argument("--oversample", type=int, default=2, help="Repeats of each real train image in train.txt (1-4)")
    p.add_argument("--sanity-count", type=int, default=100)
    p.add_argument("--val-ratio", type=float, default=0.20)
    p.add_argument("--block-size", type=int, default=30)
    p.add_argument("--guard", type=int, default=2, help="Train frames dropped on each side of a val block")
    p.add_argument("--mini-dhash-dist", type=int, default=3)
    p.add_argument("--sanity-gap", type=int, default=2)
    p.add_argument("--no-blur", action="store_true", help="Skip face/plate blur")
    p.add_argument("--overwrite", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Print counts and the plan only; no network, no writes")
    args = p.parse_args()
    if not 600 <= args.mini_count <= 1200:
        p.error("--mini-count must be 600-1200")
    if not 1 <= args.oversample <= 4:
        p.error("--oversample must be 1-4")

    recs, real_cov, strata, mini_labels, coverage, mini_info = gather(args)
    gate_ok, gate = gate_created_at(recs, args.block_size)
    split = blocks = chosen = None
    method = "created_at_blocks" if gate_ok else "dhash_groups"
    if gate_ok:
        split, blocks, chosen = split_real_blocks(recs, args)
    print_plan(args, recs, real_cov, strata, coverage, mini_info, split, gate, chosen, blocks, method)
    if args.dry_run:
        say("Dry run: nothing downloaded or written.")
        return
    build(args, recs, strata, mini_labels, coverage, mini_info, split, blocks, chosen, method, gate, real_cov)


def build(args, recs, strata, mini_labels, coverage, mini_info, split, blocks, chosen, method, gate, real_cov) -> None:
    out, cache = Path(args.output_dir), Path(args.cache_dir)
    prep.prepare_output_dir(out, args.overwrite)
    for f in ("train.txt", "sanity.txt", "val_real_list.txt", "data_sanity.yaml"):
        (out / f).unlink(missing_ok=True)
    shutil.rmtree(out / "images", ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    # ---- real: dHash on all, safety net / fallback
    say("== Build: hashing real images ==")
    hashes = [dhash(r["path"]) for r in recs]
    dh_excl: list[int] = []
    if method == "created_at_blocks":
        split, blocks, chosen = split_real_blocks(recs, args, hashes)  # dHash-aware block choice (same seed)
        dh_excl = dhash_exclusions(split, hashes, VAL_DHASH_DIST)
        n_train = sum(1 for s in split.values() if s == "train")
        say(f"  dHash safety net: {len(dh_excl)} of {n_train} real-train images are within {VAL_DHASH_DIST} of a val image")
        if len(dh_excl) > SAFETY_NET_MAX * n_train:
            raise SystemExit(f"STOP dhash_safety_net: would remove {len(dh_excl)}/{n_train} (> {SAFETY_NET_MAX:.0%}) real-train images. "
                             "Static camera or few distinct scenes; needs a decision, thresholds not loosened.")
        for i in dh_excl:
            split[i] = "dhash_excluded"
    else:
        split, blocks, chosen = split_real_dhash(recs, hashes, args)
    real_train = [recs[i] for i, s in split.items() if s == "train"]
    real_val = [recs[i] for i, s in split.items() if s == "val"]
    say(f"  real train {len(real_train)}, val {len(real_val)}, guard-excluded {sum(s == 'guard' for s in split.values())}, "
        f"dHash-excluded {len(dh_excl)}")

    # ---- miniature: download + thin
    rain4_zip = find_zip(Path(args.root), *RAIN4_ZIP)
    listing = load_listing(Path(args.listing))
    f = Fetcher(listing, cache, Path(args.cloudinary_helper), rain4_zip)
    say("== Build: miniature download + dHash thinning ==")
    core = [s for s in strata if s.code in CORE]
    for st in core:
        select_train(st, f, args.mini_dhash_dist)
        say(f"  {st.code}: kept {len(st.kept)}/{st.quota} (dups dropped {st.dups_dropped}, dedup skipped {st.dedup_skipped})")
    for group, label in ((core, "core"), ([s for s in strata if s.code in ROOT_CODES], "root-zip (origin unverified)")):
        short = args.mini_count - sum(len(s.kept) for s in strata)
        if short <= 0:
            break
        cands = [s for s in group if s.reserve]
        say(f"  shortfall {short}: topping up from {label} strata")
        for k in range(short):
            if not cands:
                break
            cands[k % len(cands)].quota += 1
        for st in group:
            if len(st.kept) < st.quota:
                if st.code in ROOT_CODES:
                    st.cands = []
                fill_train(st, f, args.mini_dhash_dist)
    for st in core:
        select_sanity(st, f, args.mini_dhash_dist)
    say(f"  downloads this run: {f.downloaded}; failed stems: {len(f.failed)} {dict(Counter(f.failed.values()))}")

    # ---- write dataset
    say("== Build: writing images/labels ==")
    records: list[dict] = []
    faces = plates = modified = 0

    def emit(kind, split_name, name, src, label, extra):
        nonlocal faces, plates, modified
        r = process_and_write(src, label, name, split_name, out, cache, not args.no_blur)
        nf, npl = r.pop("faces"), r.pop("plates")
        faces, plates, modified = faces + nf, plates + npl, modified + (1 if nf or npl else 0)
        records.append({**r, "split": split_name, "kind": kind, **extra})

    for s, group in (("train", real_train), ("val", real_val)):
        for r in group:
            emit("real", s, f"real_{r['stem']}", r["path"], r["label"],
                 {"batch": "jionco", "weather": None, "weather_inferred": False, "origin_unverified": False,
                  "source_stem": r["stem"], "created_at": r["created_at"], "block": r.get("block")})
    for st in strata:
        for kind, split_name, stems in (("mini", "train", st.kept), ("sanity", "sanity", st.sanity)):
            for stem in stems:
                emit(kind, split_name, f"{'mini' if kind == 'mini' else 'sanity'}_{st.code}_{stem}", cache / f"{stem}.jpg", mini_labels[stem],
                     {"batch": st.batch, "weather": st.weather, "weather_inferred": st.inferred, "origin_unverified": st.unverified,
                      "source_stem": stem, "created_at": (listing.get(stem) or {}).get("created_at"), "block": None})
    (cache / "_label_tmp.txt").unlink(missing_ok=True)

    # post-write dHash check on the files actually written (resized + blurred): drop real-train near-duplicates of val
    wh = {r["file"]: dhash(out / "images" / r["split"] / r["file"]) for r in records if r["kind"] == "real"}
    val_wh = [wh[r["file"]] for r in records if r["kind"] == "real" and r["split"] == "val"]
    post = [r for r in records if r["kind"] == "real" and r["split"] == "train"
            and any(hamming(wh[r["file"]], v) <= VAL_DHASH_DIST for v in val_wh)]
    for r in post:
        (out / "images" / "train" / r["file"]).unlink()
        (out / "labels" / "train" / (r["file"][:-4] + ".txt")).unlink()
        records.remove(r)
    say(f"  post-write dHash check: {len(post)} more real-train images dropped {[r['source_stem'] for r in post]}")

    train_real = [r["file"][:-4] for r in records if r["kind"] == "real" and r["split"] == "train"]
    train_mini = [r["file"][:-4] for r in records if r["kind"] == "mini"]
    sanity = [r["file"][:-4] for r in records if r["kind"] == "sanity"]
    (out / "train.txt").write_text(
        "".join(f"./images/train/{n}.jpg\n" for n in train_real for _ in range(args.oversample))
        + "".join(f"./images/train/{n}.jpg\n" for n in train_mini), encoding="utf-8")
    write_list(out / "sanity.txt", "sanity", sanity)
    (out / "val_real_list.txt").write_text("".join(f"{r['stem']}\n" for r in sorted(real_val, key=lambda r: r["stem"])), encoding="utf-8")
    for fname, val in (("data.yaml", "images/val"), ("data_sanity.yaml", "sanity.txt")):
        (out / fname).write_text(yaml.dump({"path": str(out.resolve()), "train": "train.txt", "val": val, "names": {0: "debris"}},
                                           sort_keys=False), encoding="utf-8")
    manifest = {
        "synthetic": False, "created": prep._now(), "seed": args.seed,
        "args": {k: v for k, v in vars(args).items() if k not in ("cloudinary_helper",)},
        "real_split_method": method, "real_split_gate": gate, "real_blocks": len(blocks), "real_val_blocks": chosen,
        "real_excluded": {"guard": sum(s == "guard" for s in split.values()), "dhash": len(dh_excl),
                          "guard_stems": sorted(recs[i]["stem"] for i, s in split.items() if s == "guard"),
                          "dhash_stems": sorted(recs[i]["stem"] for i in dh_excl),
                          "dhash_postwrite_stems": sorted(r["source_stem"] for r in post)},
        "coverage": {c: {k: v for k, v in d.items() if k != "missing"} | {"missing_n": len(d["missing"]), "missing": d["missing"]}
                     for c, d in coverage.items()},
        "real_coverage": real_cov, "stem_overlaps": mini_info["overlaps"], "b4_rain_inference": {
            k: v for k, v in mini_info.items() if k.startswith("b4_")},
        "downloads": {"downloaded": f.downloaded, "failed": f.failed},
        "strata": {s.code: {"quota": s.quota, "kept": len(s.kept), "sanity": len(s.sanity), "dups_dropped": s.dups_dropped,
                            "dedup_skipped": s.dedup_skipped, "sanity_filter_skipped": s.sanity_filter_skipped,
                            "origin_unverified": s.unverified, "weather_inferred": s.inferred} for s in strata},
        "blur": {"enabled": not args.no_blur, "faces": faces, "plates": plates, "images_modified": modified,
                 "note": "OpenCV Haar cascades; recall is partial and false positives can blur debris."},
        "counts": {"real_train": len(train_real), "real_val": len(real_val), "mini_train": len(train_mini),
                   "sanity": len(sanity), "train_txt_lines": len(train_real) * args.oversample + len(train_mini),
                   "boxes": sum(r["boxes"] for r in records)},
        "images": records,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    say(f"Dataset ready at {out.resolve()}: {manifest['counts']}")
    if f.failed:
        say(f"Failed downloads (stems, replaced from reserve): {sorted(f.failed)}")


if __name__ == "__main__":
    main()
