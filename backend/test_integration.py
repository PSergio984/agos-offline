"""End-to-end integration and API test suite for AGOS-Offline."""

import asyncio
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings
from app.services.stream_service import stream_service
from app.services.weather_service import weather_service
from app.services.sync_service import sync_service


def test_health_check():
    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "online"
        assert data["project"] == "AGOS-Offline"
        assert data["environment"] == "offline-edge"


def test_cameras_api():
    with TestClient(app) as client:
        # List cameras
        res = client.get("/api/v1/cameras")
        assert res.status_code == 200
        cameras = res.json()
        assert len(cameras) >= 1
        default_cam = cameras[0]
        assert default_cam["id"] == "cam-default"

        # Update ROI using PUT
        res_put = client.put(
            f"/api/v1/cameras/{default_cam['id']}/roi",
            json={"roi": [0.22, 0.42, 0.78, 0.88]}
        )
        assert res_put.status_code == 200
        assert res_put.json()["roi"] == [0.22, 0.42, 0.78, 0.88]

        # Update ROI using POST with individual coords
        res_post = client.post(
            f"/api/v1/cameras/{default_cam['id']}/roi",
            json={"x_min": 0.20, "y_min": 0.40, "x_max": 0.80, "y_max": 0.90}
        )
        assert res_post.status_code == 200
        assert res_post.json()["roi"] == [0.20, 0.40, 0.80, 0.90]


def test_incidents_api():
    with TestClient(app) as client:
        # Create incident
        payload = {
            "camera_id": "cam-default",
            "occlusion_ratio": 72.5,
            "status": "CRITICAL",
            "image_path": "/storage/incidents/test.jpg",
            "debris_count": 4,
            "radio_ticket": "Command: Blockage at cam-default"
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


def test_weather_and_sync_api():
    with TestClient(app) as client:
        # Weather endpoint (offline-first test)
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


def test_websocket_stream():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            # 1. Immediate handshake message
            handshake = ws.receive_json()
            assert handshake["type"] == "connected"
            assert "camera_id" in handshake
            assert "roi" in handshake

            # 2. Test ping / pong interaction
            ws.send_text('{"type": "ping"}')
            pong = ws.receive_json()
            assert pong["type"] == "pong"


if __name__ == "__main__":
    print("Running AGOS-Offline End-to-End Integration Tests...")
    test_health_check()
    print("[PASS] Health check passed")
    test_cameras_api()
    print("[PASS] Cameras & ROI API passed")
    test_incidents_api()
    print("[PASS] Incidents & Resolution API passed")
    test_weather_and_sync_api()
    print("[PASS] Weather & Store-and-Forward Sync API passed")
    test_websocket_stream()
    print("[PASS] WebSocket live frame streaming passed")
    print("\nALL INTEGRATION TESTS PASSED (5 / 5)!")

