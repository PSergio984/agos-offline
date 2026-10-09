import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
import httpx

from app.main import app
from app.services.sms_service import sms_service


@pytest.mark.asyncio
async def test_sms_config_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Get config
        resp = await client.get("/api/v1/sms/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "mode" in data
        assert "gateway_url" in data

        # 2. Update config
        update_payload = {
            "mode": "mock",
            "gateway_url": "http://192.168.1.150:8080",
            "cooldown_minutes": 20,
        }
        resp = await client.put("/api/v1/sms/config", json=update_payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["gateway_url"] == "http://192.168.1.150:8080"
        assert data["cooldown_minutes"] == 20
        assert data["mode"] == "mock"


@pytest.mark.asyncio
async def test_sms_ping_mock():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/sms/ping")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ONLINE"
        assert data["mode"] == "mock"


@pytest.mark.asyncio
async def test_sms_test_dispatch_mock():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "phone_number": "+639171234567",
            "message": "Unit Test Message",
        }
        resp = await client.post("/api/v1/sms/test", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "SENT"
        assert data["phone_number"] == "+639171234567"
        assert data["mode"] == "mock"


@pytest.mark.asyncio
async def test_sms_announcement_integration():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "type": "announcement",
            "title": "Emergency Evacuation Drill",
            "message": "All responders report to staging area.",
            "target_group_id": "grp-poblacion",
        }
        resp = await client.post("/api/v1/notifications/announce", json=payload)
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Emergency Evacuation Drill"
        assert data["status"] in ["DISPATCHED", "PARTIAL", "SENT"]
        assert data["recipient_count"] >= 1


@pytest.mark.asyncio
async def test_sms_live_mode_with_mock_client():
    # Test live mode HTTP call to Android SMSGate app with mock httpx responses
    await sms_service.update_config({"mode": "live", "gateway_url": "http://192.168.1.99:8080", "api_key": "user:pass"})

    mock_resp = httpx.Response(status_code=200, json={"state": "success"})
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp):
        res = await sms_service.send_one_sms("+639171234567", "Live test")
        assert res["status"] == "SENT"
        assert res["mode"] == "live"

    # Reset back to mock mode
    await sms_service.update_config({"mode": "mock"})


@pytest.mark.asyncio
async def test_dual_dispatch_smart_status_and_idempotency():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create an incident
        create_res = await client.post("/api/v1/incidents", json={
            "camera_id": "cam-default",
            "occlusion_ratio": 78.5,
            "status": "CRITICAL",
        })
        assert create_res.status_code == 200
        inc_data = create_res.json()
        inc_id = inc_data["id"]

        # 2. Check dispatch status prior to dispatch
        status_res = await client.get(f"/api/v1/incidents/{inc_id}/dispatch-status")
        assert status_res.status_code == 200
        s_data = status_res.json()
        assert s_data["incident_id"] == inc_id
        assert s_data["radio_dispatched"] is False
        assert s_data["sms_dispatched"] is False

        # 3. Perform dual dispatch with send_sms=True
        disp_res = await client.post(f"/api/v1/incidents/{inc_id}/dispatch", json={
            "radio_ticket": "RAD-TEST01",
            "channel": "CH-14 (156.700 MHz DRRMO Tac 1)",
            "assigned_group_id": "grp-drainage",
            "send_sms": True,
        })
        assert disp_res.status_code == 200
        d_data = disp_res.json()
        assert d_data["radio_ticket"] == "RAD-TEST01"
        assert d_data["radio_dispatched"] is True
        assert d_data["sms_already_sent"] is False
        assert d_data["sms_status"] in ("SENT", "DISPATCHED")

        # 4. Check dispatch status now reflects both radio and SMS
        status_res2 = await client.get(f"/api/v1/incidents/{inc_id}/dispatch-status")
        assert status_res2.status_code == 200
        s_data2 = status_res2.json()
        assert s_data2["radio_dispatched"] is True
        assert s_data2["radio_ticket"] == "RAD-TEST01"
        assert s_data2["sms_dispatched"] is True

        # 5. Perform second dispatch: must detect sms_already_sent=True and NOT duplicate SMS
        disp_res2 = await client.post(f"/api/v1/incidents/{inc_id}/dispatch", json={
            "radio_ticket": "RAD-TEST01",
            "send_sms": True,
        })
        assert disp_res2.status_code == 200
        d_data2 = disp_res2.json()
        assert d_data2["sms_already_sent"] is True

