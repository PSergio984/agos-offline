"""Pytest fixtures and configuration for AGOS-Offline tests."""

import asyncio
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

# Ensure backend directory is in sys.path
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import settings  # noqa: E402
from app.core.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.services.stream_service import stream_service  # noqa: E402
from app.services.weather_service import weather_service  # noqa: E402


@pytest.fixture
def weights_path() -> Path:
    """Fixture providing dynamic path to YOLOv8 ONNX weights."""
    return Path(__file__).resolve().parent.parent / "app" / "ml" / "weights" / "best.onnx"


@pytest.fixture(autouse=True)
def test_storage_dir(tmp_path, monkeypatch):
    """Point incident snapshot storage at a temp dir so tests never write real JPEGs."""
    storage_dir = tmp_path / "incidents"
    storage_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "STORAGE_DIR", storage_dir)
    return storage_dir


OFFLINE_WEATHER = {
    "is_online": False,
    "rainfall_mm": 0.0,
    "temperature_c": None,
    "humidity_pct": None,
    "condition": "Offline Mode",
    "weather_code": None,
    "message": "Offline (Weather unavailable)",
    "location": "Local Command Center",
    "timestamp": "2026-01-01T00:00:00+00:00",
    "cached": False,
}


@pytest.fixture(autouse=True)
def offline_weather(monkeypatch):
    """Keep tests network free: the weather fetcher returns a deterministic offline payload."""

    async def _offline(*args, **kwargs):
        return dict(OFFLINE_WEATHER)

    monkeypatch.setattr(weather_service, "get_current_weather", _offline)
    weather_service.set_override(None)
    yield
    weather_service.set_override(None)


@pytest.fixture(autouse=True)
def test_db(tmp_path, monkeypatch):
    """
    Test SQLite database fixture pointing settings.DATABASE_PATH to a temporary
    sqlite db and initializing tables via init_db.
    """
    temp_db = tmp_path / "test_agos.db"
    monkeypatch.setattr(settings, "DATABASE_PATH", temp_db)
    asyncio.run(init_db())
    yield temp_db
    if stream_service.is_running:
        stream_service.stop()


@pytest.fixture
def client(test_db):
    """
    FastAPI TestClient fixture managing lifespan and background threads.
    """
    with TestClient(app) as test_client:
        yield test_client
    if stream_service.is_running:
        stream_service.stop()
