"""Unit tests for AGOS-Offline Vision and Occlusion Geometry Engine."""

from pathlib import Path
import cv2
import numpy as np

from app.ml.inference import Detection, YOLOInference, draw_annotations
from app.ml.occlusion import (
    DEFAULT_CLEAR_THRESHOLD,
    DEFAULT_CRITICAL_THRESHOLD,
    OcclusionStatus,
    TemporalOcclusionFilter,
    compute_occlusion,
)


def test_weights_verification(weights_path: Path):
    """Test 1: Verify ONNX weights exist, load on CPUExecutionProvider, and test graceful fallback."""
    assert weights_path.exists(), f"Weights file missing at {weights_path}"
    assert weights_path.stat().st_size > 0

    engine = YOLOInference(weights_path=weights_path)
    assert engine.is_loaded, "YOLOInference failed to load model"
    assert "CPUExecutionProvider" in engine.session.get_providers()
    assert engine.input_name != ""
    assert len(engine.output_names) > 0
    assert len(engine.class_names) > 0

    # Graceful fallback test for missing model weights
    fallback_engine = YOLOInference(weights_path=Path("non_existent_weights.onnx"))
    assert not fallback_engine.is_loaded
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    dummy_dets = fallback_engine.infer(dummy_frame)
    assert dummy_dets == []


def test_preprocessing_and_synthetic_inference(weights_path: Path):
    """Test 2: Preprocessing letterbox tensor shape (1, 3, 640, 640) and synthetic inference."""
    engine = YOLOInference(weights_path=weights_path, conf_threshold=0.35, iou_threshold=0.50)

    # Generate synthetic 1280x720 frame with simulated grate curb and debris
    orig_h, orig_w = 720, 1280
    synthetic_frame = np.full((orig_h, orig_w, 3), 50, dtype=np.uint8)
    cv2.rectangle(synthetic_frame, (200, 300), (1080, 680), (80, 80, 80), -1)
    for x in range(250, 1050, 50):
        cv2.line(synthetic_frame, (x, 300), (x, 680), (30, 30, 30), 4)
    cv2.rectangle(synthetic_frame, (400, 420), (520, 500), (220, 220, 220), -1)
    cv2.rectangle(synthetic_frame, (600, 450), (750, 580), (30, 140, 255), -1)

    tensor, ratio, (pad_w, pad_h) = engine.preprocess(synthetic_frame)
    assert tensor.shape == (1, 3, 640, 640)
    assert tensor.dtype == np.float32
    assert 0.0 <= tensor.min() and tensor.max() <= 1.0

    detections = engine.infer(synthetic_frame)
    assert isinstance(detections, list)


def _original_coverage_pct(boxes, frame_w):
    """Reference copy of the original system's _compute_coverage_pct (union of x-spans / frame width)."""
    spans = []
    for x1, y1, x2, y2 in boxes:
        x1i, x2i = max(0, int(x1)), min(frame_w, int(x2))
        if x2i > x1i and y2 > y1:
            spans.append((x1i, x2i))
    spans.sort()
    merged = []
    for start, end in spans:
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return round(100.0 * sum(e - s for s, e in merged) / frame_w, 2) if merged else 0.0


def test_occlusion_geometry():
    """Test 3: Width-span coverage: merged horizontal span of debris clipped to the ROI x-range / ROI width."""
    assert DEFAULT_CLEAR_THRESHOLD == 20.0
    assert DEFAULT_CRITICAL_THRESHOLD == 60.0

    frame_shape = (1000, 1000)
    roi = [200, 200, 600, 600]  # 400 px wide

    # No boxes
    res = compute_occlusion(roi=roi, debris_boxes=[], frame_shape=frame_shape)
    assert res.ratio == 0.0
    assert res.covered_width == 0.0
    assert res.status == OcclusionStatus.CLEAR

    # One box: 120 of 400 columns -> 30% (WARNING); height does not matter
    res = compute_occlusion(roi=roi, debris_boxes=[[200, 200, 320, 600]], frame_shape=frame_shape)
    assert res.ratio == 30.0
    assert res.covered_width == 120.0
    assert res.status == OcclusionStatus.WARNING
    assert res.to_dict()["covered_width"] == 120.0
    short = compute_occlusion(roi=roi, debris_boxes=[[200, 400, 320, 420]], frame_shape=frame_shape)
    assert short.ratio == 30.0

    # 20% is WARNING (clear is strictly below 20), 19.75% is CLEAR
    assert compute_occlusion(roi=roi, debris_boxes=[[200, 300, 280, 400]], frame_shape=frame_shape).status == OcclusionStatus.WARNING
    assert compute_occlusion(roi=roi, debris_boxes=[[200, 300, 279, 400]], frame_shape=frame_shape).status == OcclusionStatus.CLEAR

    # Overlapping spans merge without double counting: 200..500 = 300 px -> 75% (CRITICAL)
    res = compute_occlusion(
        roi=roi,
        debris_boxes=[[200, 200, 400, 400], [300, 200, 500, 400]],
        frame_shape=frame_shape,
    )
    assert res.ratio == 75.0
    assert res.covered_width == 300.0
    assert res.status == OcclusionStatus.CRITICAL
    assert res.debris_count == 2
    assert len(res.intersecting_boxes) == 2

    # Tall and short boxes in the same columns count once: 250..450 = 200 px -> 50%
    res = compute_occlusion(
        roi=roi,
        debris_boxes=[[250, 200, 450, 600], [250, 300, 450, 350]],
        frame_shape=frame_shape,
    )
    assert res.ratio == 50.0

    # Boxes outside the ROI (left, right, above, below, edge-touching) are ignored
    outside = [
        [20, 250, 150, 500],
        [700, 250, 900, 500],
        [250, 0, 500, 150],
        [250, 700, 500, 900],
        [250, 100, 500, 200],
        [600, 250, 800, 500],
    ]
    res = compute_occlusion(roi=roi, debris_boxes=outside, frame_shape=frame_shape)
    assert res.ratio == 0.0
    assert res.covered_width == 0.0
    assert res.intersecting_boxes == []
    assert res.status == OcclusionStatus.CLEAR

    # Partly outside boxes are clipped to the ROI x-range: 100..300 -> 200..300 = 25%
    res = compute_occlusion(roi=roi, debris_boxes=[[100, 250, 300, 500]], frame_shape=frame_shape)
    assert res.ratio == 25.0
    res = compute_occlusion(roi=roi, debris_boxes=[[500, 250, 900, 500]], frame_shape=frame_shape)
    assert res.ratio == 25.0

    # Full-frame ROI equals the original system's number
    full_frame = (720, 1280)
    boxes = [
        [10.7, 100, 300.9, 200],
        [250.2, 300, 640.5, 400],
        [1200, 0, 1400, 100],
        [700, 50, 760, 60],
    ]
    res = compute_occlusion(roi=[0.0, 0.0, 1.0, 1.0], debris_boxes=boxes, frame_shape=full_frame)
    assert res.ratio == _original_coverage_pct(boxes, 1280)
    assert res.ratio > 0.0
    res = compute_occlusion(roi=[0, 0, 1280, 720], debris_boxes=boxes, frame_shape=full_frame)
    assert res.ratio == _original_coverage_pct(boxes, 1280)

    # Polygon ROI uses its bounding rect (x 200..600, y 200..500)
    poly_roi = [[200, 200], [600, 200], [500, 500], [300, 500]]
    res = compute_occlusion(roi=poly_roi, debris_boxes=[[250, 250, 350, 400]], frame_shape=frame_shape)
    assert res.ratio == 25.0
    res = compute_occlusion(roi=poly_roi, debris_boxes=[[400, 520, 600, 600]], frame_shape=frame_shape)
    assert res.ratio == 0.0

    # Normalized ROI [0.2, 0.2, 0.6, 0.6]
    res = compute_occlusion(roi=[0.2, 0.2, 0.6, 0.6], debris_boxes=[[200, 200, 320, 600]], frame_shape=(1000, 1000))
    assert abs(res.ratio - 30.0) < 0.5


