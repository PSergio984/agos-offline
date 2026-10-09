"""End-to-end integration and API tests for AGOS-Offline FastAPI backend."""

import asyncio
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import init_db
from app.services.sync_service import sync_service


def test_health_check(client: TestClient):
    """Test /health endpoint for correct online status and telemetry."""
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "online"
    assert data["project"] == "AGOS-Offline"
    assert data["environment"] == "offline-edge"
    assert "active_camera_id" in data
    assert "stream" in data


def test_cameras_api(client: TestClient):
    """Test camera listing and ROI update via PUT and POST."""
    # List cameras
    res = client.get("/api/v1/cameras")
    assert res.status_code == 200
    cameras = res.json()
    assert len(cameras) >= 1
    default_cam = cameras[0]
    assert default_cam["id"] == "cam-default"

    # Update ROI using PUT array format
    res_put = client.put(
        f"/api/v1/cameras/{default_cam['id']}/roi",
        json={"roi": [0.22, 0.42, 0.78, 0.88]},
    )
    assert res_put.status_code == 200
    assert res_put.json()["roi"] == [0.22, 0.42, 0.78, 0.88]

    # Update ROI using POST individual coordinates format
    res_post = client.post(
        f"/api/v1/cameras/{default_cam['id']}/roi",
        json={"x_min": 0.20, "y_min": 0.40, "x_max": 0.80, "y_max": 0.90},
    )
    assert res_post.status_code == 200
    assert res_post.json()["roi"] == [0.20, 0.40, 0.80, 0.90]


def test_incidents_api(client: TestClient):
    """Test creating an incident, retrieving the list, and resolving it."""
    payload = {
        "camera_id": "cam-default",
        "occlusion_ratio": 72.5,
        "status": "CRITICAL",
        "image_path": "/storage/incidents/test.jpg",
        "debris_count": 4,
        "radio_ticket": "Command: Blockage at cam-default",
    }
    res = client.post("/api/v1/incidents", json=payload)
    assert res.status_code == 200
    inc_data = res.json()
    inc_id = inc_data["id"]
    assert inc_data["occlusion_ratio"] == 72.5

    # List incidents
    list_res = client.get("/api/v1/incidents")
    assert list_res.status_code == 200
    items = list_res.json()
    assert any(i["id"] == inc_id for i in items)

    # Resolve incident
    resolve_res = client.post(f"/api/v1/incidents/{inc_id}/resolve")
    assert resolve_res.status_code == 200
    assert resolve_res.json()["status"] == "success"


def test_weather_and_sync_api(client: TestClient):
    """Test offline-first weather endpoint and store-and-forward sync status."""
    # Weather endpoint
    res_weather = client.get("/api/v1/weather")
    assert res_weather.status_code == 200
    w_data = res_weather.json()
    assert "is_online" in w_data
    assert "condition" in w_data

    # Sync status endpoint
    res_sync = client.get("/api/v1/sync/status")
    assert res_sync.status_code == 200
    s_data = res_sync.json()
    assert "is_online" in s_data
    assert "status" in s_data
    assert "pending_count" in s_data


def test_websocket_stream(client: TestClient):
    """
    Test live WebSocket endpoint handshake and ping/pong handling,
    draining asynchronous stream_tick broadcast frames safely.
    """
    with client.websocket_connect("/ws") as ws:
        # 1. Drain/receive until handshake "connected" message is captured
        handshake = None
        for _ in range(10):
            msg = ws.receive_json()
            if msg.get("type") == "connected":
                handshake = msg
                break
        assert handshake is not None, "Failed to receive connected handshake from WebSocket"
        assert "camera_id" in handshake
        assert "roi" in handshake

        # 2. Test ping / pong interaction while handling concurrent stream_ticks
        ws.send_text('{"type": "ping"}')
        pong = None
        for _ in range(10):
            reply = ws.receive_json()
            if reply.get("type") == "pong":
                pong = reply
                break
        assert pong is not None, "Failed to receive pong from WebSocket"
        assert pong["type"] == "pong"

# --- Sync correctness and migration --------------------------------------------------


