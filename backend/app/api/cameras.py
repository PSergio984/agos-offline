import uuid
from typing import List, Optional, Dict, Any, Union
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, Field, field_validator
import aiosqlite

from app.core.config import settings
from app.core.database import get_db
from app.services.stream_service import stream_service

router = APIRouter()


class ROIModel(BaseModel):
    roi: Optional[List[float]] = Field(None, description="[x_min, y_min, x_max, y_max] normalized 0.0 to 1.0")
    x_min: Optional[float] = None
    y_min: Optional[float] = None
    x_max: Optional[float] = None
    y_max: Optional[float] = None

    def get_coords(self) -> List[float]:
        if self.roi is not None and len(self.roi) == 4:
            coords = self.roi
        elif (
            self.x_min is not None
            and self.y_min is not None
            and self.x_max is not None
            and self.y_max is not None
        ):
            coords = [self.x_min, self.y_min, self.x_max, self.y_max]
        else:
            raise ValueError("Must provide either 'roi' list or 'x_min, y_min, x_max, y_max'")

        for val in coords:
            if not (0.0 <= val <= 1.0):
                raise ValueError("ROI coordinates must be between 0.0 and 1.0")
        if coords[0] >= coords[2] or coords[1] >= coords[3]:
            raise ValueError("Invalid ROI bounding box coordinates: min must be less than max")
        return [round(float(c), 4) for c in coords]


class StreamSwitchRequest(BaseModel):
    camera_id: Optional[str] = "cam-default"
    source_type: Optional[str] = None
    type: Optional[str] = None
    url: Optional[str] = None
    device_index: Optional[Union[int, str]] = None


class CameraCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    source: str = Field(..., min_length=1)
    source_type: str = Field("file", description="'file', 'rtsp', 'webcam', or 'synthetic'")
    location: Optional[str] = Field("", max_length=200)
    roi: Optional[List[float]] = Field(default_factory=lambda: list(settings.DEFAULT_ROI))


class SwitchCameraRequest(BaseModel):
    camera_id: str


@router.get("", response_model=List[Dict[str, Any]])
async def list_cameras(db: aiosqlite.Connection = Depends(get_db)):
    """List all registered cameras with their current ROI and active status."""
    cursor = await db.execute("SELECT * FROM cameras ORDER BY created_at ASC")
    rows = await cursor.fetchall()
    
    cameras = []
    for r in rows:
        cam_dict = dict(r)
        cam_dict["is_active"] = bool(cam_dict["is_active"])
        
        # Fetch latest ROI for this camera
        roi_cursor = await db.execute(
            "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
            (cam_dict["id"],)
        )
        roi_row = await roi_cursor.fetchone()
        if roi_row:
            cam_dict["roi"] = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]]
        else:
            cam_dict["roi"] = list(settings.DEFAULT_ROI)
        cameras.append(cam_dict)
        
    return cameras


@router.get("/status")
async def get_stream_status():
    """Retrieve the current real-time stream ingestion and hardware status."""
    return stream_service.get_status()


@router.get("/active")
async def get_active_camera(db: aiosqlite.Connection = Depends(get_db)):
    """Get the currently active camera and its configuration."""
    cursor = await db.execute("SELECT * FROM cameras WHERE is_active = 1 LIMIT 1")
    row = await cursor.fetchone()
    if not row:
        cursor = await db.execute("SELECT * FROM cameras LIMIT 1")
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No cameras found in database")

    cam_dict = dict(row)
    cam_dict["is_active"] = bool(cam_dict["is_active"])
    
    roi_cursor = await db.execute(
        "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
        (cam_dict["id"],)
    )
    roi_row = await roi_cursor.fetchone()
    if roi_row:
        cam_dict["roi"] = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]]
    else:
        cam_dict["roi"] = list(settings.DEFAULT_ROI)
        
    cam_dict["stream_status"] = stream_service.get_status()
    return cam_dict


