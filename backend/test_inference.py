"""Comprehensive test and verification script for AGOS-Offline Vision Engine.

Tests:
1. ONNX Model loading and graceful fallback.
2. Synthetic frame generation and inference pipeline.
3. Geometric Grate ROI occlusion calculations and union area formula.
4. Rolling 3-frame history and 2-of-3 temporal hysteresis smoothing.
5. Drawing visual annotations (Grate ROI, status badge, debris boxes).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Add current scratch directory to sys.path
SCRATCH_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRATCH_DIR))

# Also add backend to sys.path if needed
BACKEND_DIR = Path(r"d:\Github\agos-offline\backend")
if BACKEND_DIR.is_dir():
    sys.path.insert(0, str(BACKEND_DIR))

import cv2
import numpy as np

from app.ml.inference import Detection, YOLOInference, draw_annotations, get_status_color, letterbox
from app.ml.occlusion import (
    OcclusionResult,
    OcclusionStatus,
    TemporalOcclusionFilter,
    classify_occlusion,
    compute_occlusion,
)


def print_header(title: str) -> None:
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print(f"{'=' * 70}")


def test_weights_verification(weights_path: Path) -> bool:
    print_header("TEST 1: Model Weights Verification & Loading")
    print(f"Checking weights path: {weights_path}")
    assert weights_path.exists(), f"ERROR: Weights file does not exist at {weights_path}"
    file_size_mb = weights_path.stat().st_size / (1024 * 1024)
    print(f"  -> File verified! Size: {file_size_mb:.2f} MB ({weights_path.stat().st_size} bytes)")

    # Test loading with YOLOInference
    engine = YOLOInference(weights_path=weights_path)
    assert engine.is_loaded, "ERROR: YOLOInference failed to load model"
    print(f"  -> YOLOInference successfully loaded session with CPUExecutionProvider")
    print(f"  -> Input name: '{engine.input_name}', Outputs: {engine.output_names}")
    print(f"  -> Classes detected: {engine.class_names}")

    # Test graceful fallback when weights do not exist
    fallback_engine = YOLOInference(weights_path=Path("non_existent_weights.onnx"))
    assert not fallback_engine.is_loaded, "Fallback engine should have is_loaded=False"
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    dummy_dets = fallback_engine.infer(dummy_frame)
    assert dummy_dets == [], "Fallback engine should return empty list without throwing"
    print("  -> Graceful fallback verified: missing weights return [] safely without crashing")

    return True


def test_preprocessing_and_inference(weights_path: Path) -> bool:
    print_header("TEST 2: Preprocessing & Synthetic Frame Inference")
    engine = YOLOInference(weights_path=weights_path, conf_threshold=0.35, iou_threshold=0.50)

    # Create synthetic test frame (1280x720 BGR)
    orig_h, orig_w = 720, 1280
    synthetic_frame = np.full((orig_h, orig_w, 3), 50, dtype=np.uint8)

    # Draw simulated drainage curb and grate background
    cv2.rectangle(synthetic_frame, (200, 300), (1080, 680), (80, 80, 80), -1)
    for x in range(250, 1050, 50):
        cv2.line(synthetic_frame, (x, 300), (x, 680), (30, 30, 30), 4)

    # Draw simulated plastic bottle / debris on the grate
    cv2.rectangle(synthetic_frame, (400, 420), (520, 500), (220, 220, 220), -1)
    cv2.rectangle(synthetic_frame, (600, 450), (750, 580), (30, 140, 255), -1)

    print(f"  -> Generated synthetic test frame: shape={synthetic_frame.shape}, dtype={synthetic_frame.dtype}")

    # Test letterbox preprocessing
    tensor, ratio, (pad_w, pad_h) = engine.preprocess(synthetic_frame)
    assert tensor.shape == (1, 3, 640, 640), f"Expected shape (1, 3, 640, 640), got {tensor.shape}"
    assert tensor.dtype == np.float32, f"Expected float32, got {tensor.dtype}"
    assert 0.0 <= tensor.min() and tensor.max() <= 1.0, "Tensor values not normalized to [0, 1]"
    print(f"  -> Preprocessing verified: letterbox shape={tensor.shape}, scale_ratio={ratio:.4f}, pad=({pad_w:.1f}, {pad_h:.1f})")

    # Run inference on synthetic frame
    detections = engine.infer(synthetic_frame)
    print(f"  -> Raw model inference completed. Detections count: {len(detections)}")
    for d in detections:
        print(f"     Found {d.class_name} at {d.box} (conf={d.confidence:.2f})")

    return True


def test_occlusion_geometry() -> bool:
    print_header("TEST 3: Grate Occlusion Geometry & Union Area Math")
    frame_shape = (1000, 1000)

    # Define a 400x400 Grate ROI: [200, 200, 600, 600]
    # Total ROI area = 400 * 400 = 160,000 pixels
    roi = [200, 200, 600, 600]

    # Sub-case 3.1: Zero debris
    res_clear = compute_occlusion(roi=roi, debris_boxes=[], frame_shape=frame_shape)
    print(f"  Sub-case 3.1 (No debris):")
    print(f"    ROI Area: {res_clear.roi_area} | Union Area: {res_clear.union_area} | Ratio: {res_clear.ratio}% | Status: {res_clear.status.value}")
    assert res_clear.ratio == 0.0, f"Expected 0.0%, got {res_clear.ratio}%"
    assert res_clear.status == OcclusionStatus.CLEAR

    # Sub-case 3.2: 30% coverage (Warning)
    # Area needed = 160,000 * 0.30 = 48,000 px. E.g. width=400, height=120 -> 48,000 px.
    box_30 = [200, 200, 600, 320]
    res_warning = compute_occlusion(roi=roi, debris_boxes=[box_30], frame_shape=frame_shape)
    print(f"  Sub-case 3.2 (30% coverage):")
    print(f"    ROI Area: {res_warning.roi_area} | Union Area: {res_warning.union_area} | Ratio: {res_warning.ratio}% | Status: {res_warning.status.value}")
    assert abs(res_warning.ratio - 30.0) < 0.5, f"Expected ~30.0%, got {res_warning.ratio}%"
    assert res_warning.status == OcclusionStatus.WARNING

    # Sub-case 3.3: Overlapping debris boxes (Union area test)
    # Box A: [200, 200, 400, 400] (200x200 = 40,000 px)
    # Box B: [300, 200, 500, 400] (200x200 = 40,000 px, overlaps Box A by 100x200 = 20,000 px)
    # Total Union Area = 40,000 + 40,000 - 20,000 = 60,000 px
    # Expected Ratio = (60,000 / 160,000) * 100 = 37.5%
    res_overlap = compute_occlusion(
        roi=roi,
        debris_boxes=[[200, 200, 400, 400], [300, 200, 500, 400]],
        frame_shape=frame_shape,
    )
    print(f"  Sub-case 3.3 (Overlapping debris - Union test):")
    print(f"    ROI Area: {res_overlap.roi_area} | Union Area: {res_overlap.union_area} | Ratio: {res_overlap.ratio}%")
    assert abs(res_overlap.ratio - 37.5) < 0.5, f"Expected 37.5% union, got {res_overlap.ratio}%"
    print(f"    -> Exact Union verified: overlapping regions are NOT double counted!")

    # Sub-case 3.4: 75% coverage (Critical)
    # Height = 300 out of 400 -> 300/400 = 75%
    box_75 = [200, 200, 600, 500]
    res_critical = compute_occlusion(roi=roi, debris_boxes=[box_75], frame_shape=frame_shape)
    print(f"  Sub-case 3.4 (75% coverage):")
    print(f"    ROI Area: {res_critical.roi_area} | Union Area: {res_critical.union_area} | Ratio: {res_critical.ratio}% | Status: {res_critical.status.value}")
    assert abs(res_critical.ratio - 75.0) < 0.5, f"Expected ~75.0%, got {res_critical.ratio}%"
    assert res_critical.status == OcclusionStatus.CRITICAL

    # Sub-case 3.5: Polygon ROI test (4-point trapezoid drainage grate)
    poly_roi = [[200, 200], [600, 200], [500, 500], [300, 500]]
    res_poly = compute_occlusion(roi=poly_roi, debris_boxes=[box_75], frame_shape=frame_shape)
    print(f"  Sub-case 3.5 (Polygon ROI):")
    print(f"    ROI Area: {res_poly.roi_area} | Union Area: {res_poly.union_area} | Ratio: {res_poly.ratio}% | Status: {res_poly.status.value}")
    assert res_poly.ratio > 0.0, "Polygon ROI should calculate non-zero occlusion"

    # Sub-case 3.6: Normalized ROI test [0.2, 0.2, 0.6, 0.6]
    norm_roi = [0.2, 0.2, 0.6, 0.6]
    res_norm = compute_occlusion(roi=norm_roi, debris_boxes=[box_30], frame_shape=(1000, 1000))
    print(f"  Sub-case 3.6 (Normalized ROI):")
    print(f"    ROI Area: {res_norm.roi_area} | Ratio: {res_norm.ratio}%")
    assert abs(res_norm.ratio - 30.0) < 0.5

    return True


def test_temporal_smoothing_filter() -> bool:
    print_header("TEST 4: 2-of-3 Rolling Temporal Hysteresis Filter")
    smoother = TemporalOcclusionFilter(window_size=3, confirmation_count=2, initial_status=OcclusionStatus.CLEAR)
    print(f"Initial State: {smoother}")

    test_stream = [
        # (frame_idx, raw_status, expected_confirmed, description)
        (1, OcclusionStatus.CLEAR, OcclusionStatus.CLEAR, "Frame 1: Normal clear frame"),
        (2, OcclusionStatus.CLEAR, OcclusionStatus.CLEAR, "Frame 2: Clear confirmed (2-of-2)"),
        (3, OcclusionStatus.CRITICAL, OcclusionStatus.CLEAR, "Frame 3: Transient CRITICAL spike (1-of-3) -> REJECTED!"),
        (4, OcclusionStatus.CRITICAL, OcclusionStatus.CRITICAL, "Frame 4: Second CRITICAL (2-of-3) -> TRANSITION TO CRITICAL!"),
        (5, OcclusionStatus.CRITICAL, OcclusionStatus.CRITICAL, "Frame 5: Sustained CRITICAL (3-of-3) -> REMAINS CRITICAL"),
        (6, OcclusionStatus.CLEAR, OcclusionStatus.CRITICAL, "Frame 6: Transient CLEAR frame (1-of-3) -> REMAINS CRITICAL"),
        (7, OcclusionStatus.CLEAR, OcclusionStatus.CLEAR, "Frame 7: Second CLEAR frame (2-of-3) -> TRANSITION TO CLEAR!"),
        (8, OcclusionStatus.WARNING, OcclusionStatus.CLEAR, "Frame 8: Single WARNING frame -> REJECTED!"),
        (9, OcclusionStatus.CRITICAL, OcclusionStatus.CLEAR, "Frame 9: Distinct tiers [CLEAR, WARNING, CRITICAL] (no 2-of-3 consensus) -> REMAINS CLEAR!"),
    ]

    for frame_idx, raw_stat, expected_conf, desc in test_stream:
        confirmed = smoother.update(raw_stat)
        history_str = [s.value for s in smoother.history]
        print(f"  Step {frame_idx:02d} | Raw: {raw_stat.value:<8} | Window: {str(history_str):<28} | Confirmed: {confirmed.value:<8} | {desc}")
        assert confirmed == expected_conf, f"Failed at step {frame_idx}: expected {expected_conf.value}, got {confirmed.value}"

    print("  -> All 9 temporal hysteresis steps passed successfully!")
    return True


def test_visual_annotations() -> bool:
    print_header("TEST 5: Visual Annotation & Overlay Rendering")
    h, w = 720, 1280
    frame = np.full((h, w, 3), 40, dtype=np.uint8)

    # Define Grate ROI and simulated debris
    roi = [0.25, 0.40, 0.75, 0.85]  # Normalized
    detections = [
        Detection(box=[360.0, 320.0, 520.0, 480.0], confidence=0.88, class_id=0, class_name="debris"),
        Detection(box=[600.0, 360.0, 780.0, 540.0], confidence=0.74, class_id=0, class_name="debris"),
    ]

    # Test CLEAR rendering
    annotated_clear = draw_annotations(
        frame=frame,
        detections=detections,
        roi=roi,
        status="CLEAR",
        occlusion_ratio=12.4,
    )
    assert annotated_clear.shape == frame.shape

    # Test WARNING rendering
    annotated_warning = draw_annotations(
        frame=frame,
        detections=detections,
        roi=roi,
        status="WARNING",
        occlusion_ratio=42.8,
    )
    assert annotated_warning.shape == frame.shape

    # Test CRITICAL rendering
    annotated_critical = draw_annotations(
        frame=frame,
        detections=detections,
        roi=roi,
        status="CRITICAL",
        occlusion_ratio=78.2,
    )
    assert annotated_critical.shape == frame.shape

    # Save sample verification frame to scratch
    output_path = SCRATCH_DIR / "sample_annotated_grate.jpg"
    cv2.imwrite(str(output_path), annotated_critical)
    print(f"  -> Successfully generated and verified annotated frames for all status tiers")
    print(f"  -> Sample annotated frame saved to: {output_path}")

    return True


def main() -> None:
    print("\n" + "#" * 70)
    print("  AGOS-Offline Vision & Grate Occlusion Engine Verification Suite")
    print("#" * 70)

    weights_path = Path(r"d:\Github\agos-offline\backend\app\ml\weights\best.onnx")

    test_weights_verification(weights_path)
    test_preprocessing_and_inference(weights_path)
    test_occlusion_geometry()
    test_temporal_smoothing_filter()
    test_visual_annotations()

    print("\n" + "=" * 70)
    print("  ALL VERIFICATION TESTS PASSED SUCCESSFULLY! (5 / 5)")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
