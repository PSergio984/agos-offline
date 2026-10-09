"""Licence-gated dataset source registry and downloaders for the AGOS ML pipeline.

Only stdlib, cv2, numpy and yaml are used so tests can import this in CI.
Licences are never taken from memory: per-image licences are fetched at download
time (Flickr photo page for TACO, `extmetadata` for Wikimedia Commons) and the
evidence (licence name, licence URL, source page, author) is written to disk.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import yaml

logger = logging.getLogger("sources")

USER_AGENT = "agos-offline-ml-pipeline/0.1 (hackathon research; github.com/PSergio984/agos-offline)"
REGISTRY_PATH = Path(__file__).with_name("sources.yaml")

# Canonical allowlist (plan decision 11). SA / NC / ND / GPL / custom / unknown are rejected.
ALLOWED_LICENSES = (
    "CC0-1.0", "CC-BY-2.0", "CC-BY-3.0", "CC-BY-4.0", "MIT", "Apache-2.0", "Public-Domain",
)

# Flickr numeric licence ids -> canonical names (None = not allowed). Source: Flickr API
# flickr.photos.licenses.getInfo; the page also carries the licence URL which is stored as evidence.
FLICKR_LICENSES = {
    "0": None, "1": None, "2": None, "3": None, "5": None, "6": None,
    "4": "CC-BY-2.0", "7": None, "8": "Public-Domain", "9": "CC0-1.0", "10": "Public-Domain",
}


def normalize_license(text: Optional[str]) -> Optional[str]:
    """Map a free-text licence label to an ALLOWED_LICENSES entry, or None if not allowed/unknown."""
    if not text:
        return None
    t = re.sub(r"[\s_]+", " ", text.strip().lower())
    if re.search(r"\b(nc|nd|sa)\b|non.?commercial|no.?deriv|share.?alike|gpl|all rights reserved", t):
        return None
    if t in ("cc0", "cc0 1.0", "cc0-1.0", "cc zero") or t.startswith("cc0"):
        return "CC0-1.0"
    m = re.fullmatch(r"cc[- ]by(?:[- ](\d\.\d))?(?: .*)?", t)
    if m and m.group(1) in ("2.0", "3.0", "4.0"):
        return f"CC-BY-{m.group(1)}"
    if t in ("mit", "mit license"):
        return "MIT"
    if t in ("apache-2.0", "apache 2.0", "apache license 2.0"):
        return "Apache-2.0"
    if t.startswith("public domain") or t in ("pd", "pdm", "cc pdm") or t.startswith("pd-") or t.startswith("pd "):
        return "Public-Domain"
    return None


def is_allowed(text: Optional[str]) -> bool:
    return normalize_license(text) in ALLOWED_LICENSES


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, dict[str, Any]]:
    """Load sources.yaml. A source without a licence is a hard error (SystemExit)."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    sources = data.get("sources") or {}
    for name, src in sources.items():
        if not str(src.get("licence") or "").strip():
            raise SystemExit(f"Source '{name}' in {path.name} has no licence field; refusing to continue.")
    return sources


def check_source(name: str, src: dict[str, Any]) -> tuple[bool, str]:
    """Decide whether a whole source may be used. Per-image sources are gated image by image."""
    env = src.get("requires_env")
    if env and not os.environ.get(env):
        return False, f"{env} not set"
    if src.get("per_image_licence"):
        return True, "per-image licence filter"
    if not is_allowed(src["licence"]):
        return False, f"licence '{src['licence']}' not in allowlist"
    return True, "ok"


# --------------------------------------------------------------------------- HTTP

def http_get(url: str, retries: int = 6, timeout: int = 30) -> bytes:
    """GET with retries; honours Retry-After / backs off on HTTP 429 and 5xx."""
    last: Exception = RuntimeError("no attempt")
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                retry_after = e.headers.get("Retry-After", "")
                time.sleep(min(int(retry_after) if retry_after.isdigit() else 3 * 2 ** attempt, 60))
            elif e.code in (403, 404, 410):
                break
        except Exception as e:  # noqa: BLE001 - retry on any network error
            last = e
            time.sleep(1)
    raise last


