"""Tests for the coverage gate in ml_pipeline/evaluate.py and export_and_benchmark.py.

No GPU, no network and no real model: tiny synthetic images, YOLO label files and a stubbed detector.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

import sys

ML_DIR = Path(__file__).resolve().parents[2] / "ml_pipeline"
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

import evaluate  # noqa: E402
import export_and_benchmark as ebm  # noqa: E402

W, H = 200, 100


def _norm_label(x1: float, x2: float) -> str:
    """YOLO label line for a full-height box spanning pixel columns x1..x2."""
    return f"0 {(x1 + x2) / 2 / W:.6f} 0.5 {(x2 - x1) / W:.6f} 1.0\n"


def make_dataset(tmp_path: Path, positives: list[tuple[int, int]], negatives: int):
    """Write a dataset; image k is filled with value k so the stub detector can identify it.

    positives: true (x1, x2) pixel span per positive image. Returns (data_yaml, predictions_by_id).
    """
    root = tmp_path / "ds"
    (root / "images" / "val").mkdir(parents=True)
    (root / "labels" / "val").mkdir(parents=True)
    spans = list(positives) + [None] * negatives
    for k, span in enumerate(spans, start=1):
        cv2.imwrite(str(root / "images" / "val" / f"img{k:03d}.png"), np.full((H, W, 3), k, np.uint8))
        label = _norm_label(*span) if span else ""
        (root / "labels" / "val" / f"img{k:03d}.txt").write_text(label)
    data_yaml = root / "data.yaml"
    data_yaml.write_text(f"path: {root.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: debris\n")
    return data_yaml


def stub_detector(predicted: dict[int, tuple[int, int]]):
    """Detector returning one full-height box per image id (frame[0,0,0]) listed in `predicted`."""

    def detect(frame: np.ndarray) -> list[list[float]]:
        span = predicted.get(int(frame[0, 0, 0]))
        return [[float(span[0]), 0.0, float(span[1]), float(H)]] if span else []

    return detect


# ---------------------------------------------------------------- pure gate logic


def _records(true_pred: list[tuple[float, float]], negatives: list[float]) -> list[dict]:
    recs = [{"name": f"p{i}", "true": t, "pred": p, "positive": True} for i, (t, p) in enumerate(true_pred)]
    recs += [{"name": f"n{i}", "true": 0.0, "pred": p, "positive": False} for i, p in enumerate(negatives)]
    return recs


def _gate(recs, **kw):
    metrics = evaluate.summarize_coverage(recs)
    return metrics, ebm.apply_gate(metrics, **{"min_within_fraction": 0.80,
                                               "max_neg_fp_rate": 0.10, "min_neg_images": 20, **kw})


def test_gate_pass_path():
    recs = _records([(50.0, 50.0)] * 9 + [(50.0, 64.0)], [0.0] * 20)
    metrics, gate = _gate(recs)
    assert gate["passed"] and gate["failures"] == [] and gate["negatives_checked"]
    assert metrics["within_fraction"] == 1.0
    assert metrics["median_abs_error"] == 0.0
    assert metrics["p90_abs_error"] == pytest.approx(1.4)
    assert metrics["positive_images"] == 10 and metrics["negative_images"] == 20
    assert metrics["negative_fp_rate"] == 0.0


def test_gate_tolerance_is_inclusive_at_15_points():
    _, gate = _gate(_records([(50.0, 65.0)] * 10, [0.0] * 20))
    assert gate["passed"]
    _, gate = _gate(_records([(50.0, 65.5)] * 10, [0.0] * 20))
    assert not gate["passed"]


def test_gate_fails_when_too_many_positives_exceed_tolerance():
    recs = _records([(50.0, 50.0)] * 7 + [(50.0, 5.0)] * 3, [0.0] * 20)
    metrics, gate = _gate(recs)
    assert not gate["passed"]
    assert metrics["within_fraction"] == pytest.approx(0.7)
    assert any("within" in r for r in gate["failures"])


def test_gate_exactly_80_percent_within_passes():
    recs = _records([(50.0, 50.0)] * 8 + [(50.0, 5.0)] * 2, [0.0] * 20)
    assert _gate(recs)[1]["passed"]


def test_gate_fails_on_negative_false_coverage():
    recs = _records([(50.0, 50.0)] * 10, [0.0] * 17 + [20.0, 35.0, 80.0])
    metrics, gate = _gate(recs)
    assert metrics["negative_fp_rate"] == pytest.approx(0.15)
    assert not gate["passed"] and any("negative" in r for r in gate["failures"])


def test_negative_below_warning_threshold_is_not_false_coverage():
    recs = _records([(50.0, 50.0)] * 10, [19.99] * 20)
    assert _gate(recs)[1]["passed"]


def test_gate_fails_closed_without_enough_negatives():
    recs = _records([(50.0, 50.0)] * 10, [0.0] * 5)
    _, gate = _gate(recs)
    assert not gate["passed"]
    assert any("negative" in r and "20" in r for r in gate["failures"])


def test_allow_no_negatives_passes_but_is_flagged_unchecked():
    recs = _records([(50.0, 50.0)] * 10, [])
    _, gate = _gate(recs, allow_no_negatives=True)
    assert gate["passed"] and gate["negatives_checked"] is False
    assert "negatives not checked" in gate["note"]


def test_allow_no_negatives_still_fails_on_positive_error():
    recs = _records([(50.0, 5.0)] * 10, [])
    assert not _gate(recs, allow_no_negatives=True)[1]["passed"]


def test_no_positive_images_fails():
    _, gate = _gate(_records([], [0.0] * 20))
    assert not gate["passed"]


def test_status_agreement_reported():
    recs = _records([(10.0, 10.0), (30.0, 30.0), (70.0, 70.0), (70.0, 10.0)], [0.0])
    metrics = evaluate.summarize_coverage(recs)
    assert metrics["status_agreement"] == pytest.approx(4 / 5)


# ---------------------------------------------------------------- coverage from files


def test_build_records_uses_production_coverage_formula(tmp_path):
    data_yaml = make_dataset(tmp_path, positives=[(0, 100), (50, 150)], negatives=1)
    images_dir, labels_dir = evaluate.resolve_val_dirs(data_yaml)
    detect = stub_detector({1: (0, 100), 2: (50, 100), 3: (0, 60)})
    recs = evaluate.build_coverage_records(detect, images_dir, labels_dir)
    assert [(r["true"], r["pred"], r["positive"]) for r in recs] == [
        (50.0, 50.0, True), (50.0, 25.0, True), (0.0, 30.0, False)]


def test_build_records_reads_nested_batch_folders(tmp_path):
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)], negatives=0)
    images_dir, labels_dir = evaluate.resolve_val_dirs(data_yaml)
    (images_dir / "batch_1").mkdir()
    (labels_dir / "batch_1").mkdir()
    (images_dir / "img001.png").rename(images_dir / "batch_1" / "img001.png")
    (labels_dir / "img001.txt").rename(labels_dir / "batch_1" / "img001.txt")
    recs = evaluate.build_coverage_records(stub_detector({1: (0, 100)}), images_dir, labels_dir)
    assert [(r["name"], r["true"], r["pred"]) for r in recs] == [("batch_1/img001.png", 50.0, 50.0)]


def test_resolve_val_dirs_relative_path(tmp_path):
    root = tmp_path / "d"
    (root / "images" / "val").mkdir(parents=True)
    (root / "data.yaml").write_text("train: images/train\nval: images/val\nnames:\n  0: debris\n")
    images_dir, labels_dir = evaluate.resolve_val_dirs(root / "data.yaml")
    assert images_dir == root / "images" / "val" and labels_dir == root / "labels" / "val"


# ---------------------------------------------------------------- CLI / deploy behaviour


@pytest.fixture
def wired(tmp_path, monkeypatch):
    """Redirect production weights to a temp dir and stub model-dependent steps."""
    prod_dir = tmp_path / "weights"
    prod_dir.mkdir()
    prod = prod_dir / "best.onnx"
    prod.write_bytes(b"OLD-WEIGHTS")
    new = tmp_path / "new.onnx"
    new.write_bytes(b"NEW-WEIGHTS")
    monkeypatch.setattr(ebm, "PROD_WEIGHTS", prod)
    monkeypatch.setattr(ebm, "check_contract", lambda p: [])
    monkeypatch.setattr(ebm, "benchmark_cpu", lambda *a, **k: {
        "mean_latency_ms": 1.0, "p95_latency_ms": 1.0, "effective_cpu_fps": 1000.0,
        "iterations": 1, "intra_op_threads": 4, "model_size_mb": 0.0})

    def run(data_yaml, predicted, *extra):
        monkeypatch.setattr(ebm.evaluate, "load_detector", lambda *a, **k: stub_detector(predicted))
        return ebm.main(["--weights", str(new), "--data", str(data_yaml),
                         "--report-dir", str(tmp_path / "gate"), *extra])

    return run, prod, prod_dir, tmp_path / "gate"


def test_failing_gate_exits_2_and_leaves_production_weights_untouched(tmp_path, wired):
    run, prod, prod_dir, report_dir = wired
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)] * 10, negatives=20)
    wrong = {k: (150, 200) for k in range(1, 11)}  # 25% vs 50% true: 25 points off
    assert run(data_yaml, wrong, "--deploy") == 2
    assert prod.read_bytes() == b"OLD-WEIGHTS"
    assert sorted(p.name for p in prod_dir.iterdir()) == ["best.onnx"]
    report = json.loads((report_dir / "gate_report.json").read_text())
    assert report["gate_passed"] is False
    assert (report_dir / "gate_report.md").is_file()


def test_missing_negatives_exits_2_unless_allowed(tmp_path, wired):
    run, prod, prod_dir, report_dir = wired
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)] * 10, negatives=0)
    right = {k: (0, 100) for k in range(1, 11)}
    assert run(data_yaml, right, "--deploy") == 2
    assert prod.read_bytes() == b"OLD-WEIGHTS"

    assert run(data_yaml, right, "--allow-no-negatives") == 0
    report = json.loads((report_dir / "gate_report.json").read_text())
    assert report["gate_passed"] is True and report["negatives_checked"] is False
    assert "negatives not checked" in (report_dir / "gate_report.md").read_text()
    assert prod.read_bytes() == b"OLD-WEIGHTS"  # passing without --deploy never deploys


def test_passing_gate_with_deploy_backs_up_and_writes_sidecar(tmp_path, wired):
    run, prod, prod_dir, _ = wired
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)] * 10, negatives=20)
    right = {k: (0, 100) for k in range(1, 11)}
    assert run(data_yaml, right, "--deploy") == 0
    assert prod.read_bytes() == b"NEW-WEIGHTS"
    backups = list(prod_dir.glob("best.previous.*.onnx"))
    assert len(backups) == 1 and backups[0].read_bytes() == b"OLD-WEIGHTS"
    sidecar = json.loads((prod_dir / "best.onnx.json").read_text())
    assert sidecar["sha256"] == ebm.sha256_of(prod)
    assert sidecar["size_bytes"] == len(b"NEW-WEIGHTS")
    assert sidecar["license"] == "AGPL-3.0 (Ultralytics YOLOv8)"
    assert sidecar["validated_on"] == "public data only"
    assert sidecar["metrics"]["within_fraction"] == 1.0
    assert sidecar["metrics"]["median_abs_error"] == 0.0
    assert sidecar["negatives_checked"] is True


def test_deploy_with_allow_no_negatives_marks_sidecar(tmp_path, wired):
    run, prod, prod_dir, _ = wired
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)] * 10, negatives=0)
    right = {k: (0, 100) for k in range(1, 11)}
    assert run(data_yaml, right, "--deploy", "--allow-no-negatives") == 0
    sidecar = json.loads((prod_dir / "best.onnx.json").read_text())
    assert sidecar["negatives_checked"] is False
    assert "negatives not checked" in sidecar["gate_note"]


# ---------------------------------------------------------------- explicit, recorded gate override

OVERRIDE_REASON = "User decision: only model passing the stage demo replay; validated on public data only"


def _failing_dataset(tmp_path):
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)] * 10, negatives=20)
    wrong = {k: (150, 200) for k in range(1, 11)}  # 25 points off on every positive
    return data_yaml, wrong


def test_failing_gate_with_deploy_and_no_override_still_exits_2_without_backup_or_sidecar(tmp_path, wired):
    run, prod, prod_dir, _ = wired
    data_yaml, wrong = _failing_dataset(tmp_path)
    assert run(data_yaml, wrong, "--deploy") == 2
    assert prod.read_bytes() == b"OLD-WEIGHTS"
    assert [p.name for p in prod_dir.iterdir()] == ["best.onnx"]  # no backup, no sidecar


def test_override_with_failing_gate_deploys_backs_up_and_records_override(tmp_path, wired, caplog):
    run, prod, prod_dir, report_dir = wired
    data_yaml, wrong = _failing_dataset(tmp_path)
    assert run(data_yaml, wrong, "--deploy", "--override-gate", OVERRIDE_REASON) == 0
    assert prod.read_bytes() == b"NEW-WEIGHTS"
    backups = list(prod_dir.glob("best.previous.*.onnx"))
    assert len(backups) == 1 and backups[0].read_bytes() == b"OLD-WEIGHTS"

    sidecar = json.loads((prod_dir / "best.onnx.json").read_text())
    assert sidecar["gate_passed"] is False
    assert sidecar["gate_overridden"] is True
    assert sidecar["override_reason"] == OVERRIDE_REASON
    assert sidecar["gate_failures"] and any("within" in f for f in sidecar["gate_failures"])
    assert sidecar["metrics"]["within_fraction"] == 0.0
    assert sidecar["validated_on"] == "public data only"
    assert sidecar["license"] == "AGPL-3.0 (Ultralytics YOLOv8)"
    assert sidecar["sha256"] == ebm.sha256_of(prod)
    assert sidecar["model_version"].endswith("-gate-overridden")

    report = json.loads((report_dir / "gate_report.json").read_text())
    assert report["gate_passed"] is False and report["gate_overridden"] is True
    assert report["override_reason"] == OVERRIDE_REASON
    md = (report_dir / "gate_report.md").read_text()
    assert "OVERRIDDEN" in md and OVERRIDE_REASON in md
    assert "GATE OVERRIDDEN" in caplog.text


def test_override_without_deploy_does_not_deploy(tmp_path, wired):
    run, prod, prod_dir, report_dir = wired
    data_yaml, wrong = _failing_dataset(tmp_path)
    assert run(data_yaml, wrong, "--override-gate", OVERRIDE_REASON) == 2
    assert prod.read_bytes() == b"OLD-WEIGHTS"
    assert [p.name for p in prod_dir.iterdir()] == ["best.onnx"]
    assert json.loads((report_dir / "gate_report.json").read_text())["gate_overridden"] is False


def test_override_with_passing_gate_is_a_normal_deploy(tmp_path, wired):
    run, prod, prod_dir, _ = wired
    data_yaml = make_dataset(tmp_path, positives=[(0, 100)] * 10, negatives=20)
    right = {k: (0, 100) for k in range(1, 11)}
    assert run(data_yaml, right, "--deploy", "--override-gate", OVERRIDE_REASON) == 0
    assert prod.read_bytes() == b"NEW-WEIGHTS"
    sidecar = json.loads((prod_dir / "best.onnx.json").read_text())
    assert sidecar["gate_passed"] is True and sidecar["gate_overridden"] is False
    assert sidecar["override_reason"] is None and sidecar["gate_failures"] == []
    assert not sidecar["model_version"].endswith("-gate-overridden")


@pytest.mark.parametrize("reason", ["", "   ", "\t\n"])
def test_blank_override_reason_is_rejected(tmp_path, wired, reason):
    run, prod, prod_dir, _ = wired
    data_yaml, wrong = _failing_dataset(tmp_path)
    with pytest.raises(SystemExit) as exc:
        run(data_yaml, wrong, "--deploy", "--override-gate", reason)
    assert exc.value.code != 0
    assert prod.read_bytes() == b"OLD-WEIGHTS"
    assert [p.name for p in prod_dir.iterdir()] == ["best.onnx"]
