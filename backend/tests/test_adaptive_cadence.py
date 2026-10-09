"""Tests for adaptive inference cadence, incident lifecycle and dataset preparation."""

import json
import sqlite3

import numpy as np

from app.core.config import settings
from app.ml.occlusion import compute_occlusion
from app.services.stream_service import StreamService

FRAME = np.zeros((480, 640, 3), dtype=np.uint8)
# Default ROI is the full frame [0, 0, 1, 1]: 640x480 pixels
ROI_PX = (0.0, 0.0, 640.0, 480.0)


class FakeClock:
    """Manually advanced clock injected into StreamService."""

    def __init__(self, start: float = 1_700_000_000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class MockDetection:
    def __init__(self, box):
        self.box = list(box)
        self.confidence = 0.90
        self.class_id = 0
        self.class_name = "debris"

    def to_dict(self):
        return {"box": self.box, "confidence": self.confidence, "class_name": self.class_name}


def _square(side: int):
    x1, y1 = ROI_PX[0], ROI_PX[1]
    return [x1, y1, x1 + side, y1 + side]


def _ratio_of_square(side: int) -> float:
    return compute_occlusion(
        roi=settings.DEFAULT_ROI, debris_boxes=[_square(side)], frame_shape=FRAME.shape
    ).ratio


def _square_at_least(percent: float):
    """Smallest square box whose raw occlusion ratio is >= percent; also returns the next smaller one."""
    for side in range(1, 400):
        if _ratio_of_square(side) >= percent:
            return _square(side), _square(side - 1)
    raise AssertionError("no square box reaches requested ratio")


def _band_box(fraction: float):
    """Full-height box covering `fraction` of the ROI width (coverage is width based)."""
    x1, y1, x2, y2 = ROI_PX
    return [x1, y1, x1 + (x2 - x1) * fraction, y2]


FULL_ROI_BOX = list(ROI_PX)


class Harness:
    """Drives StreamService through its inference path with a fake clock and mock engine."""

    def __init__(self):
        self.clock = FakeClock()
        self.service = StreamService(clock=self.clock)
        self.boxes: list = []
        self.service._inference_engine.infer = lambda frame: [MockDetection(b) for b in self.boxes]

    def step(self, seconds: float, boxes=None):
        """Advance the clock, set detections, and run one inference check."""
        self.clock.advance(seconds)
        self.boxes = [] if boxes is None else boxes
        self.service._run_inference_if_due(FRAME)

    @property
    def interval(self) -> float:
        return self.service.latest_detection["interval_seconds"]

    @property
    def status(self) -> str:
        return self.service.latest_detection["status"]


def _incidents():
    conn = sqlite3.connect(str(settings.DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM incidents ORDER BY timestamp, id")]
    finally:
        conn.close()


def test_settings_adaptive_cadence():
    """Verify adaptive cadence configuration defaults."""
    assert hasattr(settings, "ENABLE_ADAPTIVE_INFERENCE")
    assert settings.ENABLE_ADAPTIVE_INFERENCE is True
    assert settings.INFERENCE_INTERVAL_CLEAR == 15.0
    assert settings.INFERENCE_INTERVAL_BURST == 3.0
    assert settings.INFERENCE_INTERVAL_SETTLED == 10.0
    assert settings.BURST_ENTER_RATIO == 2.0
    assert settings.BURST_MIN_DWELL_SECONDS == 15.0
    assert settings.BURST_CLEAN_INFERENCES_TO_EXIT == 3
    assert settings.BURST_EXIT_COOLDOWN_SECONDS == 60.0


def test_stream_service_initial_interval():
    """Verify StreamService initializes to clear interval."""
    service = StreamService()
    assert service._current_inference_interval == settings.INFERENCE_INTERVAL_CLEAR


def test_adaptive_cadence_burst_transition():
    """Verify inference interval switches to burst when debris appears."""
    service = StreamService()
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)

    # Mock inference engine returning a detection
    service._inference_engine.infer = lambda frame: [MockDetection([150.0, 200.0, 250.0, 300.0])]

    # Run inference check
    service._last_inference_time = 0.0
    service._run_inference_if_due(dummy_frame)

    # Should have switched to burst interval
    assert service._current_inference_interval == settings.INFERENCE_INTERVAL_BURST
    assert service.latest_detection["interval_seconds"] == settings.INFERENCE_INTERVAL_BURST


def test_adaptive_cadence_return_to_clear():
    """Burst only returns to CLEAR after cooldown, dwell and consecutive clean inferences."""
    h = Harness()
    h.step(1, [list(_square_at_least(settings.BURST_ENTER_RATIO)[0])])
    assert h.interval == settings.INFERENCE_INTERVAL_BURST

    # Immediately clean: the old behaviour dropped to CLEAR here. It must stay in BURST.
    for _ in range(3):
        h.step(3)
    assert h.interval == settings.INFERENCE_INTERVAL_BURST

    # 60 s after the alert (9 s so far) the cooldown is met, with 3+ clean inferences behind it
    h.step(51)
    assert h.interval == settings.INFERENCE_INTERVAL_CLEAR


def test_burst_threshold_boundary():
    """No burst just below 2.0 percent raw ratio; burst at 2.0 percent."""
    at_threshold, just_below = _square_at_least(settings.BURST_ENTER_RATIO)
    assert _ratio_of_square(int(just_below[2] - just_below[0])) < settings.BURST_ENTER_RATIO

    below = Harness()
    below.step(1, [just_below])
    assert below.interval == settings.INFERENCE_INTERVAL_CLEAR

    at = Harness()
    at.step(1, [at_threshold])
    assert at.interval == settings.INFERENCE_INTERVAL_BURST


def test_burst_holds_until_cooldown_since_last_alert():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])  # alert at t=1
    assert h.interval == settings.INFERENCE_INTERVAL_BURST

    # clean readings every 3 s; 57 s after the alert is still inside the 60 s cooldown
    for _ in range(19):
        h.step(3)
    assert h.interval == settings.INFERENCE_INTERVAL_BURST

    h.step(3)  # 60 s after the alert
    assert h.interval == settings.INFERENCE_INTERVAL_CLEAR


