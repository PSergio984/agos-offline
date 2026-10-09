from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.ws import manager
from app.services.weather_service import weather_service

router = APIRouter()


class HazardOverrideRequest(BaseModel):
    active: Optional[bool] = None  # None returns the hazard to automatic


def _latest_precipitation() -> Optional[float]:
    row = weather_service.latest_reading()
    return row["precipitation_mm"] if row else None


@router.get("")
async def get_weather(lat: Optional[float] = None, lon: Optional[float] = None):
    """Retrieve current weather telemetry or graceful offline status with strict 2s timeout."""
    payload = await weather_service.get_current_weather(lat, lon)
    precip = payload.get("rainfall_mm") if payload.get("is_online") else None
    return {**payload, "rain_hazard": weather_service.get_rain_hazard(precip)}


@router.get("/hazard")
async def get_hazard():
    """Current rain hazard state (auto from the latest stored reading, or operator override)."""
    return weather_service.get_rain_hazard(_latest_precipitation())


@router.put("/hazard/override")
async def set_hazard_override(body: HazardOverrideRequest):
    """Force the rain hazard on/off, or send {"active": null} to return to auto."""
    weather_service.set_override(body.active)
    await manager.broadcast_json(
        {"type": "weather_update", "data": weather_service.build_stored_weather_update()}
    )
    return weather_service.get_rain_hazard(_latest_precipitation())
