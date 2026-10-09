"""End-to-end integration and API tests for AGOS-Offline FastAPI backend."""

import asyncio
import hashlib
import json
import sqlite3
import time
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import init_db
from app.main import app
from app.ml.occlusion import OcclusionStatus, TemporalOcclusionFilter
from app.services.cadence import CadenceController
from app.services.stream_service import StreamService, stream_service
from app.services.sync_service import sync_service
from app.services.weather_service import weather_service


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


def test_responders_and_groups_crud(client: TestClient):
    """Test full CRUD lifecycle for emergency responders and responder groups."""
    # 1. Verify default seeded groups exist
    groups_res = client.get("/api/v1/responder-groups")
    assert groups_res.status_code == 200
    groups = groups_res.json()
    assert len(groups) >= 3
    group_names = [g["name"] for g in groups]
    assert "Barangay Poblacion QRT" in group_names
    assert "Drainage Maintenance Unit" in group_names
    assert "Evacuation Coordination Unit" in group_names

    # 2. Verify default seeded responders exist and have preferences & group IDs
    resp_res = client.get("/api/v1/responders")
    assert resp_res.status_code == 200
    responders = resp_res.json()
    assert len(responders) >= 4
    juan = next(r for r in responders if r["first_name"] == "Juan")
    assert juan["status"] == "active"
    assert juan["notif_preferences"]["warning"] is True
    assert len(juan["group_ids"]) >= 1

    # 3. Create a new responder group
    new_group_payload = {
        "name": "Rapid Culvert Inspection Team",
        "description": "Mobile motorcycle scout unit for rapid culvert inspection.",
    }
    create_grp_res = client.post("/api/v1/responder-groups", json=new_group_payload)
    assert create_grp_res.status_code == 201
    created_group = create_grp_res.json()
    grp_id = created_group["id"]
    assert created_group["name"] == new_group_payload["name"]
    assert created_group["member_count"] == 0

    # 4. Create a new responder assigned to the new group
    new_resp_payload = {
        "first_name": "Mateo",
        "last_name": "Cruz",
        "phone_number": "+639991234567",
        "status": "active",
        "location": "Sector 4 Outpost",
        "notif_preferences": {
            "warning": True,
            "critical": True,
            "blockage": True,
            "announcement": False,
        },
        "group_ids": [grp_id],
    }
    create_resp_res = client.post("/api/v1/responders", json=new_resp_payload)
    assert create_resp_res.status_code == 201
    created_resp = create_resp_res.json()
    resp_id = created_resp["id"]
    assert created_resp["first_name"] == "Mateo"
    assert created_resp["notif_preferences"]["announcement"] is False
    assert created_resp["group_ids"] == [grp_id]

    # Verify group member count increased
    grp_check = client.get("/api/v1/responder-groups").json()
    target_grp = next(g for g in grp_check if g["id"] == grp_id)
    assert target_grp["member_count"] == 1

    # 5. Update responder details
    update_resp_res = client.put(
        f"/api/v1/responders/{resp_id}",
        json={
            "location": "Central EOC Headquarters",
            "notif_preferences": {
                "warning": False,
                "critical": True,
                "blockage": True,
                "announcement": True,
            },
        },
    )
    assert update_resp_res.status_code == 200
    updated_resp = update_resp_res.json()
    assert updated_resp["location"] == "Central EOC Headquarters"
    assert updated_resp["notif_preferences"]["warning"] is False

    # 6. Update group details
    update_grp_res = client.put(
        f"/api/v1/responder-groups/{grp_id}",
        json={"name": "Renamed Rapid Unit", "description": "Updated description"},
    )
    assert update_grp_res.status_code == 200
    assert update_grp_res.json()["name"] == "Renamed Rapid Unit"

    # 7. Delete responder
    del_resp_res = client.delete(f"/api/v1/responders/{resp_id}")
    assert del_resp_res.status_code == 200
    assert del_resp_res.json()["status"] == "success"

    # Verify deletion
    resp_list = client.get("/api/v1/responders").json()
    assert not any(r["id"] == resp_id for r in resp_list)

    # 8. Delete group
    del_grp_res = client.delete(f"/api/v1/responder-groups/{grp_id}")
    assert del_grp_res.status_code == 200
    grp_list = client.get("/api/v1/responder-groups").json()
    assert not any(g["id"] == grp_id for g in grp_list)


