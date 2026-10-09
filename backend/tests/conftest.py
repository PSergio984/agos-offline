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


@pytest.fixture
def weights_path() -> Path:
    """Fixture providing dynamic path to YOLOv8 ONNX weights."""
    return Path(__file__).resolve().parent.parent / "app" / "ml" / "weights" / "best.onnx"


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
