"""Occlusion computation engine and temporal smoothing filter for AGOS-Offline.

Calculates the percentage of the calibrated Grate Region of Interest (ROI)
occluded by detected debris objects and applies a 2-of-3 temporal hysteresis
filter to prevent transient false alarms.
"""

from __future__ import annotations

import logging
from collections import Counter, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Sequence, Union

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class OcclusionStatus(str, Enum):
    """Occlusion alert classification tiers."""

    CLEAR = "CLEAR"          # < 25% occlusion: normal runoff flow
    WARNING = "WARNING"      # 25% - 59.9% occlusion: maintenance advised
    CRITICAL = "CRITICAL"    # >= 60% occlusion: urgent blockage risk


# Default fallback thresholds (matching CONTEXT.md and config.py)
DEFAULT_CLEAR_THRESHOLD = 25.0
DEFAULT_CRITICAL_THRESHOLD = 60.0


def classify_occlusion(
    ratio: float,
    clear_threshold: float = DEFAULT_CLEAR_THRESHOLD,
    critical_threshold: float = DEFAULT_CRITICAL_THRESHOLD,
) -> OcclusionStatus:
    """Classify an occlusion percentage into CLEAR, WARNING, or CRITICAL.

    Args:
        ratio: Occlusion ratio in range [0.0, 100.0].
        clear_threshold: Upper bound for CLEAR status (exclusive). Default 25.0%.
        critical_threshold: Lower bound for CRITICAL status (inclusive). Default 60.0%.

    Returns:
        OcclusionStatus tier.
    """
    if ratio < clear_threshold:
        return OcclusionStatus.CLEAR
    if ratio < critical_threshold:
        return OcclusionStatus.WARNING
    return OcclusionStatus.CRITICAL


