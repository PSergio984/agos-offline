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
    """Mark an incident as dispatched over VHF/UHF radio."""
    cursor = await db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
        
    await db.execute("""
        UPDATE incidents 
        SET synced = 1 
        WHERE id = ? AND synced = 0
    """, (incident_id,))
    await db.commit()
    return {"status": "success", "message": f"Incident {incident_id} dispatched over radio"}


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

