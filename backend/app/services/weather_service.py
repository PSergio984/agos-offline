"""Offline-first weather fetcher for AGOS-Offline.

Queries current precipitation and meteorological telemetry with a strict
2.0-second timeout. If offline or unreachable, returns graceful fallback
without blocking any local AI or console operations.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

import aiosqlite
import httpx

from app.core.config import settings

logger = logging.getLogger("agos.weather")
logger.setLevel(logging.INFO)

# Default coordinates: Metro Manila, Philippines
DEFAULT_LAT = 14.5995
DEFAULT_LON = 120.9842
TIMEOUT_SECONDS = 2.0


class WeatherService:
    """Manages offline-first weather queries with cached fallback."""

    def __init__(self) -> None:
        self._last_cached_weather: Optional[Dict[str, Any]] = None
        self._last_checked: Optional[datetime] = None
        # Operator override of the rain hazard badge. In memory only: resets on restart.
        self._hazard_override: Optional[bool] = None

    def set_override(self, active: Optional[bool]) -> None:
        """Force the rain hazard on/off, or None to return to automatic."""
        self._hazard_override = active

    def get_rain_hazard(self, precipitation_mm: Optional[float]) -> Dict[str, Any]:
        """
        Rain hazard shown to operators. It is context only: it never feeds the alarm path,
        the inference cadence or incident creation.
        """
        threshold = settings.RAIN_HAZARD_THRESHOLD_MM
        if self._hazard_override is not None:
            return {"active": self._hazard_override, "source": "override", "threshold_mm": threshold}
        active = precipitation_mm is not None and precipitation_mm >= threshold
        return {"active": active, "source": "auto", "threshold_mm": threshold}

    async def record_reading(self, payload: Dict[str, Any]) -> None:
        """Persist one successful online fetch (UTC timestamp)."""
        async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
            await db.execute(
                """
                INSERT INTO weather_readings
                    (timestamp, precipitation_mm, weather_code, temperature_c, humidity_pct, condition)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                    payload.get("rainfall_mm"),
                    payload.get("weather_code"),
                    payload.get("temperature_c"),
                    payload.get("humidity_pct"),
                    payload.get("condition"),
                ),
            )
            await db.commit()

    @staticmethod
    def latest_reading() -> Optional[Dict[str, Any]]:
        """Most recent stored reading, or None. Synchronous so the stream thread can use it."""
        try:
            with closing(sqlite3.connect(str(settings.DATABASE_PATH))) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT * FROM weather_readings ORDER BY id DESC LIMIT 1").fetchone()
        except sqlite3.Error:
            return None
        return dict(row) if row else None

    def build_weather_update(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """weather_update envelope data from a get_current_weather-style payload."""
        precip = payload.get("rainfall_mm")
        return {
            "precipitation_mm": precip,
            "weather_code": payload.get("weather_code"),
            "timestamp": payload.get("timestamp"),
            "condition": payload.get("condition"),
            "is_online": bool(payload.get("is_online")),
            "rain_hazard": self.get_rain_hazard(precip if payload.get("is_online") else None),
        }

    def build_stored_weather_update(self) -> Dict[str, Any]:
        """weather_update envelope data from the latest stored reading (empty values if none)."""
        row = self.latest_reading()
        if row is None:
            return {
                "precipitation_mm": None,
                "weather_code": None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "condition": None,
                "is_online": False,
                "rain_hazard": self.get_rain_hazard(None),
            }
        return {
            "precipitation_mm": row["precipitation_mm"],
            "weather_code": row["weather_code"],
            "timestamp": row["timestamp"],
            "condition": row["condition"],
            "is_online": True,
            "rain_hazard": self.get_rain_hazard(row["precipitation_mm"]),
        }

    async def get_current_weather(
        self,
        lat: float = DEFAULT_LAT,
        lon: float = DEFAULT_LON,
    ) -> Dict[str, Any]:
        """Fetch current weather telemetry with strict 2-second timeout.
        
        Returns offline fallback immediately if network is disconnected.
        """
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,relative_humidity_2m,precipitation,weather_code"
            f"&timezone=Asia%2FManila"
        )

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    current = data.get("current", {})

                    precip = float(current.get("precipitation", 0.0))
                    temp = float(current.get("temperature_2m", 28.0))
                    humidity = float(current.get("relative_humidity_2m", 80.0))
                    code = int(current.get("weather_code", 0))

                    condition = self._interpret_weather_code(code, precip)

                    payload = {
                        "is_online": True,
                        "rainfall_mm": precip,
                        "temperature_c": temp,
                        "humidity_pct": humidity,
                        "condition": condition,
                        "weather_code": code,
                        "message": f"{condition} ({precip:.1f} mm/hr)",
                        "location": "Metro Manila (PAGASA Sector)",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "cached": False,
                    }

                    self._last_cached_weather = payload
                    self._last_checked = datetime.now()
                    return payload

        except (httpx.TimeoutException, httpx.NetworkError, Exception) as err:
            logger.debug("Weather query failed or offline (expected during storms): %s", err)

        # Graceful offline response
        if self._last_cached_weather is not None:
            cached_resp = dict(self._last_cached_weather)
            cached_resp["is_online"] = False
            cached_resp["cached"] = True
            cached_resp["message"] = f"[Cached] {cached_resp.get('condition', 'Offline')}"
            return cached_resp

        return {
            "is_online": False,
            "rainfall_mm": 0.0,
            "temperature_c": None,
            "humidity_pct": None,
            "condition": "Offline Mode",
            "weather_code": None,
            "message": "Offline (Weather unavailable)",
            "location": "Local Command Center",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cached": False,
        }

    @staticmethod
    def _interpret_weather_code(code: int, precip: float) -> str:
        """Map WMO weather code to readable description."""
        if precip > 15.0 or code in (65, 82):
            return "Torrential Rain (Flood Risk)"
        if precip > 7.5 or code in (63, 81):
            return "Heavy Rain"
        if precip > 2.5 or code in (61, 80):
            return "Moderate Rain"
        if precip > 0.0 or code in (51, 53, 55):
            return "Light Drizzle"
        if code in (1, 2, 3):
            return "Partly Cloudy"
        if code == 0:
            return "Clear Skies"
        return "Overcast"


weather_service = WeatherService()


async def weather_worker_loop(publish: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
    """Fetch weather every WEATHER_FETCH_INTERVAL_SECONDS; store and publish only online results."""
    logger.info(f"Weather worker started (interval: {settings.WEATHER_FETCH_INTERVAL_SECONDS}s)")
    while True:
        try:
            payload = await weather_service.get_current_weather(settings.WEATHER_LAT, settings.WEATHER_LON)
            if payload.get("is_online"):
                await weather_service.record_reading(payload)
                await publish({"type": "weather_update", "data": weather_service.build_weather_update(payload)})
            await asyncio.sleep(settings.WEATHER_FETCH_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Weather worker cancelled.")
            break
        except Exception as err:
            logger.debug(f"Weather worker idle: {err}")
            await asyncio.sleep(5.0)
