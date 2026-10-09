"""Adaptive inference cadence controller for AGOS-Offline.

Pure logic, no I/O: CLEAR (slow polling) -> BURST (fast confirmation) -> SETTLED
(sustained confirmed blockage, relaxed polling). Rain and weather are deliberately
not inputs: cadence reacts only to what the camera sees.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from app.core.config import settings
from app.ml.occlusion import OcclusionStatus


class CadenceMode(str, Enum):
    CLEAR = "CLEAR"
    BURST = "BURST"
    SETTLED = "SETTLED"


class CadenceController:
    """Decides the next inference interval from each inference result."""

    def __init__(self) -> None:
        self.mode: CadenceMode = CadenceMode.CLEAR
        self._burst_entered_at: float = 0.0
        self._last_alert_at: float = 0.0
        self._clean_streak: int = 0
        self._critical_since: Optional[float] = None

    @property
    def interval(self) -> float:
        if self.mode == CadenceMode.BURST:
            return settings.INFERENCE_INTERVAL_BURST
        if self.mode == CadenceMode.SETTLED:
            return settings.INFERENCE_INTERVAL_SETTLED
        return settings.INFERENCE_INTERVAL_CLEAR

    def _enter_burst(self, now: float) -> None:
        self.mode = CadenceMode.BURST
        self._burst_entered_at = now
        self._clean_streak = 0
        self._critical_since = None

    def update(
        self,
        now: float,
        raw_ratio: float,
        raw_status: OcclusionStatus,
        confirmed: OcclusionStatus,
    ) -> float:
        """Feed one inference result and return the interval to use next."""
        is_clean = raw_ratio < settings.BURST_ENTER_RATIO
        is_alert = (not is_clean) or confirmed != OcclusionStatus.CLEAR
        is_critical = confirmed == OcclusionStatus.CRITICAL and raw_status == OcclusionStatus.CRITICAL

        self._clean_streak = self._clean_streak + 1 if is_clean else 0
        if is_alert:
            self._last_alert_at = now

        if self.mode == CadenceMode.CLEAR:
            if is_alert:
                self._enter_burst(now)
        elif self.mode == CadenceMode.BURST:
            if is_critical:
                if self._critical_since is None:
                    self._critical_since = now
                if now - self._critical_since >= settings.BURST_MIN_DWELL_SECONDS:
                    self.mode = CadenceMode.SETTLED
            else:
                self._critical_since = None

            # Exit needs all four. With defaults the 60 s cooldown dominates the 15 s
            # dwell; both stay separate settings because they guard different things.
            if (
                self.mode == CadenceMode.BURST
                and confirmed == OcclusionStatus.CLEAR
                and self._clean_streak >= settings.BURST_CLEAN_INFERENCES_TO_EXIT
                and now - self._burst_entered_at >= settings.BURST_MIN_DWELL_SECONDS
                and now - self._last_alert_at >= settings.BURST_EXIT_COOLDOWN_SECONDS
            ):
                self.mode = CadenceMode.CLEAR
        else:  # SETTLED: first non-critical reading goes back to 3 s so clearing is confirmed quickly
            if not is_critical:
                self._enter_burst(now)

        return self.interval
