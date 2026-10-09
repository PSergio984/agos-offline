"""Unit tests for AGOS-Offline Vision and Occlusion Geometry Engine."""

from pathlib import Path
import cv2
import numpy as np

from app.ml.inference import Detection, YOLOInference, draw_annotations
from app.ml.occlusion import (
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


def test_occlusion_geometry():
    """Test 3: Grate occlusion raster geometry, overlapping union area math, and normalized/polygon ROIs."""
    frame_shape = (1000, 1000)
    roi = [200, 200, 600, 600]  # 400x400 = 160,000 px

    # Sub-case 3.1: Zero debris
    res_clear = compute_occlusion(roi=roi, debris_boxes=[], frame_shape=frame_shape)
    assert res_clear.ratio == 0.0
    assert res_clear.status == OcclusionStatus.CLEAR

    # Sub-case 3.2: 30% coverage (WARNING)
    box_30 = [200, 200, 600, 320]
    res_warning = compute_occlusion(roi=roi, debris_boxes=[box_30], frame_shape=frame_shape)
    assert abs(res_warning.ratio - 30.0) < 0.5
    assert res_warning.status == OcclusionStatus.WARNING

    # Sub-case 3.3: Overlapping debris boxes (exact union calculation)
    # Box A: [200, 200, 400, 400], Box B: [300, 200, 500, 400]
    # Union area = 40,000 + 40,000 - 20,000 = 60,000 px -> 60,000 / 160,000 = 37.5%
    res_overlap = compute_occlusion(
        roi=roi,
        debris_boxes=[[200, 200, 400, 400], [300, 200, 500, 400]],
        frame_shape=frame_shape,
    )
    assert abs(res_overlap.ratio - 37.5) < 0.5

    # Sub-case 3.4: 75% coverage (CRITICAL)
    box_75 = [200, 200, 600, 500]
    res_critical = compute_occlusion(roi=roi, debris_boxes=[box_75], frame_shape=frame_shape)
    assert abs(res_critical.ratio - 75.0) < 0.5
    assert res_critical.status == OcclusionStatus.CRITICAL

    # Sub-case 3.5: Polygon ROI (trapezoid drainage grate)
    poly_roi = [[200, 200], [600, 200], [500, 500], [300, 500]]
    res_poly = compute_occlusion(roi=poly_roi, debris_boxes=[box_75], frame_shape=frame_shape)
    assert res_poly.ratio > 0.0

    # Sub-case 3.6: Normalized coordinates ROI [0.2, 0.2, 0.6, 0.6]
    norm_roi = [0.2, 0.2, 0.6, 0.6]
    res_norm = compute_occlusion(roi=norm_roi, debris_boxes=[box_30], frame_shape=(1000, 1000))
    assert abs(res_norm.ratio - 30.0) < 0.5


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