def _decode_image(data: bytes) -> Optional[np.ndarray]:
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


# --------------------------------------------------------------------------- TACO

def _flickr_photo_licence(flickr_url: str) -> dict[str, Any]:
    """Fetch the Flickr photo page and read the licence id/URL/owner. Returns evidence dict."""
    m = re.search(r"/(\d+)_", flickr_url)
    if not m:
        return {"error": "no photo id"}
    page_url = f"https://www.flickr.com/photo.gne?id={m.group(1)}"
    html = http_get(page_url).decode("utf-8", "ignore")
    lic_id = re.search(r'"license":"?(\d+)', html)
    lic_url = re.search(r"https?://creativecommons\.org/(?:licenses|publicdomain)/[^\"\\ <]+", html)
    owner = re.search(r'"ownerNsid":"([^"]+)"', html) or re.search(r'"nsid":"([^"]+)"', html)
    return {
        "photo_page": page_url,
        "flickr_license_id": lic_id.group(1) if lic_id else None,
        "license_url": lic_url.group(0) if lic_url else None,
        "owner_nsid": owner.group(1) if owner else None,
    }


def fetch_taco(dest: Path, max_images: int, workers: int = 8, seed: int = 0) -> dict[str, Any]:
    """Download up to `max_images` TACO images whose Flickr licence is on the allowlist.

    Writes dest/images/*.jpg, dest/annotations_subset.json (COCO) and dest/licences.json.
    Returns a summary dict with counts and the rejection tally.
    """
    import random

    src = load_registry()["taco"]
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "images").mkdir(exist_ok=True)
    ann_path = dest / "annotations.json"
    if not ann_path.is_file():
        ann_path.write_bytes(http_get(src["annotations_url"]))
    coco = json.loads(ann_path.read_text(encoding="utf-8"))
    cats_by_img: dict[int, int] = {}
    for a in coco["annotations"]:
        cats_by_img[a["image_id"]] = cats_by_img.get(a["image_id"], 0) + 1

    # Candidates: images with annotations and a Flickr-hosted file. TACO's own 'license' field is
    # only 'CC' (unspecific), 'ODBL ...' (share-alike, rejected) or None, so it is not trusted:
    # the Flickr page is the evidence for 'CC' images; everything else is rejected up front.
    rejected: dict[str, int] = {}
    candidates = []
    for im in coco["images"]:
        if im["id"] not in cats_by_img:
            continue
        if im.get("license") != "CC" or not im.get("flickr_640_url"):
            key = f"taco field license={im.get('license')!r}"
            rejected[key] = rejected.get(key, 0) + 1
            continue
        candidates.append(im)
    random.Random(seed).shuffle(candidates)

    def check(im: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            return im, _flickr_photo_licence(im["flickr_url"])
        except Exception as e:  # noqa: BLE001
            return im, {"error": str(e)}

    kept = []
    with ThreadPoolExecutor(workers) as pool:
        for im, ev in pool.map(check, candidates):
            canon = FLICKR_LICENSES.get(str(ev.get("flickr_license_id")))
            ev.update(image_id=im["id"], file_name=im["file_name"], canonical_license=canon)
            if canon not in ALLOWED_LICENSES:
                key = f"flickr licence id {ev.get('flickr_license_id')} ({ev.get('error', 'not allowed')})"
                rejected[key] = rejected.get(key, 0) + 1
                continue
            kept.append((im, ev))

    def download(item: tuple[dict[str, Any], dict[str, Any]]) -> Optional[tuple[dict[str, Any], dict[str, Any]]]:
        im, ev = item
        out = dest / "images" / f"taco_{im['id']:04d}.jpg"
        try:
            if not out.is_file():
                data = http_get(im["flickr_640_url"])
                img = _decode_image(data)
                if img is None:
                    return None
                # EXIF/rotation guard: annotation aspect must match the downloaded aspect.
                h, w = img.shape[:2]
                if abs(w / h - im["width"] / im["height"]) > 0.03:
                    return None
                out.write_bytes(data)
            return im, ev
        except Exception:  # noqa: BLE001
            return None

    done = []
    with ThreadPoolExecutor(workers) as pool:
        for res in pool.map(download, kept):
            if res:
                done.append(res)
            if len(done) >= max_images:
                break
    done = done[:max_images]
    skipped_dl = len(kept) - len(done)

    keep_ids = {im["id"] for im, _ in done}
    subset = dict(coco)
    subset["images"] = [im for im, _ in done]
    subset["annotations"] = [a for a in coco["annotations"] if a["image_id"] in keep_ids]
    (dest / "annotations_subset.json").write_text(json.dumps(subset), encoding="utf-8")
    licences = [
        {"local_file": f"taco_{im['id']:04d}.jpg", "source": "taco", "attribution": "Flickr user "
         f"{ev.get('owner_nsid')}", **ev}
        for im, ev in done
    ]
    (dest / "licences.json").write_text(json.dumps(licences, indent=1), encoding="utf-8")
    return {"source": "taco", "downloaded": len(done), "licence_ok_not_used": skipped_dl, "rejected": rejected}


def load_taco_local(src_dir: Path, dest: Path, max_images: int, max_side: int = 1280, seed: int = 0) -> dict[str, Any]:
    """Use a user-downloaded TACO checkout (read-only) for BASELINE ONLY.

    Per-image Flickr licences are NOT verified here, so these images must never become training data.
    Images are downscaled copies written under `dest`; `src_dir` is never written to.
    Writes dest/images/*.jpg and dest/annotations_subset.json (COCO, sizes updated to the copies).
    """
    import random

    coco = json.loads((src_dir / "annotations.json").read_text(encoding="utf-8"))
    has_ann = {a["image_id"] for a in coco["annotations"]}
    cands = [im for im in coco["images"] if im["id"] in has_ann]
    random.Random(seed).shuffle(cands)
    (dest / "images").mkdir(parents=True, exist_ok=True)
    kept, skipped = [], {"missing": 0, "unreadable": 0, "aspect_mismatch": 0}
    for im in cands:
        if len(kept) >= max_images:
            break
        path = src_dir / im["file_name"]
        if not path.is_file():
            skipped["missing"] += 1
            continue
        img = cv2.imread(str(path))  # applies EXIF orientation
        if img is None:
            skipped["unreadable"] += 1
            continue
        h, w = img.shape[:2]
        if abs(w / h - im["width"] / im["height"]) > 0.03:
            skipped["aspect_mismatch"] += 1
            continue
        s = min(1.0, max_side / max(h, w))
        if s < 1.0:
            img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(dest / "images" / f"taco_{im['id']:04d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        kept.append(im)
    keep_ids = {im["id"] for im in kept}
    subset = dict(coco)
    subset["images"] = kept
    subset["annotations"] = [a for a in coco["annotations"] if a["image_id"] in keep_ids]
    (dest / "annotations_subset.json").write_text(json.dumps(subset), encoding="utf-8")
    return {"source": "taco (local checkout, per-image licences UNVERIFIED)", "downloaded": len(kept), "skipped": skipped}


# --------------------------------------------------------------------------- Commons

def fetch_commons(dest: Path, categories: list[str], max_images: int, width: int = 800, seed: int = 0) -> dict[str, Any]:
    """Download licence-filtered Wikimedia Commons images as clean negatives.

    Licence comes from `extmetadata.LicenseShortName`; CC BY-SA/NC/ND and unknown are rejected.
    Writes dest/images/*.jpg and dest/licences.json.
    """
    import random

    api = load_registry()["commons_negatives"]["api_url"]
    (dest / "images").mkdir(parents=True, exist_ok=True)
    pool_items: list[dict[str, Any]] = []
    rejected: dict[str, int] = {}
    for cat in categories:
        cont: dict[str, str] = {}
        for _ in range(4):  # up to ~200 files per category
            params = {
                "action": "query", "format": "json", "generator": "categorymembers",
                "gcmtitle": f"Category:{cat}", "gcmtype": "file", "gcmlimit": "50",
                "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": str(width), **cont,
            }
            data = json.loads(http_get(api + "?" + urllib.parse.urlencode(params)))
            for page in data.get("query", {}).get("pages", {}).values():
                info = (page.get("imageinfo") or [{}])[0]
                if info.get("mime") not in ("image/jpeg", "image/png"):
                    continue
                meta = info.get("extmetadata", {})
                lic = (meta.get("LicenseShortName") or {}).get("value")
                canon = normalize_license(lic)
                if canon not in ALLOWED_LICENSES:
                    key = f"{lic or 'missing licence'}"
                    rejected[key] = rejected.get(key, 0) + 1
                    continue
                artist = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip()
                pool_items.append({
                    "title": page["title"], "category": cat, "url": info.get("thumburl") or info["url"],
                    "page": info.get("descriptionurl"), "license_name": lic, "canonical_license": canon,
                    "license_url": (meta.get("LicenseUrl") or {}).get("value"), "artist": artist,
                })
            if "continue" not in data:
                break
            cont = {"gcmcontinue": data["continue"]["gcmcontinue"]}
    seen, unique = set(), []
    for it in pool_items:
        if it["title"] not in seen:
            seen.add(it["title"])
            unique.append(it)
    random.Random(seed).shuffle(unique)

    licences = []
    for it in unique:
        if len(licences) >= max_images:
            break
        out = dest / "images" / f"commons_{len(licences):04d}.jpg"
        try:
            img = _decode_image(http_get(it["url"]))
            if img is None:
                continue
            cv2.imwrite(str(out), img)
        except Exception as e:  # noqa: BLE001
            logger.warning("skip %s: %s", it["title"], e)
            continue
        licences.append({"local_file": out.name, "source": "commons_negatives", **it})
    (dest / "licences.json").write_text(json.dumps(licences, indent=1), encoding="utf-8")
    return {"source": "commons_negatives", "downloaded": len(licences), "licence_ok_not_used": len(unique) - len(licences), "rejected": rejected}


# --------------------------------------------------------------------------- Roboflow (optional)

def fetch_roboflow(dest: Path, workspace: str, project: str, version: int) -> Optional[dict[str, Any]]:
    """Download a Roboflow Universe dataset in YOLOv8 format. Requires ROBOFLOW_API_KEY.

    Returns None when the key is absent. The project licence reported by the API is checked
    against the allowlist before any image is downloaded.
    """
    key = os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        return None
    base = f"https://api.roboflow.com/{workspace}/{project}"
    meta = json.loads(http_get(f"{base}?api_key={key}"))
    lic = (meta.get("project") or {}).get("license")
    if not is_allowed(lic):
        return {"source": f"roboflow:{workspace}/{project}", "downloaded": 0, "rejected": {str(lic): 1}}
    export = json.loads(http_get(f"{base}/{version}/yolov8?api_key={key}"))
    link = (export.get("export") or {}).get("link")
    if not link:
        return {"source": f"roboflow:{workspace}/{project}", "downloaded": 0, "rejected": {"no export link": 1}}
    dest.mkdir(parents=True, exist_ok=True)
    zpath = dest / "roboflow.zip"
    zpath.write_bytes(http_get(link, timeout=300))
    with zipfile.ZipFile(zpath) as z:
        z.extractall(dest)
    (dest / "licences.json").write_text(json.dumps({"project": f"{workspace}/{project}", "license": lic}), encoding="utf-8")
    return {"source": f"roboflow:{workspace}/{project}", "downloaded": -1, "license": lic, "rejected": {}}