@dataclass
class OcclusionResult:
    """Detailed result of an occlusion analysis."""

    ratio: float
    status: OcclusionStatus
    roi_area: float
    union_area: float
    debris_count: int
    intersecting_boxes: list[list[float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert result to JSON-serializable dictionary."""
        return {
            "ratio": round(self.ratio, 2),
            "status": self.status.value,
            "roi_area": round(self.roi_area, 2),
            "union_area": round(self.union_area, 2),
            "debris_count": self.debris_count,
            "intersecting_boxes": self.intersecting_boxes,
        }


def _parse_roi(
    roi: Union[Sequence[float], np.ndarray, Sequence[Sequence[float]]],
    frame_width: int,
    frame_height: int,
) -> tuple[np.ndarray, bool]:
    """Parse and normalize ROI into pixel coordinates and determine polygon vs bbox.

    Args:
        roi: ROI coordinates. Can be:
             - 4-element bbox: [x_min, y_min, x_max, y_max] (normalized 0..1 or pixel)
             - Polygon vertices: [[x1, y1], [x2, y2], ...] (normalized 0..1 or pixel)
        frame_width: Frame pixel width.
        frame_height: Frame pixel height.

    Returns:
        (points_array, is_polygon) where points_array has shape (N, 2) in integer pixels.
    """
    pts = np.asarray(roi, dtype=np.float32)

    # 4-element bounding box [x1, y1, x2, y2]
    if pts.ndim == 1 and len(pts) == 4:
        x1, y1, x2, y2 = pts
        # If coordinates are normalized (<= 1.05), scale to frame dimensions
        if max(x1, y1, x2, y2) <= 1.05:
            x1 *= frame_width
            y1 *= frame_height
            x2 *= frame_width
            y2 *= frame_height

        poly_pts = np.array(
            [
                [x1, y1],
                [x2, y1],
                [x2, y2],
                [x1, y2],
            ],
            dtype=np.int32,
        )
        return poly_pts, False

    # Polygon points [[x1, y1], [x2, y2], ...]
    if pts.ndim == 2 and pts.shape[1] == 2:
        if np.max(pts) <= 1.05:
            pts[:, 0] *= frame_width
            pts[:, 1] *= frame_height
        return pts.astype(np.int32), True

    raise ValueError(f"Invalid ROI format. Expected 4-element box or Nx2 polygon, got shape {pts.shape}")


def compute_occlusion(
    roi: Union[Sequence[float], np.ndarray, Sequence[Sequence[float]]],
    debris_boxes: Sequence[Union[Sequence[float], dict[str, Any]]],
    frame_shape: tuple[int, int] = (720, 1280),
    clear_threshold: float = DEFAULT_CLEAR_THRESHOLD,
    critical_threshold: float = DEFAULT_CRITICAL_THRESHOLD,
) -> OcclusionResult:
    """Compute the grate occlusion ratio between detected debris boxes and the ROI.

    Uses geometric raster mask rendering over the ROI bounding area to calculate
    the exact union area of overlapping debris boxes without double-counting
    overlapping debris detections.

    Formula:
        Occlusion ratio = (Union area of debris boxes overlapping ROI) / (Total Area of ROI) * 100

    Args:
        roi: Calibrated Grate ROI as normalized [x1, y1, x2, y2], pixel box, or polygon vertices.
        debris_boxes: List of detected debris bounding boxes [x1, y1, x2, y2] in pixel coords
                      or dicts with a 'box' key.
        frame_shape: Frame dimensions as (height, width).
        clear_threshold: Upper limit for CLEAR status (default 25.0%).
        critical_threshold: Lower limit for CRITICAL status (default 60.0%).

    Returns:
        OcclusionResult with ratio, status, areas, and intersecting box information.
    """
    height, width = frame_shape[:2]
    if height <= 0 or width <= 0:
        return OcclusionResult(0.0, OcclusionStatus.CLEAR, 0.0, 0.0, 0)

    roi_pts, _ = _parse_roi(roi, width, height)

    # Compute bounding rect for ROI to minimize mask memory and execution time
    rx, ry, rw, rh = cv2.boundingRect(roi_pts)

    # Clip ROI rect to frame bounds
    rx1 = max(0, rx)
    ry1 = max(0, ry)
    rx2 = min(width, rx + rw)
    ry2 = min(height, ry + rh)

    roi_w = rx2 - rx1
    roi_h = ry2 - ry1

    if roi_w <= 0 or roi_h <= 0:
        return OcclusionResult(0.0, OcclusionStatus.CLEAR, 0.0, 0.0, 0)

    # Shift ROI polygon coordinates into local ROI bounding rectangle space
    local_roi_pts = roi_pts.copy()
    local_roi_pts[:, 0] -= rx1
    local_roi_pts[:, 1] -= ry1

    # Render ROI mask in local coordinate space
    roi_mask = np.zeros((roi_h, roi_w), dtype=np.uint8)
    cv2.fillPoly(roi_mask, [local_roi_pts], 255)
    roi_area = float(np.count_nonzero(roi_mask))

    if roi_area <= 0.0:
        return OcclusionResult(0.0, OcclusionStatus.CLEAR, 0.0, 0.0, 0)

    # Render debris boxes into local debris mask
    debris_mask = np.zeros((roi_h, roi_w), dtype=np.uint8)
    intersecting_boxes: list[list[float]] = []

    for item in debris_boxes:
        if isinstance(item, dict) and "box" in item:
            box = item["box"]
        else:
            box = item

        bx1, by1, bx2, by2 = float(box[0]), float(box[1]), float(box[2]), float(box[3])

        # If debris box is normalized, scale to frame coordinates
        if max(bx1, by1, bx2, by2) <= 1.05 and width > 1 and height > 1:
            bx1 *= width
            by1 *= height
            bx2 *= width
            by2 *= height

        # Compute intersection between debris box and ROI bounding rectangle
        inter_x1 = max(rx1, bx1)
        inter_y1 = max(ry1, by1)
        inter_x2 = min(rx2, bx2)
        inter_y2 = min(ry2, by2)

        if inter_x2 > inter_x1 and inter_y2 > inter_y1:
            # Shift to local coordinates
            lx1 = int(round(inter_x1 - rx1))
            ly1 = int(round(inter_y1 - ry1))
            lx2 = int(round(inter_x2 - rx1))
            ly2 = int(round(inter_y2 - ry1))

            cv2.rectangle(debris_mask, (lx1, ly1), (lx2, ly2), 255, thickness=-1)
            intersecting_boxes.append([round(bx1, 1), round(by1, 1), round(bx2, 1), round(by2, 1)])

    # Exact union area of debris intersecting the ROI
    overlap_mask = cv2.bitwise_and(roi_mask, debris_mask)
    union_area = float(np.count_nonzero(overlap_mask))

    ratio = min(100.0, max(0.0, (union_area / roi_area) * 100.0))
    status = classify_occlusion(ratio, clear_threshold, critical_threshold)

    return OcclusionResult(
        ratio=round(ratio, 2),
        status=status,
        roi_area=round(roi_area, 2),
        union_area=round(union_area, 2),
        debris_count=len(debris_boxes),
        intersecting_boxes=intersecting_boxes,
    )


class TemporalOcclusionFilter:
    """Temporal smoothing filter for alert status hysteresis.

    Maintains a rolling 3-frame history requiring 2-of-3 frames in a status tier
    before updating the confirmed alert status. This prevents transient floating
    leaves, passing fish/ripples, or brief detector flicker from triggering false sirens.
    """

    def __init__(
        self,
        window_size: int = 3,
        confirmation_count: int = 2,
        initial_status: OcclusionStatus = OcclusionStatus.CLEAR,
    ) -> None:
        """Initialize the temporal hysteresis filter.

        Args:
            window_size: Size of rolling frame window (default: 3).
            confirmation_count: Minimum occurrences in window to confirm status (default: 2).
            initial_status: Initial confirmed status (default: CLEAR).
        """
        self.window_size = window_size
        self.confirmation_count = confirmation_count
        self.confirmed_status = initial_status
        self.history: deque[OcclusionStatus] = deque(maxlen=window_size)
        self.ratio_history: deque[float] = deque(maxlen=window_size)
        self.last_raw_status: OcclusionStatus = initial_status
        self.last_raw_ratio: float = 0.0

    def update(
        self,
        raw_status: Union[OcclusionStatus, str],
        ratio: float = 0.0,
    ) -> OcclusionStatus:
        """Update filter with a new frame's raw classification.

        Args:
            raw_status: Raw classification from the current frame (CLEAR, WARNING, CRITICAL).
            ratio: Optional raw occlusion ratio for moving average tracking.

        Returns:
            The confirmed alert status after 2-of-3 hysteresis evaluation.
        """
        if isinstance(raw_status, str):
            status_enum = OcclusionStatus(raw_status)
        else:
            status_enum = raw_status

        self.last_raw_status = status_enum
        self.last_raw_ratio = ratio
        self.history.append(status_enum)
        self.ratio_history.append(ratio)

        # Count occurrences of each tier in the current window
        counts = Counter(self.history)

        # Check if any tier satisfies the 2-of-3 requirement
        for tier, count in counts.items():
            if count >= self.confirmation_count:
                if tier != self.confirmed_status:
                    logger.info(
                        "Alert status transition confirmed: %s -> %s (history: %s)",
                        self.confirmed_status.value,
                        tier.value,
                        [s.value for s in self.history],
                    )
                    self.confirmed_status = tier
                break

        return self.confirmed_status

    @property
    def smoothed_ratio(self) -> float:
        """Return the rolling mean occlusion ratio across the history window."""
        if not self.ratio_history:
            return 0.0
        return round(float(np.mean(self.ratio_history)), 2)

    def clear_history(self) -> None:
        """Drop stale frames from the window but keep the confirmed status."""
        self.history.clear()
        self.ratio_history.clear()

    def reset(self, initial_status: OcclusionStatus = OcclusionStatus.CLEAR) -> None:
        """Reset the history window and confirmed status."""
        self.confirmed_status = initial_status
        self.history.clear()
        self.ratio_history.clear()
        self.last_raw_status = initial_status
        self.last_raw_ratio = 0.0

    def __repr__(self) -> str:
        return (
            f"TemporalOcclusionFilter(confirmed={self.confirmed_status.value}, "
            f"history={[s.value for s in self.history]}, "
            f"smoothed_ratio={self.smoothed_ratio}%)"
        )