def _db():
    conn = sqlite3.connect(str(settings.DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_incident(synced: int = 0, incident_id: str = "inc-test0001") -> str:
    conn = _db()
    try:
        conn.execute(
            """
            INSERT INTO incidents (id, camera_id, timestamp, occlusion_ratio, status, synced)
            VALUES (?, 'cam-default', '2026-01-01 10:00:00', 80.0, 'CRITICAL', ?)
            """,
            (incident_id, synced),
        )
        conn.execute(
            "INSERT INTO sync_queue (id, entity_type, entity_id, payload, status) "
            "VALUES (?, 'incident', ?, '{\"id\": \"x\"}', 'PENDING')",
            (f"sync-{incident_id}", incident_id),
        )
        conn.commit()
    finally:
        conn.close()
    return incident_id


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code
        self.text = "fake"


def _fake_async_client(status_code=None, error=None):
    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *args, **kwargs):
            if error:
                raise error
            return _FakeResponse(status_code)

    return FakeAsyncClient


@pytest.fixture
def online(monkeypatch):
    async def _reachable():
        return True

    monkeypatch.setattr(sync_service, "check_internet_reachability", _reachable)


def test_unconfigured_flush_leaves_rows_pending(client: TestClient, online, monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "")
    inc_id = _seed_incident()

    res = client.post("/api/v1/sync/flush").json()
    assert res["success"] is False
    assert "pending" in res["message"]

    status = client.get("/api/v1/sync/status").json()
    assert status["has_supabase_configured"] is False
    assert status["pending_count"] == 1
    assert status["status"] != "SYNCED_CLOUD"

    incident = next(i for i in client.get("/api/v1/incidents").json() if i["id"] == inc_id)
    assert incident["cloud_synced"] is False
    assert incident["synced"] == 0


def test_failed_post_increments_retry_count(client: TestClient, online, monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.invalid")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "key")
    inc_id = _seed_incident()

    for fake in (_fake_async_client(status_code=500), _fake_async_client(error=RuntimeError("boom"))):
        monkeypatch.setattr("app.services.sync_service.httpx.AsyncClient", fake)
        client.post("/api/v1/sync/flush")

    conn = _db()
    try:
        row = conn.execute("SELECT status, retry_count FROM sync_queue WHERE entity_id = ?", (inc_id,)).fetchone()
        inc = conn.execute("SELECT cloud_synced, synced FROM incidents WHERE id = ?", (inc_id,)).fetchone()
    finally:
        conn.close()
    assert row["status"] == "PENDING"
    assert row["retry_count"] == 2
    assert inc["cloud_synced"] == 0
    assert inc["synced"] == 0


def test_successful_sync_sets_cloud_synced_without_touching_dispatch_state(
    client: TestClient, online, monkeypatch
):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.invalid")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "key")
    dispatched = _seed_incident(synced=1, incident_id="inc-dispatched")
    resolved = _seed_incident(synced=2, incident_id="inc-resolved")
    pending = _seed_incident(synced=0, incident_id="inc-pending")
    monkeypatch.setattr("app.services.sync_service.httpx.AsyncClient", _fake_async_client(status_code=201))

    res = client.post("/api/v1/sync/flush").json()
    assert res["success"] is True
    assert res["synced_count"] == 3

    by_id = {i["id"]: i for i in client.get("/api/v1/incidents").json()}
    assert by_id[dispatched]["action_taken"] == "DISPATCHED"
    assert by_id[resolved]["action_taken"] == "RESOLVED"
    assert by_id[pending]["action_taken"] == "PENDING"
    assert all(by_id[i]["cloud_synced"] is True for i in (dispatched, resolved, pending))

    status = client.get("/api/v1/sync/status").json()
    assert status["status"] == "SYNCED_CLOUD"


def test_double_dispatch_is_idempotent_and_never_downgrades_resolved(client: TestClient):
    inc_id = _seed_incident()
    assert client.post(f"/api/v1/incidents/{inc_id}/dispatch").status_code == 200
    assert client.post(f"/api/v1/incidents/{inc_id}/dispatch").status_code == 200
    conn = _db()
    try:
        assert conn.execute("SELECT synced FROM incidents WHERE id = ?", (inc_id,)).fetchone()[0] == 1
    finally:
        conn.close()

    client.post(f"/api/v1/incidents/{inc_id}/resolve")
    client.post(f"/api/v1/incidents/{inc_id}/dispatch")
    conn = _db()
    try:
        assert conn.execute("SELECT synced FROM incidents WHERE id = ?", (inc_id,)).fetchone()[0] == 2
    finally:
        conn.close()


def test_manual_incident_is_tagged_and_never_open(client: TestClient):
    res = client.post(
        "/api/v1/incidents",
        json={"camera_id": "cam-default", "occlusion_ratio": 70.0, "status": "CRITICAL"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["source_type"] == "manual"
    assert body["is_open"] == 0


LEGACY_INCIDENTS_DDL = """
CREATE TABLE incidents (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    occlusion_ratio REAL NOT NULL,
    status TEXT NOT NULL,
    image_path TEXT DEFAULT '',
    debris_count INTEGER NOT NULL DEFAULT 0,
    radio_ticket TEXT DEFAULT '',
    synced INTEGER NOT NULL DEFAULT 0
);
"""


def test_legacy_database_migrates_without_data_loss(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy.db"
    conn = sqlite3.connect(str(legacy))
    conn.execute(LEGACY_INCIDENTS_DDL)
    conn.execute(
        "CREATE TABLE sync_queue (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, "
        "payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', retry_count INTEGER NOT NULL DEFAULT 0, "
        "created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), "
        "updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))"
    )
    conn.execute(
        "INSERT INTO incidents (id, camera_id, occlusion_ratio, status, synced) VALUES ('inc-old1', 'cam-default', 75.0, 'CRITICAL', 1)"
    )
    conn.execute(
        "INSERT INTO incidents (id, camera_id, occlusion_ratio, status, synced) VALUES ('inc-old2', 'cam-default', 65.0, 'CRITICAL', 0)"
    )
    conn.execute("INSERT INTO sync_queue (id, entity_type, entity_id, payload, status) VALUES ('s1', 'incident', 'inc-old1', '{}', 'SYNCED')")
    conn.commit()
    conn.close()

    monkeypatch.setattr(settings, "DATABASE_PATH", legacy)
    asyncio.run(init_db())
    asyncio.run(init_db())  # idempotent

    conn = sqlite3.connect(str(legacy))
    conn.row_factory = sqlite3.Row
    try:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(incidents)")}
        rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM incidents")}
        indexes = {r["name"] for r in conn.execute("PRAGMA index_list(incidents)")}
    finally:
        conn.close()

    assert {"is_open", "closed_at", "duration_seconds", "source_type", "cloud_synced"} <= columns
    assert "ux_incidents_one_open_per_camera" in indexes
    assert set(rows) == {"inc-old1", "inc-old2"}
    assert rows["inc-old1"]["occlusion_ratio"] == 75.0
    assert rows["inc-old1"]["synced"] == 1  # ambiguous legacy dispatch state left untouched
    assert rows["inc-old1"]["cloud_synced"] == 1  # backfilled from SYNCED queue row
    assert rows["inc-old2"]["cloud_synced"] == 0
    assert rows["inc-old1"]["source_type"] == "unknown"
    assert rows["inc-old1"]["is_open"] == 0