def test_temporal_smoothing_filter():
    """Test 4: 2-of-3 rolling temporal hysteresis filter behavior under transient and sustained states."""
    smoother = TemporalOcclusionFilter(window_size=3, confirmation_count=2, initial_status=OcclusionStatus.CLEAR)

    test_stream = [
        (OcclusionStatus.CLEAR, OcclusionStatus.CLEAR),     # Frame 1
        (OcclusionStatus.CLEAR, OcclusionStatus.CLEAR),     # Frame 2
        (OcclusionStatus.CRITICAL, OcclusionStatus.CLEAR),  # Frame 3: 1-of-3 CRITICAL rejected
        (OcclusionStatus.CRITICAL, OcclusionStatus.CRITICAL),  # Frame 4: 2-of-3 CRITICAL accepted
        (OcclusionStatus.CRITICAL, OcclusionStatus.CRITICAL),  # Frame 5: Sustained CRITICAL
        (OcclusionStatus.CLEAR, OcclusionStatus.CRITICAL),  # Frame 6: 1-of-3 CLEAR rejected
        (OcclusionStatus.CLEAR, OcclusionStatus.CLEAR),     # Frame 7: 2-of-3 CLEAR accepted
        (OcclusionStatus.WARNING, OcclusionStatus.CLEAR),   # Frame 8: 1-of-3 WARNING rejected
        (OcclusionStatus.CRITICAL, OcclusionStatus.CLEAR),  # Frame 9: No 2-of-3 consensus -> stays CLEAR
    ]

    for idx, (raw_status, expected_confirmed) in enumerate(test_stream, start=1):
        confirmed = smoother.update(raw_status)
        assert confirmed == expected_confirmed, f"Failed at step {idx}: got {confirmed.value}, expected {expected_confirmed.value}"


def test_visual_annotations(tmp_path: Path):
    """Test 5: Visual annotations rendering (CLEAR, WARNING, CRITICAL) using temporary directory."""
    h, w = 720, 1280
    frame = np.full((h, w, 3), 40, dtype=np.uint8)
    roi = [0.25, 0.40, 0.75, 0.85]
    detections = [
        Detection(box=[360.0, 320.0, 520.0, 480.0], confidence=0.88, class_id=0, class_name="debris"),
        Detection(box=[600.0, 360.0, 780.0, 540.0], confidence=0.74, class_id=0, class_name="debris"),
    ]

    annotated_clear = draw_annotations(frame=frame, detections=detections, roi=roi, status="CLEAR", occlusion_ratio=12.4)
    assert annotated_clear.shape == frame.shape

    annotated_warning = draw_annotations(frame=frame, detections=detections, roi=roi, status="WARNING", occlusion_ratio=42.8)
    assert annotated_warning.shape == frame.shape

    annotated_critical = draw_annotations(frame=frame, detections=detections, roi=roi, status="CRITICAL", occlusion_ratio=78.2)
    assert annotated_critical.shape == frame.shape

    # Save to tmp_path without polluting root repository
    output_path = tmp_path / "sample_annotated_grate.jpg"
    success = cv2.imwrite(str(output_path), annotated_critical)
    assert success
    assert output_path.exists()
    assert output_path.stat().st_size > 0