def test_notification_templates_and_announcement_dispatch(client: TestClient):
    """Test notification templates CRUD and announcement broadcast dispatch."""
    # 1. Verify default seeded templates exist
    tmpl_res = client.get("/api/v1/notification-templates")
    assert tmpl_res.status_code == 200
    templates = tmpl_res.json()
    assert len(templates) >= 4
    tmpl_types = [t["type"] for t in templates]
    assert "blockage" in tmpl_types
    assert "warning" in tmpl_types
    assert "critical" in tmpl_types
    assert "announcement" in tmpl_types

    # 2. Create custom template
    create_tmpl_res = client.post(
        "/api/v1/notification-templates",
        json={
            "type": "custom",
            "title": "Severe Weather Sluice Check",
            "message": "ATTENTION: Flash flood crest anticipated at {location}. Clear sluice gates.",
        },
    )
    assert create_tmpl_res.status_code == 201
    tmpl_data = create_tmpl_res.json()
    tmpl_id = tmpl_data["id"]
    assert tmpl_data["title"] == "Severe Weather Sluice Check"

    # 3. Update template
    update_tmpl_res = client.put(
        f"/api/v1/notification-templates/{tmpl_id}",
        json={"title": "Updated Sluice Gate Check"},
    )
    assert update_tmpl_res.status_code == 200
    assert update_tmpl_res.json()["title"] == "Updated Sluice Gate Check"

    # 4. Dispatch announcement targeting all active responders
    announce_payload = {
        "type": "announcement",
        "title": "City-Wide Pre-Emptive Drainage Clearing",
        "message": "All units initiate pre-emptive trash removal at assigned culverts.",
    }
    announce_res = client.post("/api/v1/notifications/announce", json=announce_payload)
    assert announce_res.status_code == 201
    dispatch = announce_res.json()
    disp_id = dispatch["id"]
    assert dispatch["title"] == announce_payload["title"]
    assert dispatch["status"] == "DISPATCHED"
    assert dispatch["recipient_count"] >= 4

    # 5. Verify dispatch appears in notification logs
    logs_res = client.get("/api/v1/notification-logs")
    assert logs_res.status_code == 200
    logs = logs_res.json()
    assert any(log["id"] == disp_id for log in logs)

    # 6. Verify entry was queued in sync_queue for cloud store-and-forward
    conn = _db()
    try:
        queue_row = conn.execute(
            "SELECT entity_type, entity_id, status FROM sync_queue WHERE entity_id = ?",
            (disp_id,),
        ).fetchone()
        assert queue_row is not None
        assert queue_row["entity_type"] == "NOTIFICATION_DISPATCH"
        assert queue_row["status"] == "PENDING"
    finally:
        conn.close()

    # 7. Delete custom template
    del_tmpl_res = client.delete(f"/api/v1/notification-templates/{tmpl_id}")
    assert del_tmpl_res.status_code == 200

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

# --- Telemetry envelopes, model status, weather and rain hazard -----------------------

STREAM_TICK_KEYS = {
    "type", "frame", "image", "frame_b64", "timestamp", "camera_id", "roi", "fps", "status",
    "occlusion_ratio", "raw_ratio", "debris_count", "detections", "connection", "detection",
}
DETECTION_KEYS = {
    "occlusion_ratio", "raw_ratio", "status", "raw_status", "boxes", "debris_count", "roi",
    "camera_id", "interval_seconds", "timestamp",
}
MODEL_STATUS_FIELDS = {
    "loaded", "weights_file", "weights_sha256", "weights_size_bytes", "input_shape", "output_shape",
    "class_names", "conf_threshold", "iou_threshold", "model_version", "training_source",
    "sidecar_hash_match", "input_source", "is_synthetic", "last_inference_at", "last_inference_ms",
    "interval_seconds", "next_inference_in",
}
FULL_ROI_BOX = [0.0, 0.0, 640.0, 480.0]  # covers the full-frame default ROI at 640x480
PARTIAL_BOX = [0.0, 0.0, 640.0 * 0.4, 480.0]  # 40 percent of the ROI width: WARNING band (20..59)


class _Detection:
    def __init__(self, box):
        self.box = list(box)
        self.confidence = 0.9
        self.class_id = 0
        self.class_name = "debris"

    def to_dict(self):
        return {"box": self.box, "confidence": self.confidence, "class_name": self.class_name}


