import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import aiosqlite

from app.core.database import SQL_SELECT_INCIDENTS, get_db, serialize_incident

router = APIRouter()


class IncidentCreateRequest(BaseModel):
    camera_id: str
    occlusion_ratio: float
    status: str
    image_path: Optional[str] = ""
    debris_count: int = 0
    radio_ticket: Optional[str] = ""


class DispatchRequest(BaseModel):
    radio_ticket: Optional[str] = None
    channel: Optional[str] = None
    assigned_group_id: Optional[str] = None
    send_sms: Optional[bool] = False
    notes: Optional[str] = ""


@router.get("", response_model=List[Dict[str, Any]])
async def list_incidents(
    limit: int = 50,
    status: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    """List recent blockage incidents from SQLite joined with camera location."""
    query = SQL_SELECT_INCIDENTS
    params = []
    if status:
        query += " WHERE i.status = ?"
        params.append(status.upper())
    query += " ORDER BY i.timestamp DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, tuple(params))
    rows = await cursor.fetchall()
    
    result = []
    for r in rows:
        result.append(serialize_incident(r))
    return result


@router.get("/{incident_id}/dispatch-status")
async def get_incident_dispatch_status(
    incident_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Get current radio and SMS dispatch status and ticket for an incident."""
    cursor = await db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    inc = dict(row)

    # Check notification dispatches for linked SMS
    cursor = await db.execute(
        """
        SELECT nd.*, rg.name as target_group_name 
        FROM notification_dispatches nd
        LEFT JOIN responder_groups rg ON nd.target_group_id = rg.id
        WHERE nd.incident_id = ? OR (nd.radio_ticket = ? AND nd.radio_ticket IS NOT NULL AND nd.radio_ticket != '')
        ORDER BY nd.created_at DESC LIMIT 1
        """,
        (incident_id, inc.get("radio_ticket") or "")
    )
    nd_row = await cursor.fetchone()
    sms_details = dict(nd_row) if nd_row else None

    return {
        "incident_id": incident_id,
        "radio_ticket": inc.get("radio_ticket"),
        "radio_dispatched": inc.get("synced") == 1 or inc.get("synced") == 2,
        "radio_dispatched_at": inc.get("radio_dispatched_at"),
        "sms_dispatched": sms_details is not None and sms_details.get("status") in ("DISPATCHED", "SENT"),
        "sms_details": sms_details,
    }


@router.post("", response_model=Dict[str, Any])
async def create_incident(
    req: IncidentCreateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Log an incident to SQLite."""
    incident_id = f"inc-{uuid.uuid4().hex[:8]}"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    await db.execute("""
        INSERT INTO incidents (
            id, camera_id, timestamp, occlusion_ratio, status,
            image_path, debris_count, radio_ticket, synced, source_type, is_open
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'manual', 0)
    """, (
        incident_id, req.camera_id, now, req.occlusion_ratio, req.status,
        req.image_path, req.debris_count, req.radio_ticket
    ))
    
    # Also queue to sync_queue
    payload = {
        "id": incident_id,
        "camera_id": req.camera_id,
        "timestamp": now,
        "occlusion_ratio": req.occlusion_ratio,
        "status": req.status,
        "image_path": req.image_path,
        "debris_count": req.debris_count,
        "radio_ticket": req.radio_ticket,
    }
    import json
    await db.execute("""
        INSERT INTO sync_queue (id, entity_type, entity_id, payload, status)
        VALUES (?, 'incident', ?, ?, 'PENDING')
    """, (f"sync-{uuid.uuid4().hex[:8]}", incident_id, json.dumps(payload)))
    
    await db.commit()
    
    cursor = await db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    row = await cursor.fetchone()
    return dict(row) if row else {"id": incident_id}


@router.post("/{incident_id}/dispatch")
async def dispatch_incident(
    incident_id: str,
    req: Optional[DispatchRequest] = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Mark an incident as dispatched over VHF/UHF radio and manage SMS dispatch correlation."""
    cursor = await db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    inc = dict(row)

    # Determine ticket ID
    ticket = (req.radio_ticket if (req and req.radio_ticket) else None) or inc.get("radio_ticket")
    if not ticket or ticket.startswith("Command to"):
        ticket = f"RAD-{uuid.uuid4().hex[:6].upper()}"

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Check if SMS already exists for this incident or ticket
    cursor = await db.execute(
        """
        SELECT nd.*, rg.name as target_group_name 
        FROM notification_dispatches nd
        LEFT JOIN responder_groups rg ON nd.target_group_id = rg.id
        WHERE nd.incident_id = ? OR (nd.radio_ticket = ? AND nd.radio_ticket IS NOT NULL AND nd.radio_ticket != '')
        ORDER BY nd.created_at DESC LIMIT 1
        """,
        (incident_id, ticket)
    )
    nd_row = await cursor.fetchone()
    
    sms_already_sent = False
    sms_status = "SKIPPED"
    sms_details = None

    if nd_row and nd_row["status"] in ("DISPATCHED", "SENT"):
        sms_already_sent = True
        sms_status = nd_row["status"]
        sms_details = dict(nd_row)
    elif req and req.send_sms:
        # Operator requested SMS dispatch because none was sent yet
        from app.services.sms_service import sms_service
        try:
            cam_cursor = await db.execute("SELECT location, name FROM cameras WHERE id = ?", (inc["camera_id"],))
            cam_row = await cam_cursor.fetchone()
            cam_loc = (cam_row[0] if cam_row and cam_row[0] else (cam_row[1] if cam_row else inc["camera_id"]))
            
            sms_res = await sms_service.dispatch_incident_alert_async(
                camera_id=inc["camera_id"],
                location=cam_loc,
                occlusion_ratio=float(inc.get("occlusion_ratio", 0.0)),
                is_clear=False,
                incident_id=incident_id,
                radio_ticket=ticket,
            )
            sms_status = sms_res.get("status", "SENT")
        except Exception:
            sms_status = "FAILED"

    # Update incident in SQLite: preserve RESOLVED status (synced=2) if already resolved
    await db.execute("""
        UPDATE incidents 
        SET synced = CASE WHEN synced = 2 THEN 2 ELSE 1 END,
            radio_ticket = ?,
            radio_dispatched_at = COALESCE(radio_dispatched_at, ?)
        WHERE id = ?
    """, (ticket, now_str, incident_id))
    await db.commit()

    return {
        "status": "success",
        "incident_id": incident_id,
        "radio_ticket": ticket,
        "channel": req.channel if req else None,
        "assigned_group_id": req.assigned_group_id if req else None,
        "radio_dispatched": True,
        "sms_already_sent": sms_already_sent,
        "sms_status": sms_status,
        "sms_details": sms_details,
        "message": f"Incident {incident_id} dispatched over radio (Ticket: {ticket})",
    }


@router.post("/{incident_id}/resolve")
@router.patch("/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Mark an incident as resolved after drainage clearing."""
    cursor = await db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    await db.execute("""
        UPDATE incidents 
        SET synced = 2 
        WHERE id = ?
    """, (incident_id,))
    await db.commit()
    return {"status": "success", "message": f"Incident {incident_id} marked as resolved"}