@router.get("/{camera_id}")
async def get_camera(camera_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Retrieve details for a specific camera ID."""
    cursor = await db.execute("SELECT * FROM cameras WHERE id = ?", (camera_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    cam_dict = dict(row)
    cam_dict["is_active"] = bool(cam_dict["is_active"])
    
    roi_cursor = await db.execute(
        "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
        (camera_id,)
    )
    roi_row = await roi_cursor.fetchone()
    if roi_row:
        cam_dict["roi"] = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]]
    else:
        cam_dict["roi"] = list(settings.DEFAULT_ROI)
        
    return cam_dict


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_camera(payload: CameraCreateRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Register a new camera and configure its default ROI."""
    new_id = f"cam-{uuid.uuid4().hex[:8]}"
    
    # Auto-detect source_type if not explicitly configured
    source_type = payload.source_type
    if payload.source.isdigit():
        source_type = "webcam"
    elif payload.source.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        source_type = "rtsp"

    await db.execute(
        """
        INSERT INTO cameras (id, name, source, source_type, is_active, location)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (new_id, payload.name, payload.source, source_type, payload.location or "")
    )

    roi_id = f"roi-{uuid.uuid4().hex[:8]}"
    roi = payload.roi or list(settings.DEFAULT_ROI)
    await db.execute(
        """
        INSERT INTO roi_configs (id, camera_id, x_min, y_min, x_max, y_max)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (roi_id, new_id, roi[0], roi[1], roi[2], roi[3])
    )
    await db.commit()

    return {
        "id": new_id,
        "name": payload.name,
        "source": payload.source,
        "source_type": source_type,
        "is_active": False,
        "location": payload.location,
        "roi": roi
    }


@router.post("/switch")
@router.post("/{camera_id}/activate")
async def switch_active_camera(
    camera_id: Optional[str] = None,
    payload: Optional[SwitchCameraRequest] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Switch active camera feed and immediately restart stream ingestion on the new source."""
    target_id = camera_id or (payload.camera_id if payload else None)
    if not target_id:
        raise HTTPException(status_code=400, detail="Missing camera_id in path or payload")

    cursor = await db.execute("SELECT * FROM cameras WHERE id = ?", (target_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Camera '{target_id}' not found")

    cam = dict(row)
    
    # Deactivate all cameras and activate target
    await db.execute("UPDATE cameras SET is_active = 0")
    await db.execute("UPDATE cameras SET is_active = 1, updated_at = datetime('now', 'localtime') WHERE id = ?", (target_id,))
    await db.commit()

    # Get ROI
    roi_cursor = await db.execute(
        "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
        (target_id,)
    )
    roi_row = await roi_cursor.fetchone()
    roi = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]] if roi_row else list(settings.DEFAULT_ROI)

    # Trigger stream service switch
    stream_service.switch_source(cam["source"], target_id, roi)

    return {
        "message": f"Switched to camera '{cam['name']}'",
        "active_camera_id": target_id,
        "source": cam["source"],
        "source_type": cam["source_type"],
        "roi": roi,
        "status": stream_service.get_status()
    }


@router.get("/{camera_id}/roi")
async def get_camera_roi(camera_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Retrieve calibrated Region of Interest (ROI) for a specific camera."""
    cursor = await db.execute("SELECT id FROM cameras WHERE id = ?", (camera_id,))
    row = await cursor.fetchone()
    if not row:
        fallback_roi = stream_service.roi if stream_service.current_camera_id == camera_id else list(settings.DEFAULT_ROI)
        return {
            "camera_id": camera_id,
            "roi": fallback_roi,
            "x_min": fallback_roi[0],
            "y_min": fallback_roi[1],
            "x_max": fallback_roi[2],
            "y_max": fallback_roi[3],
        }

    roi_cursor = await db.execute(
        "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
        (camera_id,),
    )
    roi_row = await roi_cursor.fetchone()
    roi = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]] if roi_row else list(settings.DEFAULT_ROI)

    return {
        "camera_id": camera_id,
        "roi": roi,
        "x_min": roi[0],
        "y_min": roi[1],
        "x_max": roi[2],
        "y_max": roi[3],
    }


