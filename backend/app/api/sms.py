from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.sms_service import sms_service

router = APIRouter()


class SmsConfigUpdateRequest(BaseModel):
    enabled: Optional[int] = Field(None, ge=0, le=1)
    mode: Optional[str] = Field(None, pattern="^(live|mock)$")
    gateway_url: Optional[str] = Field(None, min_length=1, max_length=200)
    api_key: Optional[str] = Field(None, min_length=1, max_length=200)
    cooldown_minutes: Optional[int] = Field(None, ge=1, le=120)
    max_retries: Optional[int] = Field(None, ge=1, le=10)
    default_group_id: Optional[str] = Field(None, max_length=100)


class SmsTestRequest(BaseModel):
    phone_number: str = Field(..., min_length=7, max_length=30)
    message: Optional[str] = Field(
        "AGOS-Offline Test Alert: Phone SMS Gateway is successfully connected and operational.",
        max_length=300,
    )


@router.get("/sms/config", response_model=Dict[str, Any])
async def get_sms_config():
    """Retrieve current SMS gateway settings, mode, and last ping status."""
    return await sms_service.get_config()


@router.put("/sms/config", response_model=Dict[str, Any])
async def update_sms_config(payload: SmsConfigUpdateRequest):
    """Update SMS gateway connection details, operating mode, or cooldown."""
    updates = payload.model_dump(exclude_unset=True)
    return await sms_service.update_config(updates)


@router.get("/sms/ping", response_model=Dict[str, Any])
async def ping_sms_gateway():
    """Test network connectivity to the Android SMSGate phone."""
    return await sms_service.ping_gateway()


@router.post("/sms/test", response_model=Dict[str, Any])
async def test_sms_dispatch(payload: SmsTestRequest):
    """Dispatch an immediate test SMS to verify phone SIM delivery."""
    result = await sms_service.send_one_sms(
        phone_number=payload.phone_number,
        message=payload.message or "AGOS-Offline test SMS",
    )
    if result.get("status") == "FAILED":
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"SMS delivery failed: {result.get('error', 'Unknown error')}",
        )
    return result