@pytest.fixture
def fresh_stream(monkeypatch):
    """Reset the singleton's inference state so each test starts from CLEAR with an inference due."""
    svc = stream_service
    monkeypatch.setattr(svc, "_last_inference_time", 0.0)
    monkeypatch.setattr(svc, "_cadence", CadenceController())
    monkeypatch.setattr(
        svc,
        "_temporal_filter",
        TemporalOcclusionFilter(window_size=3, confirmation_count=2, initial_status=OcclusionStatus.CLEAR),
    )
    monkeypatch.setattr(settings, "INFERENCE_INTERVAL_CLEAR", 0.5)
    monkeypatch.setattr(settings, "INFERENCE_INTERVAL_BURST", 0.4)
    monkeypatch.setattr(svc, "_current_inference_interval", 0.5)
    monkeypatch.setattr(svc, "_latest_blockage_update", None)
    monkeypatch.setattr(svc, "_inference_stats", {"last_inference_ms": None})
    svc._events.clear()
    return svc


@pytest.fixture
def boxes(fresh_stream, monkeypatch):
    """Mutable detection list returned by the (mocked) inference engine."""
    holder: list = []
    monkeypatch.setattr(
        fresh_stream._inference_engine, "infer", lambda frame: [_Detection(b) for b in holder]
    )
    return holder


@pytest.fixture
def online_weather(monkeypatch):
    async def _online(*args, **kwargs):
        return {
            "is_online": True,
            "rainfall_mm": 20.0,
            "temperature_c": 27.0,
            "humidity_pct": 90.0,
            "condition": "Torrential Rain (Flood Risk)",
            "weather_code": 65,
            "message": "Torrential Rain (20.0 mm/hr)",
            "location": "Metro Manila (PAGASA Sector)",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cached": False,
        }

    monkeypatch.setattr(weather_service, "get_current_weather", _online)