@router.put("/{camera_id}/roi")
@router.post("/{camera_id}/roi")
async def update_camera_roi(
    camera_id: str,
    payload: ROIModel,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Update calibrated Region of Interest (ROI) bounding box coordinates."""
    cursor = await db.execute("SELECT id FROM cameras WHERE id = ?", (camera_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    try:
        roi = payload.get_coords()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    new_roi_id = f"roi-{uuid.uuid4().hex[:8]}"

    await db.execute(
        """
        INSERT INTO roi_configs (id, camera_id, x_min, y_min, x_max, y_max)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (new_roi_id, camera_id, roi[0], roi[1], roi[2], roi[3]),
    )
    await db.commit()

    # If this camera is currently active, immediately update live stream service ROI
    if stream_service.current_camera_id == camera_id:
        stream_service.set_roi(roi)

    return {
        "success": True,
        "camera_id": camera_id,
        "roi": roi,
        "message": "ROI updated successfully",
    }


@router.post("/stream")
@router.post("/{camera_id}/stream")
async def switch_stream_source(
    camera_id: Optional[str] = None,
    payload: Optional[StreamSwitchRequest] = None,
    db: aiosqlite.Connection = Depends(get_db),
):
    """Switch active stream source (video file, webcam index, RTSP url) on-the-fly."""
    target_id = camera_id or (payload.camera_id if payload else "cam-default")
    source = ""
    stype = "file"

    if payload:
        if payload.url:
            source = payload.url
            stype = "rtsp" if source.startswith(("rtsp://", "rtsps://", "http://", "https://")) else "file"
        elif payload.device_index is not None:
            source = str(payload.device_index)
            stype = "webcam"
        elif payload.type == "webcam":
            source = "0"
            stype = "webcam"
        elif payload.type == "demo":
            source = str(settings.DEFAULT_SAMPLE_VIDEO)
            stype = "file"

    if not source:
        source = str(settings.DEFAULT_SAMPLE_VIDEO)
        stype = "file"

    await db.execute("UPDATE cameras SET is_active = 0")
    cursor = await db.execute("SELECT id FROM cameras WHERE id = ?", (target_id,))
    if await cursor.fetchone():
        await db.execute(
            "UPDATE cameras SET source = ?, source_type = ?, is_active = 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (source, stype, target_id),
        )
    else:
        await db.execute(
            "INSERT INTO cameras (id, name, source, source_type, is_active, location) VALUES (?, ?, ?, ?, 1, ?)",
            (target_id, f"Camera ({target_id})", source, stype, "Active Stream"),
        )
    await db.commit()

    roi_cursor = await db.execute(
        "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
        (target_id,),
    )
    roi_row = await roi_cursor.fetchone()
    roi = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]] if roi_row else list(settings.DEFAULT_ROI)

    stream_service.switch_source(source, target_id, roi)

    return {
        "success": True,
        "message": f"Switched stream to {source}",
        "camera_id": target_id,
        "source": source,
        "source_type": stype,
        "roi": roi,
        "status": stream_service.get_status(),
    }


@router.delete("/{camera_id}", status_code=status.HTTP_200_OK)
async def delete_camera(camera_id: str, db: aiosqlite.Connection = Depends(get_db)):
    """Delete a camera configuration."""
    cursor = await db.execute("SELECT is_active FROM cameras WHERE id = ?", (camera_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    if row["is_active"]:
        raise HTTPException(status_code=400, detail="Cannot delete active camera. Switch active camera first.")

    await db.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
    await db.commit()

    return {"message": f"Camera '{camera_id}' deleted successfully"}
