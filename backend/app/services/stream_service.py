import os
import time
import math
import uuid
import json
import sqlite3
import logging
import threading
from collections import deque
from contextlib import closing
from pathlib import Path
from typing import Callable, Deque, Optional, Tuple, List, Dict, Any
from datetime import datetime, timezone

import cv2
import numpy as np

from app.core.config import settings
from app.core.database import SQL_SELECT_INCIDENTS, serialize_incident
from app.ml.inference import YOLOInference, draw_annotations
from app.ml.model_info import load_model_info
from app.ml.occlusion import compute_occlusion, TemporalOcclusionFilter, OcclusionStatus
from app.services.cadence import CadenceController, CadenceMode

logger = logging.getLogger("agos.stream")
logger.setLevel(logging.INFO)


class StreamService:
    """
    Video Stream Ingestion Service for AGOS-Offline.
    Supports RTSP streams, local video files, USB webcams, and synthetic fallback.
    Runs a thread-safe frame acquisition loop with automatic reconnection.
    """

    def __init__(self, clock: Callable[[], float] = time.time):
        # Injected so cadence and incident logic can be driven deterministically in tests
        self._clock = clock
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

        # Stream state
        self._is_running: bool = False
        self._is_connected: bool = False
        self._is_synthetic: bool = False
        self._source: str = ""
        self._source_type: str = "file"
        self._camera_id: str = "cam-default"
        self._roi: List[float] = list(settings.DEFAULT_ROI)
        
        # Frames and metrics
        self._current_frame: Optional[np.ndarray] = None
        self._current_jpeg: Optional[bytes] = None
        self._frame_count: int = 0
        self._fps: float = 0.0
        self._last_frame_timestamp: float = 0.0
        self._last_error: Optional[str] = None
        
        # Local AI Inference Engine & Temporal Hysteresis Filter
        self._inference_engine = YOLOInference(
            weights_path=settings.WEIGHTS_PATH,
            conf_threshold=settings.CONF_THRESHOLD,
            iou_threshold=settings.IOU_THRESHOLD,
            input_size=settings.DEFAULT_INPUT_SIZE,
        )
        self._temporal_filter = TemporalOcclusionFilter(
            window_size=3,
            confirmation_count=2,
            initial_status=OcclusionStatus.CLEAR,
        )
        self._last_inference_time: float = 0.0
        # Runtime stats for the model_status envelope; kept out of _latest_detection on purpose
        self._inference_stats: Dict[str, Any] = {"last_inference_ms": None}
        self._latest_blockage_update: Optional[Dict[str, Any]] = None
        self._cadence = CadenceController()
        # Event envelopes produced on the worker thread, drained by the WebSocket broadcast loop
        self._events: Deque[Dict[str, Any]] = deque(maxlen=100)
        self._current_inference_interval: float = (
            settings.INFERENCE_INTERVAL_CLEAR
            if settings.ENABLE_ADAPTIVE_INFERENCE
            else settings.INFERENCE_INTERVAL_SECONDS
        )

        # Latest detection payload cache for WS streaming
        self._latest_detection: Dict[str, Any] = {
            "occlusion_ratio": 0.0,
            "raw_ratio": 0.0,
            "status": "CLEAR",
            "raw_status": "CLEAR",
            "boxes": [],
            "debris_count": 0,
            "timestamp": None,
        }

        # Synthetic animation state
        self._synth_tick: int = 0

        # Automated SMS alert throttle tracking per camera_id: {camera_id: last_alert_epoch_seconds}
        self._last_alert_time: Dict[str, float] = {}

        # Highest coverage seen per open incident, so the boxed snapshot is only rewritten at a new peak
        self._incident_peaks: Dict[str, float] = {}

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._is_running

    @property
    def is_connected(self) -> bool:
        with self._lock:
            return self._is_connected

    @property
    def current_camera_id(self) -> str:
        with self._lock:
            return self._camera_id

    @property
    def roi(self) -> List[float]:
        with self._lock:
            return list(self._roi)

    @property
    def latest_detection(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._latest_detection)

    def drain_events(self) -> List[Dict[str, Any]]:
        """Return and clear queued WebSocket event envelopes ({"type", "data"})."""
        with self._lock:
            events = list(self._events)
            self._events.clear()
            return events

    def _emit_event(self, event_type: str, data: Dict[str, Any]) -> None:
        with self._lock:
            self._events.append({"type": event_type, "data": data})

    def _source_tag(self) -> str:
        """'live' only for a real rtsp/webcam feed; files, synthetic and fallback frames are 'demo'. Caller holds the lock."""
        return "live" if self._source_type in ("rtsp", "webcam") and not self._is_synthetic else "demo"

    def latest_blockage_update(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return dict(self._latest_blockage_update) if self._latest_blockage_update else None

    def get_model_status(self) -> Dict[str, Any]:
        """Model provenance and runtime stats (data of the model_status envelope and /health model)."""
        engine = self._inference_engine
        info = load_model_info(settings.WEIGHTS_PATH)

        input_shape = output_shape = None
        session = engine.session
        if session is not None:
            input_shape = list(session.get_inputs()[0].shape)
            output_shape = list(session.get_outputs()[0].shape)

        now = self._clock()
        last = self._last_inference_time
        interval = (
            self._current_inference_interval
            if settings.ENABLE_ADAPTIVE_INFERENCE
            else settings.INFERENCE_INTERVAL_SECONDS
        )
        with self._lock:
            input_source = self._source_tag()
            is_synthetic = self._is_synthetic

        return {
            "loaded": engine.is_loaded,
            "weights_file": info["weights_file"],
            "weights_sha256": info["weights_sha256"],
            "weights_size_bytes": info["weights_size_bytes"],
            "input_shape": input_shape,
            "output_shape": output_shape,
            "class_names": [name for _, name in sorted(engine.class_names.items())],
            "conf_threshold": engine.conf_threshold,
            "iou_threshold": engine.iou_threshold,
            "model_version": info["model_version"],
            "training_source": info["training_source"],
            "sidecar_hash_match": info["sidecar_hash_match"],
            "input_source": input_source,
            "is_synthetic": is_synthetic,
            "last_inference_at": (
                datetime.fromtimestamp(last, tz=timezone.utc).isoformat() if last > 0 else None
            ),
            "last_inference_ms": self._inference_stats["last_inference_ms"],
            "interval_seconds": interval,
            "next_inference_in": round(max(0.0, last + interval - now), 2) if last > 0 else 0.0,
        }

    def _publish_inference_events(
        self,
        confirmed_status: OcclusionStatus,
        smoothed_ratio: float,
        raw_ratio: float,
        camera_id: str,
        now: float,
    ) -> None:
        """Queue blockage_detection_update and model_status envelopes after an inference."""
        blockage_status = {
            OcclusionStatus.CLEAR: "clear",
            OcclusionStatus.WARNING: "partial",
            OcclusionStatus.CRITICAL: "blocked",
        }[confirmed_status]
        update = {
            "camera_id": camera_id,
            "status": confirmed_status.value,
            "blockage_status": blockage_status,
            "blockage_percentage": round(smoothed_ratio, 2),
            "raw_ratio": raw_ratio,
            "timestamp": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
        }
        with self._lock:
            self._latest_blockage_update = update
        self._emit_event("blockage_detection_update", update)
        self._emit_event("model_status", self.get_model_status())

    def set_roi(self, roi: List[float]) -> None:
        """Update active Region of Interest [x_min, y_min, x_max, y_max]."""
        with self._lock:
            if len(roi) == 4 and all(0.0 <= c <= 1.0 for c in roi):
                self._roi = list(roi)
                logger.info(f"ROI updated for camera {self._camera_id}: {self._roi}")

    def set_latest_detection(self, detection: Dict[str, Any]) -> None:
        """Update cached ML detection payload for real-time WebSocket sync."""
        with self._lock:
            self._latest_detection = dict(detection)

    def _determine_source_type(self, source: str) -> Tuple[str, Any]:
        """
        Classify source type and resolve path or device index:
        Returns (source_type, resolved_capture_target)
        """
        source_str = str(source).strip()

        # USB Webcam (numeric index e.g. "0", "1")
        if source_str.isdigit():
            return "webcam", int(source_str)

        # RTSP / Network Stream
        if source_str.startswith(("rtsp://", "rtsps://", "http://", "https://")):
            return "rtsp", source_str

        # Local Video File
        candidates = [
            Path(source_str),
            settings.BASE_DIR / source_str,
            settings.BACKEND_DIR / source_str,
            settings.SAMPLE_MEDIA_DIR / source_str,
            settings.DEFAULT_SAMPLE_VIDEO
        ]

        for cand in candidates:
            if cand.is_file():
                return "file", str(cand.resolve())

        # If file not found, fall back to synthetic
        return "synthetic", source_str

    def start(self, source: str, camera_id: str = "cam-default", roi: Optional[List[float]] = None) -> None:
        """Start the background ingestion thread."""
        with self._lock:
            if self._is_running:
                logger.info("Stream service is already running. Switching source...")
                self._source = source
                self._camera_id = camera_id
                if roi:
                    self._roi = list(roi)
                return

            self._source = source
            self._camera_id = camera_id
            if roi:
                self._roi = list(roi)
            self._is_running = True
            self._stop_event.clear()

        self._thread = threading.Thread(target=self._worker_loop, daemon=True, name="AgosStreamWorker")
        self._thread.start()
        logger.info(f"StreamService started for camera '{camera_id}' with source '{source}'")

    def stop(self) -> None:
        """Stop the background ingestion thread cleanly."""
        self._stop_event.set()
        with self._lock:
            self._is_running = False
            self._is_connected = False

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
            self._thread = None
        logger.info("StreamService stopped.")

    def switch_source(self, source: str, camera_id: str, roi: Optional[List[float]] = None) -> None:
        """Safely switch to a new camera stream or video file."""
        logger.info(f"Switching stream source to '{source}' (camera: {camera_id})")
        self.stop()
        self.start(source, camera_id, roi)

    def get_latest_frame(self) -> Tuple[bool, Optional[np.ndarray]]:
        """Thread-safe retrieval of the latest decoded BGR frame."""
        with self._lock:
            if self._current_frame is not None:
                return True, self._current_frame.copy()
            return False, None

    def get_latest_jpeg(self) -> Optional[bytes]:
        """Thread-safe retrieval of the latest JPEG encoded byte buffer."""
        with self._lock:
            return self._current_jpeg

    def get_status(self) -> Dict[str, Any]:
        """Return comprehensive telemetry and ingestion status."""
        with self._lock:
            return {
                "camera_id": self._camera_id,
                "is_running": self._is_running,
                "is_connected": self._is_connected,
                "is_synthetic": self._is_synthetic,
                "source": self._source,
                "source_type": self._source_type,
                "fps": round(self._fps, 1),
                "frame_count": self._frame_count,
                "roi": list(self._roi),
                "last_frame_timestamp": self._last_frame_timestamp,
                "error": self._last_error
            }

    def _generate_synthetic_frame(self, reason: str = "") -> np.ndarray:
        """
        Generate a synthetic animated frame simulating a drainage curb inlet with water flow.
        Used as graceful fallback when no camera is connected or media file is missing.
        """
        w = settings.STREAM_WIDTH
        h = settings.STREAM_HEIGHT
        frame = np.zeros((h, w, 3), dtype=np.uint8)

        # 1. Road Asphalt Base (dark textured grey)
        frame[:] = (42, 44, 46)

        # 2. Sidewalk / Curb Concrete at top-left
        curb_y = int(h * 0.35)
        cv2.rectangle(frame, (0, 0), (w, curb_y), (145, 145, 145), -1)
        cv2.line(frame, (0, curb_y), (w, curb_y), (180, 180, 180), 3)

        # 3. Drainage Inlet Opening Cavity (curb opening behind grate)
        x_min_f, y_min_f, x_max_f, y_max_f = self._roi
        x1 = max(0, min(w - 1, int(x_min_f * w)))
        y1 = max(0, min(h - 1, int(y_min_f * h)))
        x2 = max(0, min(w - 1, int(x_max_f * w)))
        y2 = max(0, min(h - 1, int(y_max_f * h)))

        # Dark culvert intake void
        cv2.rectangle(frame, (x1, y1), (x2, y2), (20, 20, 20), -1)

        # 4. Animated Water Flow along curb gutter
        self._synth_tick += 1
        t = self._synth_tick * 0.15
        
        # Flowing water stream gradient (subtle bluish grey)
        for offset_y in range(curb_y, h, 16):
            shift = int(10 * math.sin(t + offset_y * 0.05))
            water_color = (110 + int(15 * math.sin(t)), 95, 75)
            cv2.line(frame, (0, offset_y), (w, offset_y + shift // 4), water_color, 2)

        # 5. Metal Drainage Grate Grill Bars inside ROI
        bar_step = max(12, (x2 - x1) // 10)
        for bx in range(x1 + bar_step, x2, bar_step):
            cv2.line(frame, (bx, y1), (bx, y2), (110, 115, 120), 4)
            # Metallic highlight
            cv2.line(frame, (bx - 1, y1), (bx - 1, y2), (160, 165, 170), 1)

        # Grate outer perimeter rim
        cv2.rectangle(frame, (x1, y1), (x2, y2), (90, 95, 100), 4)

        # 6. Simulated Floating Debris trapped against grate bars
        # Accumulating debris cluster
        debris_center_x = (x1 + x2) // 2
        debris_center_y = int(y1 + (y2 - y1) * 0.65)

        # Plastic water bottles
        bottle_w = 40
        bottle_h = 16
        bx_pos = debris_center_x - 30 + int(5 * math.sin(t * 0.5))
        by_pos = debris_center_y - 20
        cv2.rectangle(frame, (bx_pos, by_pos), (bx_pos + bottle_w, by_pos + bottle_h), (210, 220, 240), -1)
        cv2.circle(frame, (bx_pos + bottle_w + 3, by_pos + bottle_h // 2), 4, (60, 140, 220), -1) # Blue cap

        # Crushed plastic sando bag (yellow/white wrinkled polygon)
        bag_pts = np.array([
            [debris_center_x + 10, debris_center_y],
            [debris_center_x + 55, debris_center_y - 10],
            [debris_center_x + 70, debris_center_y + 25],
            [debris_center_x + 20, debris_center_y + 35]
        ], np.int32)
        cv2.fillPoly(frame, [bag_pts], (70, 200, 220))

        # Organic vegetative leaves / twigs
        cv2.ellipse(frame, (debris_center_x - 15, debris_center_y + 25), (28, 12), 35, 0, 360, (30, 80, 45), -1)
        cv2.ellipse(frame, (debris_center_x + 35, debris_center_y + 30), (22, 10), -25, 0, 360, (25, 65, 35), -1)

        # 7. Informational Badges & Overlays
        timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S PHT")
        cv2.putText(frame, f"CAM: {self._camera_id} (LOCAL)", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, timestamp_str, (15, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (200, 200, 200), 1, cv2.LINE_AA)

        badge_text = "[SYNTHETIC FALLBACK STREAM]" if not reason else f"[FALLBACK: {reason}]"
        cv2.putText(frame, badge_text, (w - 320, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 200, 255), 1, cv2.LINE_AA)

        return frame

    def _worker_loop(self) -> None:
        """Main thread loop handling ingestion, decoding, reconnection, and fallback."""
        target_frame_time = 1.0 / max(1, settings.STREAM_FPS)
        cap: Optional[cv2.VideoCapture] = None

        while not self._stop_event.is_set():
            with self._lock:
                current_source = self._source

            source_type, resolved_target = self._determine_source_type(current_source)
            with self._lock:
                self._source_type = source_type

            # If classified as synthetic fallback
            if source_type == "synthetic":
                with self._lock:
                    self._is_synthetic = True
                    self._is_connected = True
                    self._last_error = f"Video source '{current_source}' not found. Serving synthetic animation."

                start_time = time.time()
                frame = self._generate_synthetic_frame("SYNTHETIC ACTIVE")
                self._update_frame_buffer(frame)

                elapsed = time.time() - start_time
                sleep_duration = max(0.005, target_frame_time - elapsed)
                time.sleep(sleep_duration)
                continue

            # Attempt to open physical capture source (file, webcam, rtsp)
            logger.info(f"Attempting to open {source_type} stream: {resolved_target}")
            
            # Setup RTSP low-latency buffer if RTSP
            if source_type == "rtsp":
                # Set environment for ffmpeg rtsp transport if needed
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp|max_delay;500000"
                cap = cv2.VideoCapture(resolved_target, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            else:
                cap = cv2.VideoCapture(resolved_target)

            if not cap.isOpened():
                error_msg = f"Failed to open {source_type} source: {resolved_target}"
                logger.warning(error_msg)
                with self._lock:
                    self._is_connected = False
                    self._is_synthetic = True
                    self._last_error = error_msg

                # Provide synthetic fallback frames during disconnection so WebSocket stays alive
                reconnect_start = time.time()
                while (time.time() - reconnect_start < settings.STREAM_RECONNECT_DELAY) and not self._stop_event.is_set():
                    frame = self._generate_synthetic_frame("RECONNECTING...")
                    self._update_frame_buffer(frame)
                    time.sleep(target_frame_time)

                if cap is not None:
                    cap.release()
                continue

            # Capture successfully opened
            with self._lock:
                self._is_connected = True
                self._is_synthetic = False
                self._last_error = None
            logger.info(f"Successfully opened {source_type} stream: {resolved_target}")

            # Frame read loop
            while not self._stop_event.is_set():
                loop_start = time.time()

                ret, frame = cap.read()
                if not ret or frame is None:
                    if source_type == "file":
                        # Loop video file seamlessly
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        ret, frame = cap.read()
                        if not ret or frame is None:
                            logger.warning("Failed to loop video file. Reopening...")
                            break
                    else:
                        logger.warning(f"Connection lost for {source_type} stream. Reconnecting...")
                        break

                # Resize if necessary to standard stream dimensions
                h, w = frame.shape[:2]
                if w != settings.STREAM_WIDTH or h != settings.STREAM_HEIGHT:
                    frame = cv2.resize(frame, (settings.STREAM_WIDTH, settings.STREAM_HEIGHT))

                self._update_frame_buffer(frame)

                # Regulate stream FPS
                elapsed = time.time() - loop_start
                sleep_duration = max(0.002, target_frame_time - elapsed)
                time.sleep(sleep_duration)

            # Cleanup before reconnecting or exiting
            if cap is not None:
                cap.release()
                cap = None

            with self._lock:
                self._is_connected = False

            if not self._stop_event.is_set():
                time.sleep(settings.STREAM_RECONNECT_DELAY)

        if cap is not None:
            cap.release()
        logger.info("Stream ingestion worker exited cleanly.")

    def _run_inference_if_due(self, frame: np.ndarray) -> None:
        """Run YOLOv8 inference and grate occlusion geometry if inference interval elapsed."""
        now = self._clock()
        interval = (
            self._current_inference_interval
            if settings.ENABLE_ADAPTIVE_INFERENCE
            else settings.INFERENCE_INTERVAL_SECONDS
        )
        if (now - self._last_inference_time) < interval:
            return

        previous_inference_time = self._last_inference_time
        self._last_inference_time = now

        try:
            with self._lock:
                current_roi = list(self._roi)
                cam_id = self._camera_id

            # 1. Run local ONNX inference
            infer_started = time.perf_counter()
            detections = self._inference_engine.infer(frame)
            infer_ms = round((time.perf_counter() - infer_started) * 1000.0, 2)

            # 2. Compute grate occlusion geometry
            occlusion_res = compute_occlusion(
                frame_shape=frame.shape,
                roi=current_roi,
                debris_boxes=[d.box for d in detections],
                clear_threshold=settings.CLEAR_THRESHOLD,
                critical_threshold=settings.CRITICAL_THRESHOLD,
            )

            # 3. Apply 2-of-3 temporal hysteresis smoothing. Frames older than 2x the burst
            # interval are stale, so drop them (the confirmed status is kept). In SETTLED mode
            # every gap is 10 s, so the limit is 2x the settled interval: otherwise the window
            # would never hold 2 readings and a confirmed CRITICAL could never be cleared.
            stale_after = 2 * (
                settings.INFERENCE_INTERVAL_SETTLED
                if self._cadence.mode == CadenceMode.SETTLED
                else settings.INFERENCE_INTERVAL_BURST
            )
            if (
                settings.ENABLE_ADAPTIVE_INFERENCE
                and previous_inference_time > 0
                and (now - previous_inference_time) > stale_after
            ):
                self._temporal_filter.clear_history()
            confirmed_status = self._temporal_filter.update(
                raw_status=occlusion_res.status,
                ratio=occlusion_res.ratio,
            )
            smoothed_ratio = self._temporal_filter.smoothed_ratio

            # 4. Adaptive Cadence Adjustment
            if settings.ENABLE_ADAPTIVE_INFERENCE:
                self._current_inference_interval = self._cadence.update(
                    now=now,
                    raw_ratio=occlusion_res.ratio,
                    raw_status=occlusion_res.status,
                    confirmed=confirmed_status,
                )

            # 5. Cache structured detection telemetry
            detection_payload = {
                "occlusion_ratio": smoothed_ratio,
                "raw_ratio": occlusion_res.ratio,
                "status": confirmed_status.value,
                "raw_status": occlusion_res.status.value,
                "boxes": [d.to_dict() for d in detections],
                "debris_count": len(detections),
                "roi": current_roi,
                "camera_id": cam_id,
                "interval_seconds": self._current_inference_interval,
                "timestamp": datetime.fromtimestamp(now).isoformat(),
            }

            with self._lock:
                self._latest_detection = detection_payload

            # 6. Open, update or close this camera's blockage incident
            self._sync_incident_lifecycle(frame, confirmed_status, smoothed_ratio, len(detections), cam_id, now)

            # 7. Telemetry envelopes for the WebSocket broadcaster
            self._inference_stats["last_inference_ms"] = infer_ms
            self._publish_inference_events(confirmed_status, smoothed_ratio, occlusion_res.ratio, cam_id, now)

        except Exception as e:
            logger.error(f"Inference error in stream worker: {e}", exc_info=True)

    def _sync_incident_lifecycle(
        self,
        frame: np.ndarray,
        confirmed_status: OcclusionStatus,
        occlusion_ratio: float,
        debris_count: int,
        camera_id: str,
        now: float,
    ) -> None:
        """
        Keep exactly one open incident per camera in SQLite: open it on confirmed WARNING or
        CRITICAL, upgrade a WARNING incident to CRITICAL in place, refresh its measurements (and
        its boxed snapshot at a new coverage peak) while the obstruction persists, and close it on
        confirmed CLEAR. The row keeps the highest level reached. SMS alerts are CRITICAL-only.
        """
        try:
            now_dt = datetime.fromtimestamp(now)
            now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
            with closing(sqlite3.connect(str(settings.DATABASE_PATH))) as conn:
                row = conn.execute(
                    "SELECT id, timestamp, radio_ticket, status, occlusion_ratio "
                    "FROM incidents WHERE camera_id = ? AND is_open = 1",
                    (camera_id,),
                ).fetchone()

                if row is None:
                    if confirmed_status in (OcclusionStatus.WARNING, OcclusionStatus.CRITICAL):
                        incident_id, radio_ticket = self._open_incident(
                            conn, frame, occlusion_ratio, debris_count, camera_id, now_str, confirmed_status.value
                        )
                        if confirmed_status == OcclusionStatus.CRITICAL:
                            self._trigger_incident_sms(
                                conn,
                                camera_id,
                                occlusion_ratio,
                                is_clear=False,
                                now=now,
                                incident_id=incident_id,
                                radio_ticket=radio_ticket,
                            )
                    return

                incident_id, started_str, inc_ticket, inc_status, stored_ratio = row
                started = datetime.strptime(started_str, "%Y-%m-%d %H:%M:%S")
                duration = max(0.0, (now_dt - started).total_seconds())

                if confirmed_status == OcclusionStatus.CLEAR:
                    conn.execute(
                        "UPDATE incidents SET is_open = 0, closed_at = ?, duration_seconds = ? WHERE id = ?",
                        (now_str, duration, incident_id),
                    )
                    conn.commit()
                    self._incident_peaks.pop(incident_id, None)
                    logger.info(f"Closed blockage incident {incident_id} after {duration:.0f}s")
                    if inc_status == "CRITICAL":
                        self._trigger_incident_sms(
                            conn,
                            camera_id,
                            occlusion_ratio,
                            is_clear=True,
                            now=now,
                            incident_id=incident_id,
                            radio_ticket=inc_ticket,
                        )
                    return

                # Still obstructed. The row only ever moves up: WARNING -> CRITICAL, never back down.
                upgraded = confirmed_status == OcclusionStatus.CRITICAL and inc_status != "CRITICAL"
                level = "CRITICAL" if (upgraded or inc_status == "CRITICAL") else "WARNING"

                # Rewrite the boxed snapshot (same file name) on upgrade and whenever coverage hits a new peak
                peak = self._incident_peaks.get(incident_id, stored_ratio or 0.0)
                if upgraded or occlusion_ratio > peak:
                    self._save_incident_image(
                        frame, settings.STORAGE_DIR / f"{incident_id}.jpg", level, occlusion_ratio
                    )
                    self._incident_peaks[incident_id] = max(peak, occlusion_ratio)

                # Dispatch state and the radio ticket belong to the record's first moment and stay untouched
                conn.execute(
                    "UPDATE incidents SET status = ?, occlusion_ratio = ?, debris_count = ?, duration_seconds = ? "
                    "WHERE id = ?",
                    (level, occlusion_ratio, debris_count, duration, incident_id),
                )
                pending = conn.execute(
                    "SELECT id, payload FROM sync_queue "
                    "WHERE entity_type = 'incident' AND entity_id = ? AND status = 'PENDING'",
                    (incident_id,),
                ).fetchone()
                if pending:
                    payload = json.loads(pending[1])
                    payload["occlusion_ratio"] = occlusion_ratio
                    payload["debris_count"] = debris_count
                    payload["status"] = level
                    conn.execute(
                        "UPDATE sync_queue SET payload = ?, updated_at = ? WHERE id = ?",
                        (json.dumps(payload), now_str, pending[0]),
                    )
                elif upgraded:
                    # The WARNING version was already delivered: queue the new version. The cloud
                    # POST is an upsert on the incident id, so it replaces the delivered row.
                    conn.row_factory = sqlite3.Row
                    current = conn.execute(
                        "SELECT id, camera_id, timestamp, occlusion_ratio, status, debris_count, image_path, "
                        "radio_ticket FROM incidents WHERE id = ?",
                        (incident_id,),
                    ).fetchone()
                    conn.row_factory = None
                    conn.execute(
                        "INSERT INTO sync_queue (id, entity_type, entity_id, payload, status) "
                        "VALUES (?, 'incident', ?, ?, 'PENDING')",
                        (f"sync-{uuid.uuid4().hex[:8]}", incident_id, json.dumps(dict(current))),
                    )
                    conn.execute("UPDATE incidents SET cloud_synced = 0 WHERE id = ?", (incident_id,))
                conn.commit()

                if upgraded:
                    self._emit_incident_event(conn, incident_id)
                    logger.warning(
                        f"[ALERT] Logged CRITICAL blockage incident: {incident_id} [{inc_ticket}] "
                        f"(upgraded from WARNING, occlusion: {occlusion_ratio:.1f}%, camera: {camera_id})"
                    )
                    self._trigger_incident_sms(
                        conn,
                        camera_id,
                        occlusion_ratio,
                        is_clear=False,
                        now=now,
                        incident_id=incident_id,
                        radio_ticket=inc_ticket,
                    )
                elif level == "CRITICAL":
                    # Check cooldown timer for sustained critical blockage reminders
                    try:
                        from app.services.sms_service import sms_service
                        cfg = sms_service.get_config_sync()
                        cooldown_secs = float(cfg.get("cooldown_minutes", 15)) * 60.0
                        last_alert = self._last_alert_time.get(camera_id, 0.0)
                        if (now - last_alert) >= cooldown_secs:
                            self._trigger_incident_sms(
                                conn,
                                camera_id,
                                occlusion_ratio,
                                is_clear=False,
                                now=now,
                                incident_id=incident_id,
                                radio_ticket=inc_ticket,
                            )
                    except Exception as ex:
                        logger.warning(f"Failed to check SMS cooldown: {ex}")
        except Exception as err:
            logger.error(f"Failed to update incident lifecycle in database: {err}", exc_info=True)

    def _trigger_incident_sms(
        self,
        conn: sqlite3.Connection,
        camera_id: str,
        occlusion_ratio: float,
        is_clear: bool,
        now: float,
        incident_id: Optional[str] = None,
        radio_ticket: Optional[str] = None,
    ) -> None:
        """Trigger SMS notification to designated responder group for incident lifecycle change."""
        try:
            from app.services.sms_service import sms_service
            cam_row = conn.execute("SELECT location, name FROM cameras WHERE id = ?", (camera_id,)).fetchone()
            loc = (cam_row[0] if cam_row and cam_row[0] else (cam_row[1] if cam_row else camera_id))
            sms_service.dispatch_incident_alert_sync(
                camera_id=camera_id,
                location=loc,
                occlusion_ratio=occlusion_ratio,
                is_clear=is_clear,
                incident_id=incident_id,
                radio_ticket=radio_ticket,
            )
            self._last_alert_time[camera_id] = now
        except Exception as err:
            logger.error(f"Error triggering incident SMS: {err}")

    def _open_incident(
        self,
        conn: sqlite3.Connection,
        frame: np.ndarray,
        occlusion_ratio: float,
        debris_count: int,
        camera_id: str,
        now_str: str,
        status: str = "CRITICAL",
    ) -> Tuple[str, str]:
        """Persist a new WARNING or CRITICAL incident: boxed snapshot, row, radio ticket, sync entry."""
        incident_id = f"inc-{uuid.uuid4().hex[:8]}"
        img_filename = f"{incident_id}.jpg"
        img_path = settings.STORAGE_DIR / img_filename

        # Render visual annotation snapshot for disaster forensic inspection
        self._save_incident_image(frame, img_path, status, occlusion_ratio)
        self._incident_peaks[incident_id] = occlusion_ratio
        with self._lock:
            # Only a real camera feed is "live"; files, synthetic and fallback frames are demo
            source_tag = self._source_tag()

        rel_image_path = f"/storage/incidents/{img_filename}"
        radio_ticket = f"RAD-{uuid.uuid4().hex[:6].upper()}"

        # Context stamps: which model made the call, and the latest stored rain reading (may be none)
        model = load_model_info(settings.WEIGHTS_PATH)
        weather = conn.execute(
            "SELECT precipitation_mm, weather_code FROM weather_readings ORDER BY id DESC LIMIT 1"
        ).fetchone()

        conn.execute(
            """
            INSERT INTO incidents (
                id, camera_id, timestamp, occlusion_ratio, status,
                image_path, debris_count, radio_ticket, synced, is_open, source_type,
                model_version, model_sha256, precipitation_mm, weather_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)
            """,
            (
                incident_id,
                camera_id,
                now_str,
                occlusion_ratio,
                status,
                rel_image_path,
                debris_count,
                radio_ticket,
                source_tag,
                model["model_version"],
                model["weights_sha256"],
                weather[0] if weather else None,
                weather[1] if weather else None,
            ),
        )

        # Cloud payload keys must stay exactly these: PostgREST rejects unknown columns
        sync_payload = json.dumps({
            "id": incident_id,
            "camera_id": camera_id,
            "timestamp": now_str,
            "occlusion_ratio": occlusion_ratio,
            "status": status,
            "debris_count": debris_count,
            "image_path": rel_image_path,
            "radio_ticket": radio_ticket,
        })

        conn.execute(
            """
            INSERT INTO sync_queue (id, entity_type, entity_id, payload, status)
            VALUES (?, 'incident', ?, ?, 'PENDING')
            """,
            (f"sync-{uuid.uuid4().hex[:8]}", incident_id, sync_payload),
        )
        conn.commit()

        self._emit_incident_event(conn, incident_id)

        if status == "CRITICAL":
            logger.warning(
                f"[ALERT] Logged CRITICAL blockage incident: {incident_id} [{radio_ticket}] "
                f"(occlusion: {occlusion_ratio:.1f}%, camera: {camera_id})"
            )
        else:
            logger.info(
                f"Logged {status} detection incident: {incident_id} [{radio_ticket}] "
                f"(occlusion: {occlusion_ratio:.1f}%, camera: {camera_id})"
            )
        return incident_id, radio_ticket

    def _save_incident_image(
        self, frame: np.ndarray, img_path: Path, status: str, occlusion_ratio: float
    ) -> None:
        """Write the boxed (annotated) frame for an incident; rewriting the same path replaces it."""
        with self._lock:
            current_boxes = self._latest_detection.get("boxes", [])
            current_roi = list(self._roi)

        annotated = draw_annotations(
            frame,
            detections=current_boxes,
            roi=current_roi,
            status=status,
            occlusion_ratio=occlusion_ratio,
            show_labels=True,
            draw_roi=True,
            copy=True,
        )
        if not cv2.imwrite(str(img_path), annotated):
            logger.warning(f"Could not write incident snapshot {img_path}")

    def _emit_incident_event(self, conn: sqlite3.Connection, incident_id: str) -> None:
        """Queue an incident_created envelope with the incident's current row."""
        conn.row_factory = sqlite3.Row
        created = conn.execute(SQL_SELECT_INCIDENTS + " WHERE i.id = ?", (incident_id,)).fetchone()
        self._emit_event("incident_created", serialize_incident(created))

    def _update_frame_buffer(self, frame: np.ndarray) -> None:
        """Evaluate inference, overlay HUD annotations, encode JPEG, and update buffers."""
        # 1. Run local AI inference when due
        self._run_inference_if_due(frame)

        # 2. Render live visual annotations onto display frame
        with self._lock:
            current_status = self._latest_detection.get("status", "CLEAR")
            current_ratio = self._latest_detection.get("occlusion_ratio", 0.0)
            current_boxes = self._latest_detection.get("boxes", [])
            current_roi = list(self._roi)

        display_frame = draw_annotations(
            frame,
            detections=current_boxes,
            roi=current_roi,
            status=current_status,
            occlusion_ratio=current_ratio,
            show_labels=True,
            draw_roi=True,
            copy=True,
        )

        # 3. Encode to JPEG
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 80]
        success, buffer = cv2.imencode(".jpg", display_frame, encode_params)
        jpeg_bytes = buffer.tobytes() if success else None

        now = time.time()
        with self._lock:
            self._current_frame = frame
            self._current_jpeg = jpeg_bytes
            self._frame_count += 1

            if self._last_frame_timestamp > 0:
                delta = now - self._last_frame_timestamp
                if delta > 0:
                    current_inst_fps = 1.0 / delta
                    self._fps = 0.85 * self._fps + 0.15 * current_inst_fps
            else:
                self._fps = float(settings.STREAM_FPS)

            self._last_frame_timestamp = now


# Shared singleton instance
stream_service = StreamService()