def _wait_for(ws, msg_type, predicate=lambda msg: True, timeout=5.0):
    """Read WebSocket messages until one of `msg_type` satisfies `predicate` (5 s deadline)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        msg = ws.receive_json()
        if msg.get("type") == msg_type and predicate(msg):
            return msg
    raise AssertionError(f"no '{msg_type}' message within {timeout}s")


def _wait_for_weather_row(timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if weather_service.latest_reading():
            return
        time.sleep(0.05)
    raise AssertionError("weather worker stored no reading")


def test_stream_tick_key_sets_unchanged(client: TestClient, boxes):
    with client.websocket_connect("/ws") as ws:
        tick = _wait_for(ws, "stream_tick", lambda m: "interval_seconds" in m["detection"])
    assert set(tick) == STREAM_TICK_KEYS
    assert set(tick["detection"]) == DETECTION_KEYS
    assert set(tick["connection"]) == {"is_connected", "is_synthetic", "source_type", "source", "error"}


def _sidecar_model_version() -> str:
    """model_version recorded in the live weights sidecar (changes whenever new weights are deployed)."""
    sidecar = settings.WEIGHTS_PATH.with_name(settings.WEIGHTS_PATH.name + ".json")
    return json.loads(sidecar.read_text(encoding="utf-8"))["model_version"]


def test_connect_sends_connected_then_model_status(client: TestClient, boxes):
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "connected"
        msg = _wait_for(ws, "model_status")
    data = msg["data"]
    assert set(data) == MODEL_STATUS_FIELDS
    assert data["loaded"] is True
    assert data["weights_file"] == "best.onnx"  # name only, never a path
    expected_sha = hashlib.sha256(settings.WEIGHTS_PATH.read_bytes()).hexdigest()
    assert data["weights_sha256"] == expected_sha
    assert data["sidecar_hash_match"] is True
    assert data["model_version"] == _sidecar_model_version()
    assert data["class_names"] == ["debris"]
    assert data["input_source"] == "demo"


def test_health_has_nested_model_with_same_fields(client: TestClient, boxes):
    model = client.get("/health").json()["model"]
    assert set(model) == MODEL_STATUS_FIELDS
    with client.websocket_connect("/ws") as ws:
        ws_model = _wait_for(ws, "model_status")["data"]
    for key in ("weights_sha256", "model_version", "class_names", "input_shape", "output_shape"):
        assert model[key] == ws_model[key]


def test_blockage_update_maps_status(client: TestClient, boxes):
    mapping = []
    with client.websocket_connect("/ws") as ws:
        first = _wait_for(ws, "blockage_detection_update")["data"]
        mapping.append((first["status"], first["blockage_status"]))
        assert set(first) == {
            "camera_id", "status", "blockage_status", "blockage_percentage", "raw_ratio", "timestamp"
        }
        boxes[:] = [PARTIAL_BOX]
        partial = _wait_for(ws, "blockage_detection_update", lambda m: m["data"]["status"] == "WARNING")["data"]
        mapping.append((partial["status"], partial["blockage_status"]))
        boxes[:] = [FULL_ROI_BOX]
        blocked = _wait_for(ws, "blockage_detection_update", lambda m: m["data"]["status"] == "CRITICAL")["data"]
        mapping.append((blocked["status"], blocked["blockage_status"]))
        assert blocked["blockage_percentage"] == round(blocked["blockage_percentage"], 2)
    assert mapping == [("CLEAR", "clear"), ("WARNING", "partial"), ("CRITICAL", "blocked")]


def test_incident_created_envelope_is_tagged_demo(client: TestClient, boxes):
    with client.websocket_connect("/ws") as ws:
        _wait_for(ws, "model_status")
        boxes[:] = [FULL_ROI_BOX]
        created = _wait_for(ws, "incident_created")["data"]
    assert created["source_type"] == "demo"
    assert created["status"] == "CRITICAL"
    assert created["model_version"] == _sidecar_model_version()
    listed = {i["id"]: i for i in client.get("/api/v1/incidents").json()}
    assert listed[created["id"]]["source_type"] == "demo"
    assert listed[created["id"]]["model_sha256"] == created["model_sha256"]


def test_weather_update_on_connect_and_hazard_auto(online_weather, client: TestClient, boxes):
    _wait_for_weather_row()
    with client.websocket_connect("/ws") as ws:
        data = _wait_for(ws, "weather_update")["data"]
    assert data["precipitation_mm"] == 20.0
    assert data["weather_code"] == 65
    parsed = datetime.fromisoformat(data["timestamp"])
    assert parsed.utcoffset().total_seconds() == 0  # UTC
    assert data["rain_hazard"] == {"active": True, "source": "auto", "threshold_mm": 15.0}

    weather = client.get("/api/v1/weather").json()
    assert weather["rain_hazard"]["active"] is True
    assert client.get("/api/v1/weather/hazard").json()["active"] is True


def test_hazard_override_roundtrip_and_broadcast(client: TestClient, boxes):
    assert client.get("/api/v1/weather/hazard").json() == {"active": False, "source": "auto", "threshold_mm": 15.0}
    with client.websocket_connect("/ws") as ws:
        _wait_for(ws, "model_status")
        res = client.put("/api/v1/weather/hazard/override", json={"active": True})
        assert res.json() == {"active": True, "source": "override", "threshold_mm": 15.0}
        update = _wait_for(ws, "weather_update")["data"]
    assert update["rain_hazard"]["source"] == "override"
    assert update["rain_hazard"]["active"] is True
    assert set(update) == {"precipitation_mm", "weather_code", "timestamp", "condition", "is_online", "rain_hazard"}

    res = client.put("/api/v1/weather/hazard/override", json={"active": None})
    assert res.json()["source"] == "auto"
    assert res.json()["active"] is False


@pytest.mark.parametrize("hazard", [True, False])
def test_hazard_never_changes_cadence_status_or_incident(client: TestClient, boxes, hazard):
    client.put("/api/v1/weather/hazard/override", json={"active": hazard})
    with client.websocket_connect("/ws") as ws:
        _wait_for(ws, "model_status")
        boxes[:] = [FULL_ROI_BOX]
        created = _wait_for(ws, "incident_created")["data"]
        status = _wait_for(ws, "model_status", lambda m: m["data"]["interval_seconds"] == 0.4)["data"]
        update = _wait_for(ws, "blockage_detection_update", lambda m: m["data"]["status"] == "CRITICAL")["data"]
    assert created["status"] == "CRITICAL"
    assert status["interval_seconds"] == 0.4  # burst cadence, identical with hazard on or off
    assert update["blockage_status"] == "blocked"
    assert len([i for i in client.get("/api/v1/incidents").json() if i["is_open"] == 1]) == 1


# --- Warning detections are logged with their boxed image ---


class _Clock:
    def __init__(self):
        self.now = 1_700_000_000.0

    def __call__(self):
        return self.now


class _LogDriver:
    """A private StreamService on its own camera, so the app's singleton stream cannot interfere."""

    def __init__(self, camera_id="cam-log-test"):
        self.clock = _Clock()
        self.service = StreamService(clock=self.clock)
        self.service._camera_id = camera_id
        self.box = PARTIAL_BOX
        self.service._inference_engine.infer = lambda frame: [_Detection(self.box)]

    def step(self, seconds, box):
        self.clock.now += seconds
        self.box = box
        self.service._run_inference_if_due(np.zeros((480, 640, 3), dtype=np.uint8))