def test_burst_exit_requires_three_clean_inferences_after_cooldown():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    assert h.interval == settings.INFERENCE_INTERVAL_BURST

    h.step(120)  # long idle; cooldown and dwell long elapsed, clean inference #1
    assert h.interval == settings.INFERENCE_INTERVAL_BURST
    h.step(3)  # clean #2
    assert h.interval == settings.INFERENCE_INTERVAL_BURST
    h.step(3)  # clean #3
    assert h.interval == settings.INFERENCE_INTERVAL_CLEAR


def test_sustained_critical_settles_then_drops_back_on_clean_reading():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    # confirmed CRITICAL after the second reading; dwell of 15 s counts from there
    h.step(3, [FULL_ROI_BOX])
    assert h.status == "CRITICAL"
    for _ in range(4):  # 12 s into the dwell
        h.step(3, [FULL_ROI_BOX])
        assert h.interval == settings.INFERENCE_INTERVAL_BURST
    h.step(3, [FULL_ROI_BOX])  # 15 s
    assert h.interval == settings.INFERENCE_INTERVAL_SETTLED

    h.step(settings.INFERENCE_INTERVAL_SETTLED, [FULL_ROI_BOX])
    assert h.interval == settings.INFERENCE_INTERVAL_SETTLED

    # First non-critical raw reading drops to BURST even though confirmed is still CRITICAL
    h.step(settings.INFERENCE_INTERVAL_SETTLED, [])
    assert h.status == "CRITICAL"
    assert h.interval == settings.INFERENCE_INTERVAL_BURST


def test_stale_history_does_not_confirm_or_create_incident():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    h.step(20, [FULL_ROI_BOX])  # idle gap well over 2x burst interval
    assert h.status == "CLEAR"
    assert _incidents() == []


def test_settled_gap_does_not_wipe_hysteresis():
    """A 10 s SETTLED gap must not clear history, so CRITICAL can still be cleared by two clean readings."""
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    for _ in range(6):
        h.step(3, [FULL_ROI_BOX])
    assert h.interval == settings.INFERENCE_INTERVAL_SETTLED

    h.step(10, [])  # demotes to BURST, still CRITICAL (history intact)
    assert h.status == "CRITICAL"
    h.step(3, [])
    assert h.status == "CLEAR"


