"""Tests for adaptive inference cadence and dataset preparation."""

import numpy as np

from app.core.config import settings
from app.services.stream_service import StreamService


def test_settings_adaptive_cadence():
    """Verify adaptive cadence configuration defaults."""
    assert hasattr(settings, "ENABLE_ADAPTIVE_INFERENCE")
    assert settings.ENABLE_ADAPTIVE_INFERENCE is True
    assert settings.INFERENCE_INTERVAL_CLEAR == 30.0
    assert settings.INFERENCE_INTERVAL_BURST == 3.0


def test_stream_service_initial_interval():
    """Verify StreamService initializes to clear interval."""
    service = StreamService()
    assert service._current_inference_interval == settings.INFERENCE_INTERVAL_CLEAR


def test_adaptive_cadence_burst_transition():
    """Verify inference interval switches to burst when debris appears."""
    service = StreamService()
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    # Mock inference engine returning a detection
    class MockDetection:
        def __init__(self):
            self.box = [150.0, 200.0, 250.0, 300.0]
            self.confidence = 0.90
            self.class_id = 0
            self.class_name = "debris"

        def to_dict(self):
            return {"box": self.box, "confidence": self.confidence, "class_name": self.class_name}

    service._inference_engine.infer = lambda frame: [MockDetection()]

    # Run inference check
    service._last_inference_time = 0.0
    service._run_inference_if_due(dummy_frame)

    # Should have switched to burst interval
    assert service._current_inference_interval == settings.INFERENCE_INTERVAL_BURST
    assert service.latest_detection["interval_seconds"] == settings.INFERENCE_INTERVAL_BURST


def test_adaptive_cadence_return_to_clear():
    """Verify interval returns to CLEAR interval when debris clears."""
    service = StreamService()
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    # First trigger burst
    service._current_inference_interval = settings.INFERENCE_INTERVAL_BURST
    service._temporal_filter.history.clear()

    # Now mock empty detections
    service._inference_engine.infer = lambda frame: []

    # Run 3 iterations so 2-of-3 filter confirms CLEAR
    for _ in range(3):
        service._last_inference_time = 0.0
        service._run_inference_if_due(dummy_frame)

    # Should return to CLEAR interval
    assert service._current_inference_interval == settings.INFERENCE_INTERVAL_CLEAR