@pytest.fixture
def served_storage(test_storage_dir, monkeypatch):
    """Point the app's /storage static mount at the temp storage root used by the stream service."""
    mount = next(r for r in app.routes if getattr(r, "path", None) == "/storage")
    monkeypatch.setattr(mount.app, "directory", test_storage_dir.parent)
    monkeypatch.setattr(mount.app, "all_directories", [test_storage_dir.parent])
    return test_storage_dir


def _logged(client: TestClient, camera_id="cam-log-test"):
    return [i for i in client.get("/api/v1/incidents").json() if i["camera_id"] == camera_id]


def test_warning_incident_is_listed_with_a_servable_cache_safe_image(client: TestClient, served_storage):
    driver = _LogDriver()
    driver.step(1, PARTIAL_BOX)
    driver.step(3, PARTIAL_BOX)

    incidents = _logged(client)
    assert len(incidents) == 1
    inc = incidents[0]
    assert inc["status"] == "WARNING"
    assert inc["is_open"] == 1
    base, _, version = inc["snapshot_url"].partition("?v=")
    assert base == f"/storage/incidents/{inc['id']}.jpg"
    assert version.isdigit()

    res = client.get(inc["snapshot_url"])
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    assert res.content[:2] == b"\xff\xd8"

    # A new coverage peak rewrites the image and changes the URL, so the browser cannot show a stale copy
    driver.step(3, [0.0, 0.0, 640.0 * 0.55, 480.0])
    refreshed = _logged(client)[0]
    assert refreshed["snapshot_url"] != inc["snapshot_url"]
    assert client.get(refreshed["snapshot_url"]).content != res.content


def test_missing_or_empty_image_paths_are_returned_unchanged(client: TestClient):
    conn = _db()
    try:
        for inc_id, path in (("inc-missing-img", "/storage/incidents/test.jpg"), ("inc-no-img", "")):
            conn.execute(
                "INSERT INTO incidents (id, camera_id, timestamp, occlusion_ratio, status, image_path, debris_count) "
                "VALUES (?, 'cam-default', '2026-01-01 00:00:00', 30.0, 'WARNING', ?, 1)",
                (inc_id, path),
            )
        conn.commit()
    finally:
        conn.close()
    urls = {i["id"]: i["snapshot_url"] for i in client.get("/api/v1/incidents").json()}
    assert urls["inc-missing-img"] == "/storage/incidents/test.jpg"
    assert urls["inc-no-img"] == ""


def test_upgraded_incident_syncs_as_an_upsert_with_its_final_status(client: TestClient, online, monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.invalid")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "key")
    posts = []

    class RecordingClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            posts.append({"payload": json, "prefer": headers["Prefer"]})
            return _FakeResponse(201)

    monkeypatch.setattr("app.services.sync_service.httpx.AsyncClient", RecordingClient)

    driver = _LogDriver()
    driver.step(1, PARTIAL_BOX)
    driver.step(3, PARTIAL_BOX)
    assert client.post("/api/v1/sync/flush").json()["synced_count"] == 1  # delivered as WARNING

    driver.step(3, FULL_ROI_BOX)
    driver.step(3, FULL_ROI_BOX)
    assert _logged(client)[0]["status"] == "CRITICAL"
    assert _logged(client)[0]["cloud_synced"] is False  # the cloud copy is stale until re-sent
    assert client.post("/api/v1/sync/flush").json()["synced_count"] == 1

    assert [p["payload"]["status"] for p in posts] == ["WARNING", "CRITICAL"]
    assert len({p["payload"]["id"] for p in posts}) == 1
    assert all("merge-duplicates" in p["prefer"] for p in posts)
    assert _logged(client)[0]["cloud_synced"] is True
    assert client.get("/api/v1/sync/status").json()["pending_count"] == 0