def test_sustained_critical_keeps_single_open_incident_and_updates_it():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    h.step(3, [FULL_ROI_BOX])
    rows = _incidents()
    assert len(rows) == 1
    first = rows[0]
    assert first["is_open"] == 1
    assert first["status"] == "CRITICAL"
    assert first["source_type"] == "demo"
    assert first["cloud_synced"] == 0

    # Several simulated minutes of CRITICAL (70 percent width coverage, 2 boxes): the same
    # open incident is refreshed with the latest measurements instead of a new one being opened
    for _ in range(40):
        h.step(10, [_band_box(0.7), [0.0, 0.0, 100.0, 100.0]])
    assert h.status == "CRITICAL"
    rows = _incidents()
    assert len(rows) == 1
    last = rows[0]
    assert last["id"] == first["id"]
    assert last["is_open"] == 1
    assert last["debris_count"] == 2
    assert last["occlusion_ratio"] == h.service.latest_detection["occlusion_ratio"] == 70.0
    assert last["duration_seconds"] > 300
    # fields the updater must never touch
    for key in ("radio_ticket", "synced", "image_path", "status", "timestamp"):
        assert last[key] == first[key]

    conn = sqlite3.connect(str(settings.DATABASE_PATH))
    try:
        queue = conn.execute("SELECT status, payload FROM sync_queue").fetchall()
    finally:
        conn.close()
    assert len(queue) == 1
    assert queue[0][0] == "PENDING"
    payload = json.loads(queue[0][1])
    assert set(payload) == {
        "id", "camera_id", "timestamp", "occlusion_ratio", "status",
        "debris_count", "image_path", "radio_ticket",
    }
    assert payload["occlusion_ratio"] == last["occlusion_ratio"]


def test_incident_closes_only_on_confirmed_clear_and_reblock_opens_second():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    h.step(3, [FULL_ROI_BOX])
    assert len(_incidents()) == 1

    h.step(3, [])  # single clean reading: history [CRIT, CRIT, CLEAR]
    assert h.status == "CRITICAL"
    assert _incidents()[0]["is_open"] == 1

    h.step(3, [])  # confirmed CLEAR
    assert h.status == "CLEAR"
    closed = _incidents()[0]
    assert closed["is_open"] == 0
    assert closed["closed_at"]

    # Re-block after close
    h.step(3, [FULL_ROI_BOX])
    h.step(3, [FULL_ROI_BOX])
    rows = _incidents()
    assert len(rows) == 2
    assert sorted(r["is_open"] for r in rows) == [0, 1]


def test_incident_source_type_live_only_for_non_synthetic_rtsp_or_webcam():
    h = Harness()
    h.service._source_type = "rtsp"
    h.service._is_synthetic = False
    h.step(1, [FULL_ROI_BOX])
    h.step(3, [FULL_ROI_BOX])
    assert _incidents()[0]["source_type"] == "live"

    fallback = Harness()
    fallback.service._source_type = "rtsp"
    fallback.service._is_synthetic = True
    fallback.service._camera_id = "cam-other"
    fallback.step(1, [FULL_ROI_BOX])
    fallback.step(3, [FULL_ROI_BOX])
    other = [r for r in _incidents() if r["camera_id"] == "cam-other"]
    assert other[0]["source_type"] == "demo"


def test_incident_created_event_is_drained_once():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    h.step(3, [FULL_ROI_BOX])
    events = [e for e in h.service.drain_events() if e["type"] == "incident_created"]
    assert len(events) == 1
    assert events[0]["data"]["is_open"] == 1
    assert events[0]["data"]["action_taken"] == "PENDING"
    assert h.service.drain_events() == []


def test_fixed_interval_when_adaptive_disabled(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_ADAPTIVE_INFERENCE", False)
    monkeypatch.setattr(settings, "INFERENCE_INTERVAL_SECONDS", 7.0)
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    assert h.interval == 7.0
    first_ts = h.service.latest_detection["timestamp"]

    h.step(5, [FULL_ROI_BOX])  # not due yet
    assert h.service.latest_detection["timestamp"] == first_ts
    h.step(2, [FULL_ROI_BOX])  # 7 s elapsed
    assert h.service.latest_detection["timestamp"] != first_ts
    assert h.interval == 7.0


def test_stream_tick_detection_key_set_is_unchanged():
    h = Harness()
    h.step(1, [FULL_ROI_BOX])
    assert set(h.service.latest_detection) == {
        "occlusion_ratio", "raw_ratio", "status", "raw_status", "boxes",
        "debris_count", "roi", "camera_id", "interval_seconds", "timestamp",
    }
