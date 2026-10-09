"""Seam 3: dataset ingestion command (ml_pipeline/prepare_dataset.py), offline.

Runs the real CLI against tiny cv2 images and a local sources.yaml fixture.
Asserts external behaviour only: files written, labels, split, licence document, exit codes.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "ml_pipeline" / "prepare_dataset.py"
W, H = 64, 48


def _img(path: Path, seed: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    cv2.imwrite(str(path), rng.integers(0, 255, (H, W, 3), dtype=np.uint8))


def _build_fixture(root: Path, *, extra: dict | None = None) -> Path:
    # COCO source: 4 "batch" folders x 3 images, two categories (must collapse to class 0).
    coco_dir = root / "coco"
    images, anns, n = [], [], 0
    for b in range(1, 5):
        for i in range(3):
            n += 1
            rel = f"batch_{b}/{i:04d}.jpg"
            _img(coco_dir / rel, n)
            images.append({"id": n, "file_name": rel, "width": W, "height": H})
            anns.append({"id": 2 * n, "image_id": n, "category_id": 1, "bbox": [4, 4, 20, 16], "iscrowd": 0})
            anns.append({"id": 2 * n + 1, "image_id": n, "category_id": 2, "bbox": [30, 20, 20, 20], "iscrowd": 0})
    (coco_dir / "annotations.json").write_text(json.dumps({
        "images": images, "annotations": anns,
        "categories": [{"id": 1, "name": "Bottle"}, {"id": 2, "name": "Plastic bag"}],
    }))

    # YOLO source: 4 scenes x 2 augmented copies ("scene.rf.<hash>") share a group.
    yolo_dir = root / "yolo"
    for s in range(4):
        for tag in ("a", "b"):
            stem = f"scene{s}.rf.{tag}"
            _img(yolo_dir / "images" / f"{stem}.jpg", 100 + s * 2 + (tag == "b"))
            (yolo_dir / "labels").mkdir(exist_ok=True)
            (yolo_dir / "labels" / f"{stem}.txt").write_text("2 0.5 0.5 0.4 0.4\n1 0.25 0.25 0.2 0.2\n")
    (yolo_dir / "data.yaml").write_text(yaml.dump({"names": ["cup", "can", "sack"]}))

    # Negatives and an excluded NC source.
    for k in range(6):
        _img(root / "neg" / f"clean{k}.jpg", 200 + k)
    for k in range(3):
        _img(root / "nc" / f"nc{k}.jpg", 300 + k)

    sources = {
        "fx_coco": {
            "kind": "coco", "licence": "CC BY 4.0", "homepage": "https://example.test/coco",
            "attribution": "Fixture COCO authors", "role": "positive", "local_path": str(coco_dir),
        },
        "fx_yolo": {
            "kind": "yolo", "licence": "MIT", "homepage": "https://example.test/yolo",
            "attribution": "Fixture YOLO authors", "role": "positive", "local_path": str(yolo_dir),
        },
        "fx_neg": {
            "kind": "images", "licence": "CC0-1.0", "homepage": "https://example.test/neg",
            "attribution": "Fixture negatives", "role": "negative", "local_path": str(root / "neg"),
        },
        "fx_nc": {
            "kind": "images", "licence": "CC-BY-NC-4.0", "homepage": "https://example.test/nc",
            "attribution": "NC authors", "role": "positive", "local_path": str(root / "nc"),
        },
    }
    sources.update(extra or {})
    path = root / "sources.yaml"
    path.write_text(yaml.dump({"sources": sources}, sort_keys=False))
    return path


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=120,
    )


def _ingest(root: Path, sources: Path) -> subprocess.CompletedProcess:
    return _run(
        "--sources", str(sources), "--output-dir", str(root / "out"),
        "--licenses-out", str(root / "out" / "DATASET_LICENSES.md"),
        "--no-download", "--no-blur",
    )


@pytest.fixture()
def ingested(tmp_path: Path):
    sources = _build_fixture(tmp_path)
    result = _ingest(tmp_path, sources)
    assert result.returncode == 0, result.stderr
    out = tmp_path / "out"
    manifest = json.loads((out / "manifest.json").read_text())
    return out, manifest


def _label_files(out: Path) -> list[Path]:
    return sorted((out / "labels").rglob("*.txt"))


def test_all_labels_are_single_class_zero(ingested):
    out, _ = ingested
    labels = _label_files(out)
    assert labels
    lines = [ln for p in labels for ln in p.read_text().splitlines() if ln.strip()]
    assert lines
    assert all(ln.startswith("0 ") for ln in lines)
    data = yaml.safe_load((out / "data.yaml").read_text())
    assert data["names"] == {0: "debris"}


def test_negatives_are_10_to_15_percent_with_empty_labels(ingested):
    out, manifest = ingested
    images = manifest["images"]
    negatives = [i for i in images if i["role"] == "negative"]
    ratio = len(negatives) / len(images)
    assert 0.10 <= ratio <= 0.15, ratio
    for item in negatives:
        label = out / "labels" / item["split"] / (Path(item["file"]).stem + ".txt")
        assert label.is_file() and label.read_text() == ""
    for item in images:
        assert (out / "images" / item["split"] / item["file"]).is_file()


def test_no_group_in_both_train_and_val(ingested):
    _, manifest = ingested
    splits_by_group: dict[str, set[str]] = {}
    for item in manifest["images"]:
        splits_by_group.setdefault(f'{item["source"]}:{item["group"]}', set()).add(item["split"])
    assert all(len(s) == 1 for s in splits_by_group.values())
    all_splits = {s for v in splits_by_group.values() for s in v}
    assert all_splits == {"train", "val"}
    assert all(i["sha256"] for i in manifest["images"])


def test_licences_document_lists_sources_and_exclusions(ingested):
    out, manifest = ingested
    doc = (out / "DATASET_LICENSES.md").read_text()
    for needle in ("fx_coco", "CC-BY-4.0", "https://example.test/coco", "fx_yolo", "MIT", "fx_neg", "CC0-1.0"):
        assert needle in doc
    counts = {s: sum(1 for i in manifest["images"] if i["source"] == s) for s in ("fx_coco", "fx_yolo", "fx_neg")}
    assert counts["fx_coco"] == 12 and counts["fx_yolo"] == 8
    assert f'{counts["fx_neg"]}' in doc
    assert "Excluded sources" in doc
    excluded_part = doc.split("Excluded sources", 1)[1]
    assert "fx_nc" in excluded_part and "CC-BY-NC-4.0" in excluded_part
    assert all(i["source"] != "fx_nc" for i in manifest["images"])
    assert manifest.get("synthetic") is False


def test_source_without_licence_fails_and_writes_nothing(tmp_path: Path):
    sources = _build_fixture(tmp_path, extra={
        "fx_bad": {"kind": "images", "homepage": "https://example.test/bad", "role": "positive",
                   "local_path": str(tmp_path / "neg")},
    })
    result = _ingest(tmp_path, sources)
    assert result.returncode != 0
    assert "licen" in result.stderr.lower()
    out = tmp_path / "out"
    assert not out.exists() or not list(out.rglob("*.jpg"))


def test_refuses_non_empty_output_dir_without_overwrite(tmp_path: Path):
    sources = _build_fixture(tmp_path)
    assert _ingest(tmp_path, sources).returncode == 0
    second = _ingest(tmp_path, sources)
    assert second.returncode != 0
    assert "overwrite" in second.stderr.lower()


def test_generate_starter_marks_manifest_synthetic(tmp_path: Path):
    out = tmp_path / "starter"
    result = _run("--output-dir", str(out), "--generate-starter", "--samples", "20")
    assert result.returncode == 0, result.stderr
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["synthetic"] is True
