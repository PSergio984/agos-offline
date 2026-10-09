"""Offline-first weather fetcher for AGOS-Offline.

Queries current precipitation and meteorological telemetry with a strict
2.0-second timeout. If offline or unreachable, returns graceful fallback
without blocking any local AI or console operations.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

import httpx

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
                        "message": f"{condition} ({precip:.1f} mm/hr)",
                        "location": "Metro Manila (PAGASA Sector)",
                        "timestamp": datetime.now().isoformat(),
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
            "message": "Offline (Weather unavailable)",
            "location": "Local Command Center",
            "timestamp": datetime.now().isoformat(),
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
