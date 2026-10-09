import json
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
import aiosqlite

from app.core.database import get_db

router = APIRouter()


class TemplateCreateRequest(BaseModel):
    type: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=150)
    message: str = Field(..., min_length=1, max_length=1000)


class TemplateUpdateRequest(BaseModel):
    type: Optional[str] = Field(None, min_length=1, max_length=50)
    title: Optional[str] = Field(None, min_length=1, max_length=150)
    message: Optional[str] = Field(None, min_length=1, max_length=1000)


class AnnounceRequest(BaseModel):
    type: str = Field("announcement", max_length=50)
    title: str = Field(..., min_length=1, max_length=150)
    message: str = Field(..., min_length=1, max_length=1000)
    target_group_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Notification Templates Endpoints
# ---------------------------------------------------------------------------

@router.get("/notification-templates", response_model=List[Dict[str, Any]])
async def list_notification_templates(
    type_filter: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    """List notification templates, optionally filtered by type."""
    query = "SELECT * FROM notification_templates"
    params = []
    if type_filter:
        query += " WHERE type = ?"
        params.append(type_filter.lower())
    query += " ORDER BY created_at ASC"

    cursor = await db.execute(query, tuple(params))
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/notification-templates", status_code=status.HTTP_201_CREATED, response_model=Dict[str, Any])
async def create_notification_template(
    payload: TemplateCreateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Create a new notification template."""
    new_id = f"tmpl-{uuid.uuid4().hex[:8]}"

    await db.execute(
        """
        INSERT INTO notification_templates (id, type, title, message)
        VALUES (?, ?, ?, ?)
        """,
        (new_id, payload.type.lower(), payload.title, payload.message),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM notification_templates WHERE id = ?", (new_id,))
    row = await cursor.fetchone()
    return dict(row)


@router.put("/notification-templates/{template_id}", response_model=Dict[str, Any])
async def update_notification_template(
    template_id: str,
    payload: TemplateUpdateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Update an existing notification template."""
    cursor = await db.execute("SELECT * FROM notification_templates WHERE id = ?", (template_id,))
    existing = await cursor.fetchone()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Notification template '{template_id}' not found",
        )

    updates = []
    params = []

    if payload.type is not None:
        updates.append("type = ?")
        params.append(payload.type.lower())
    if payload.title is not None:
        updates.append("title = ?")
        params.append(payload.title)
    if payload.message is not None:
        updates.append("message = ?")
        params.append(payload.message)

    if updates:
        params.append(template_id)
        await db.execute(
            f"UPDATE notification_templates SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )
        await db.commit()

    cursor = await db.execute("SELECT * FROM notification_templates WHERE id = ?", (template_id,))
    updated_row = await cursor.fetchone()
    return dict(updated_row)


@router.delete("/notification-templates/{template_id}", status_code=status.HTTP_200_OK)
async def delete_notification_template(
    template_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a notification template."""
    cursor = await db.execute("SELECT id FROM notification_templates WHERE id = ?", (template_id,))
    if not await cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Notification template '{template_id}' not found",
        )

    await db.execute("DELETE FROM notification_templates WHERE id = ?", (template_id,))
    await db.commit()
    return {"status": "success", "message": f"Notification template '{template_id}' deleted successfully"}


# ---------------------------------------------------------------------------
# Announcement Dispatch & Logs
# ---------------------------------------------------------------------------

@router.post("/notifications/announce", status_code=status.HTTP_201_CREATED, response_model=Dict[str, Any])
async def dispatch_announcement(
    payload: AnnounceRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """
    Broadcast an emergency announcement or advisory to target responders.
    Counts recipients, logs to notification_dispatches, and enqueues to sync_queue.
    """
    # Calculate recipient count based on target_group_id and responder preferences
    type_key = payload.type.lower()
    
    if payload.target_group_id:
        cursor = await db.execute(
            """
            SELECT r.id, r.notif_preferences
            FROM responders r
            JOIN responder_group_members rgm ON r.id = rgm.responder_id
            WHERE rgm.group_id = ? AND r.status = 'active'
            """,
            (payload.target_group_id,),
        )
    else:
        cursor = await db.execute(
            "SELECT id, notif_preferences FROM responders WHERE status = 'active'"
        )

    rows = await cursor.fetchall()

    # Filter recipients whose preferences allow this dispatch type
    recipient_ids = []
    for r in rows:
        prefs_raw = r["notif_preferences"]
        try:
            prefs = json.loads(prefs_raw) if isinstance(prefs_raw, str) else prefs_raw
        except Exception:
            prefs = {}
        if prefs.get(type_key, True):
            recipient_ids.append(r["id"])

    recipient_count = len(recipient_ids)
    dispatch_id = f"disp-{uuid.uuid4().hex[:8]}"

    await db.execute(
        """
        INSERT INTO notification_dispatches (
            id, type, title, message, target_group_id, recipient_count, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'DISPATCHED')
        """,
        (
            dispatch_id,
            payload.type,
            payload.title,
            payload.message,
            payload.target_group_id,
            recipient_count,
        ),
    )

    # Queue row to sync_queue with entity_type NOTIFICATION_DISPATCH
    sync_payload = {
        "id": dispatch_id,
        "type": payload.type,
        "title": payload.title,
        "message": payload.message,
        "target_group_id": payload.target_group_id,
        "recipient_count": recipient_count,
        "recipient_ids": recipient_ids,
        "status": "DISPATCHED",
    }
    sync_id = f"sync-{uuid.uuid4().hex[:8]}"
    await db.execute(
        """
        INSERT INTO sync_queue (id, entity_type, entity_id, payload, status)
        VALUES (?, 'NOTIFICATION_DISPATCH', ?, ?, 'PENDING')
        """,
        (sync_id, dispatch_id, json.dumps(sync_payload)),
    )

    await db.commit()

    cursor = await db.execute("SELECT * FROM notification_dispatches WHERE id = ?", (dispatch_id,))
    row = await cursor.fetchone()
    return dict(row)


@router.get("/notification-logs", response_model=List[Dict[str, Any]])
async def list_notification_logs(
    db: aiosqlite.Connection = Depends(get_db),
):
    """Retrieve all notification dispatch records sorted by created_at DESC."""
    cursor = await db.execute(
        "SELECT * FROM notification_dispatches ORDER BY created_at DESC"
    )
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]
