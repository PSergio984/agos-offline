from typing import AsyncGenerator, Optional, Dict, Any
import aiosqlite
from app.core.config import settings

SQL_CREATE_CAMERAS = """
CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    location TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SQL_CREATE_ROI_CONFIGS = """
CREATE TABLE IF NOT EXISTS roi_configs (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    x_min REAL NOT NULL,
    y_min REAL NOT NULL,
    x_max REAL NOT NULL,
    y_max REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (camera_id) REFERENCES cameras (id) ON DELETE CASCADE
);
"""

SQL_CREATE_INCIDENTS = """
CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    occlusion_ratio REAL NOT NULL,
    status TEXT NOT NULL,
    image_path TEXT DEFAULT '',
    debris_count INTEGER NOT NULL DEFAULT 0,
    radio_ticket TEXT DEFAULT '',
    synced INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (camera_id) REFERENCES cameras (id) ON DELETE CASCADE
);
"""

SQL_CREATE_SYNC_QUEUE = """
CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""


async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """FastAPI dependency to acquire an aiosqlite database connection."""
    conn = await aiosqlite.connect(str(settings.DATABASE_PATH))
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
    finally:
        await conn.close()


async def init_db() -> None:
    """Initialize SQLite database, create tables, and seed default camera + ROI."""
    settings.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
        await db.execute("PRAGMA foreign_keys = ON;")
        await db.execute(SQL_CREATE_CAMERAS)
        await db.execute(SQL_CREATE_ROI_CONFIGS)
        await db.execute(SQL_CREATE_INCIDENTS)
        await db.execute(SQL_CREATE_SYNC_QUEUE)
        await db.commit()

        # Seed default camera if not exists
        default_cam_id = "cam-default"
        cursor = await db.execute("SELECT id FROM cameras WHERE id = ?", (default_cam_id,))
        existing_cam = await cursor.fetchone()
        
        if not existing_cam:
            # Check relative or canonical path for demo mp4
            default_source = "sample_media/drainage_demo.mp4"
            await db.execute(
                """
                INSERT INTO cameras (id, name, source, source_type, is_active, location)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    default_cam_id,
                    "Drainage Demo (Curb Inlet)",
                    default_source,
                    "file",
                    1,
                    "Brgy. Poblacion Drainage Culvert #1"
                )
            )

            # Seed default ROI for default camera
            default_roi_id = "roi-cam-default"
            x_min, y_min, x_max, y_max = settings.DEFAULT_ROI
            await db.execute(
                """
                INSERT INTO roi_configs (id, camera_id, x_min, y_min, x_max, y_max)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    default_roi_id,
                    default_cam_id,
                    x_min,
                    y_min,
                    x_max,
                    y_max
                )
            )
            await db.commit()


async def get_active_camera_record() -> Optional[Dict[str, Any]]:
    """Retrieve the currently active camera and its ROI configuration."""
    async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM cameras WHERE is_active = 1 LIMIT 1")
        row = await cursor.fetchone()
        if not row:
            cursor = await db.execute("SELECT * FROM cameras LIMIT 1")
            row = await cursor.fetchone()
            if not row:
                return None

        cam = dict(row)
        roi_cursor = await db.execute(
            "SELECT x_min, y_min, x_max, y_max FROM roi_configs WHERE camera_id = ? ORDER BY created_at DESC LIMIT 1",
            (cam["id"],)
        )
        roi_row = await roi_cursor.fetchone()
        if roi_row:
            cam["roi"] = [roi_row["x_min"], roi_row["y_min"], roi_row["x_max"], roi_row["y_max"]]
        else:
            cam["roi"] = list(settings.DEFAULT_ROI)
        return cam
