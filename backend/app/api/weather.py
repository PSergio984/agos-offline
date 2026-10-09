from fastapi import APIRouter
from app.services.weather_service import weather_service

router = APIRouter()


@router.get("")
async def get_weather(lat: float = 14.5995, lon: float = 120.9842):
    """Retrieve current weather telemetry or graceful offline status with strict 2s timeout."""
    return await weather_service.get_current_weather(lat, lon)
