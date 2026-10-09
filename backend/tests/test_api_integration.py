"""End-to-end integration and API tests for AGOS-Offline FastAPI backend."""

from fastapi.testclient import TestClient


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
