import json
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
import aiosqlite

from app.core.database import get_db

router = APIRouter()


class NotifPreferences(BaseModel):
    warning: bool = True
    critical: bool = True
    blockage: bool = True
    announcement: bool = True


class ResponderCreateRequest(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    phone_number: str = Field(..., min_length=1, max_length=50)
    status: str = Field("active", max_length=20)
    location: Optional[str] = Field("", max_length=200)
    notif_preferences: Optional[Dict[str, bool]] = Field(default_factory=lambda: {
        "warning": True,
        "critical": True,
        "blockage": True,
        "announcement": True,
    })
    group_ids: Optional[List[str]] = Field(default_factory=list)


class ResponderUpdateRequest(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone_number: Optional[str] = Field(None, min_length=1, max_length=50)
    status: Optional[str] = Field(None, max_length=20)
    location: Optional[str] = Field(None, max_length=200)
    notif_preferences: Optional[Dict[str, bool]] = None
    group_ids: Optional[List[str]] = None


class ResponderGroupCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field("", max_length=500)
    member_ids: Optional[List[str]] = Field(default_factory=list)


class ResponderGroupUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    member_ids: Optional[List[str]] = None


def serialize_responder(row: Any, group_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    d = dict(row)
    prefs_str = d.get("notif_preferences", "{}")
    try:
        d["notif_preferences"] = json.loads(prefs_str) if isinstance(prefs_str, str) else prefs_str
    except Exception:
        d["notif_preferences"] = {}
    d["group_ids"] = group_ids if group_ids is not None else []
    return d


def serialize_responder_group(row: Any, member_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    d = dict(row)
    members = member_ids if member_ids is not None else []
    d["member_ids"] = members
    d["member_count"] = len(members)
    return d


async def _get_group_member_ids(db: aiosqlite.Connection, group_id: str) -> List[str]:
    """Retrieve all responder IDs currently assigned to a responder group."""
    cursor = await db.execute(
        "SELECT responder_id FROM responder_group_members WHERE group_id = ?",
        (group_id,),
    )
    rows = await cursor.fetchall()
    return [m["responder_id"] for m in rows]


async def _set_group_members(db: aiosqlite.Connection, group_id: str, member_ids: List[str]) -> None:
    """Set the responder members for a group, validating responder existence."""
    await db.execute("DELETE FROM responder_group_members WHERE group_id = ?", (group_id,))
    for rid in set(member_ids):
        r_check = await db.execute("SELECT id FROM responders WHERE id = ?", (rid,))
        if await r_check.fetchone():
            await db.execute(
                "INSERT OR IGNORE INTO responder_group_members (responder_id, group_id) VALUES (?, ?)",
                (rid, group_id),
            )


async def _get_responder_group_ids(db: aiosqlite.Connection, responder_id: str) -> List[str]:
    """Retrieve all group IDs assigned to a specific responder."""
    cursor = await db.execute(
        "SELECT group_id FROM responder_group_members WHERE responder_id = ?",
        (responder_id,),
    )
    rows = await cursor.fetchall()
    return [m["group_id"] for m in rows]


# ---------------------------------------------------------------------------
# Responders Endpoints
# ---------------------------------------------------------------------------

@router.get("/responders", response_model=List[Dict[str, Any]])
async def list_responders(
    status_filter: Optional[str] = None,
    group_id: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    """List all emergency responders with their assigned group IDs."""
    query = """
        SELECT r.*
        FROM responders r
    """
    params = []
    conditions = []

    if status_filter:
        conditions.append("r.status = ?")
        params.append(status_filter.lower())

    if group_id:
        conditions.append("""
            EXISTS (
                SELECT 1 FROM responder_group_members rgm
                WHERE rgm.responder_id = r.id AND rgm.group_id = ?
            )
        """)
        params.append(group_id)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY r.created_at DESC"

    cursor = await db.execute(query, tuple(params))
    rows = await cursor.fetchall()

    result = []
    for r in rows:
        group_ids = await _get_responder_group_ids(db, r["id"])
        result.append(serialize_responder(r, group_ids))

    return result


@router.post("/responders", status_code=status.HTTP_201_CREATED, response_model=Dict[str, Any])
async def create_responder(
    payload: ResponderCreateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Register a new emergency responder."""
    cursor = await db.execute("SELECT id FROM responders WHERE phone_number = ?", (payload.phone_number,))
    if await cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Responder with phone number '{payload.phone_number}' already exists",
        )

    new_id = f"resp-{uuid.uuid4().hex[:8]}"
    prefs_str = json.dumps(payload.notif_preferences or {})

    await db.execute(
        """
        INSERT INTO responders (id, first_name, last_name, phone_number, status, location, notif_preferences)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id,
            payload.first_name,
            payload.last_name,
            payload.phone_number,
            payload.status,
            payload.location or "",
            prefs_str,
        ),
    )

    if payload.group_ids:
        for gid in payload.group_ids:
            g_check = await db.execute("SELECT id FROM responder_groups WHERE id = ?", (gid,))
            if await g_check.fetchone():
                await db.execute(
                    "INSERT OR IGNORE INTO responder_group_members (responder_id, group_id) VALUES (?, ?)",
                    (new_id, gid),
                )

    await db.commit()

    cursor = await db.execute("SELECT * FROM responders WHERE id = ?", (new_id,))
    row = await cursor.fetchone()
    return serialize_responder(row, payload.group_ids)


@router.put("/responders/{responder_id}", response_model=Dict[str, Any])
async def update_responder(
    responder_id: str,
    payload: ResponderUpdateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Update emergency responder details and group memberships."""
    cursor = await db.execute("SELECT * FROM responders WHERE id = ?", (responder_id,))
    existing = await cursor.fetchone()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Responder '{responder_id}' not found",
        )

    if payload.phone_number is not None and payload.phone_number != existing["phone_number"]:
        check = await db.execute(
            "SELECT id FROM responders WHERE phone_number = ? AND id != ?",
            (payload.phone_number, responder_id),
        )
        if await check.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Phone number '{payload.phone_number}' is already used by another responder",
            )

    updates = []
    params = []

    if payload.first_name is not None:
        updates.append("first_name = ?")
        params.append(payload.first_name)
    if payload.last_name is not None:
        updates.append("last_name = ?")
        params.append(payload.last_name)
    if payload.phone_number is not None:
        updates.append("phone_number = ?")
        params.append(payload.phone_number)
    if payload.status is not None:
        updates.append("status = ?")
        params.append(payload.status)
    if payload.location is not None:
        updates.append("location = ?")
        params.append(payload.location)
    if payload.notif_preferences is not None:
        updates.append("notif_preferences = ?")
        params.append(json.dumps(payload.notif_preferences))

    if updates:
        params.append(responder_id)
        await db.execute(
            f"UPDATE responders SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )

    if payload.group_ids is not None:
        await db.execute("DELETE FROM responder_group_members WHERE responder_id = ?", (responder_id,))
        for gid in payload.group_ids:
            g_check = await db.execute("SELECT id FROM responder_groups WHERE id = ?", (gid,))
            if await g_check.fetchone():
                await db.execute(
                    "INSERT OR IGNORE INTO responder_group_members (responder_id, group_id) VALUES (?, ?)",
                    (responder_id, gid),
                )

    await db.commit()

    cursor = await db.execute("SELECT * FROM responders WHERE id = ?", (responder_id,))
    updated_row = await cursor.fetchone()
    group_ids = await _get_responder_group_ids(db, responder_id)
    return serialize_responder(updated_row, group_ids)


@router.delete("/responders/{responder_id}", status_code=status.HTTP_200_OK)
async def delete_responder(
    responder_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete an emergency responder and cascade memberships."""
    cursor = await db.execute("SELECT id FROM responders WHERE id = ?", (responder_id,))
    if not await cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Responder '{responder_id}' not found",
        )

    await db.execute("DELETE FROM responders WHERE id = ?", (responder_id,))
    await db.commit()
    return {"status": "success", "message": f"Responder '{responder_id}' deleted successfully"}


# ---------------------------------------------------------------------------
# Responder Groups Endpoints
# ---------------------------------------------------------------------------

@router.get("/responder-groups", response_model=List[Dict[str, Any]])
async def list_responder_groups(db: aiosqlite.Connection = Depends(get_db)):
    """List all responder groups with active member count and member IDs."""
    cursor = await db.execute("SELECT * FROM responder_groups ORDER BY created_at ASC")
    rows = await cursor.fetchall()

    result = []
    for r in rows:
        member_ids = await _get_group_member_ids(db, r["id"])
        result.append(serialize_responder_group(r, member_ids))

    return result


@router.post("/responder-groups", status_code=status.HTTP_201_CREATED, response_model=Dict[str, Any])
async def create_responder_group(
    payload: ResponderGroupCreateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Create a new responder group with optional initial member assignments."""
    new_id = f"grp-{uuid.uuid4().hex[:8]}"

    await db.execute(
        "INSERT INTO responder_groups (id, name, description) VALUES (?, ?, ?)",
        (new_id, payload.name, payload.description or ""),
    )

    if payload.member_ids:
        await _set_group_members(db, new_id, payload.member_ids)

    await db.commit()

    cursor = await db.execute("SELECT * FROM responder_groups WHERE id = ?", (new_id,))
    row = await cursor.fetchone()
    member_ids = await _get_group_member_ids(db, new_id)
    return serialize_responder_group(row, member_ids)


@router.put("/responder-groups/{group_id}", response_model=Dict[str, Any])
async def update_responder_group(
    group_id: str,
    payload: ResponderGroupUpdateRequest,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Update responder group name, description, and member roster."""
    cursor = await db.execute("SELECT * FROM responder_groups WHERE id = ?", (group_id,))
    existing = await cursor.fetchone()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Responder group '{group_id}' not found",
        )

    updates = []
    params = []

    if payload.name is not None:
        updates.append("name = ?")
        params.append(payload.name)
    if payload.description is not None:
        updates.append("description = ?")
        params.append(payload.description)

    if updates:
        params.append(group_id)
        await db.execute(
            f"UPDATE responder_groups SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )

    if payload.member_ids is not None:
        await _set_group_members(db, group_id, payload.member_ids)

    await db.commit()

    cursor = await db.execute("SELECT * FROM responder_groups WHERE id = ?", (group_id,))
    updated_row = await cursor.fetchone()
    member_ids = await _get_group_member_ids(db, group_id)
    return serialize_responder_group(updated_row, member_ids)


@router.delete("/responder-groups/{group_id}", status_code=status.HTTP_200_OK)
async def delete_responder_group(
    group_id: str,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Delete a responder group and its memberships."""
    cursor = await db.execute("SELECT id FROM responder_groups WHERE id = ?", (group_id,))
    if not await cursor.fetchone():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Responder group '{group_id}' not found",
        )

    await db.execute("DELETE FROM responder_groups WHERE id = ?", (group_id,))
    await db.commit()
    return {"status": "success", "message": f"Responder group '{group_id}' deleted successfully"}
