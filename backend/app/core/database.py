from typing import AsyncGenerator, Optional, Dict, Any, List
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
    target_group_id TEXT DEFAULT 'grp-drainage',
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

SQL_CREATE_RESPONDERS = """
CREATE TABLE IF NOT EXISTS responders (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    location TEXT DEFAULT '',
    notif_preferences TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SQL_CREATE_RESPONDER_GROUPS = """
CREATE TABLE IF NOT EXISTS responder_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SQL_CREATE_RESPONDER_GROUP_MEMBERS = """
CREATE TABLE IF NOT EXISTS responder_group_members (
    responder_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    PRIMARY KEY (responder_id, group_id),
    FOREIGN KEY (responder_id) REFERENCES responders(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES responder_groups(id) ON DELETE CASCADE
);
"""

SQL_CREATE_NOTIFICATION_TEMPLATES = """
CREATE TABLE IF NOT EXISTS notification_templates (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SQL_CREATE_NOTIFICATION_DISPATCHES = """
CREATE TABLE IF NOT EXISTS notification_dispatches (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    target_group_id TEXT,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DISPATCHED',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

SQL_CREATE_SMS_GATEWAY_CONFIG = """
CREATE TABLE IF NOT EXISTS sms_gateway_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    enabled INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'mock',
    gateway_url TEXT NOT NULL DEFAULT 'http://192.168.1.100:8080',
    api_key TEXT NOT NULL DEFAULT 'admin:secret',
    cooldown_minutes INTEGER NOT NULL DEFAULT 15,
    max_retries INTEGER NOT NULL DEFAULT 3,
    default_group_id TEXT DEFAULT 'grp-drainage',
    last_ping_status TEXT DEFAULT 'UNKNOWN',
    last_ping_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""

CAMERA_EXTRA_COLUMNS = {
    "target_group_id": "TEXT",
}

# Columns added after the first release. Applied additively to fresh and legacy databases alike.
INCIDENT_EXTRA_COLUMNS = {
    "is_open": "INTEGER NOT NULL DEFAULT 0",
    "closed_at": "TEXT",
    "duration_seconds": "REAL NOT NULL DEFAULT 0",
    "source_type": "TEXT NOT NULL DEFAULT 'unknown'",
    "cloud_synced": "INTEGER NOT NULL DEFAULT 0",
    "model_version": "TEXT",
    "model_sha256": "TEXT",
    "precipitation_mm": "REAL",
    "weather_code": "INTEGER",
    "radio_dispatched_at": "TEXT",
}

NOTIFICATION_DISPATCHES_EXTRA_COLUMNS = {
    "incident_id": "TEXT",
    "radio_ticket": "TEXT",
}

# One row per successful online weather fetch (timestamps are UTC ISO-8601)
SQL_CREATE_WEATHER_READINGS = """
CREATE TABLE IF NOT EXISTS weather_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    precipitation_mm REAL,
    weather_code INTEGER,
    temperature_c REAL,
    humidity_pct REAL,
    condition TEXT
);
"""

SQL_CREATE_OPEN_INCIDENT_INDEX = """
CREATE UNIQUE INDEX IF NOT EXISTS ux_incidents_one_open_per_camera
ON incidents(camera_id) WHERE is_open = 1;
"""

# Shared by GET /incidents and the stream worker's incident_created event
SQL_SELECT_INCIDENTS = """
    SELECT
        i.id,
        i.camera_id,
        COALESCE(c.name, i.camera_id) AS camera_name,
        COALESCE(c.location, 'Curb Inlet Zone') AS location,
        i.timestamp,
        i.occlusion_ratio,
        i.status,
        i.image_path AS snapshot_url,
        i.debris_count,
        i.radio_ticket,
        CASE
            WHEN i.synced = 2 THEN 'RESOLVED'
            WHEN i.synced = 1 THEN 'DISPATCHED'
            ELSE 'PENDING'
        END AS action_taken,
        i.synced,
        i.cloud_synced,
        i.source_type,
        i.is_open,
        i.closed_at,
        i.duration_seconds,
        i.model_version,
        i.model_sha256,
        i.precipitation_mm,
        i.weather_code,
        i.radio_dispatched_at
    FROM incidents i
    LEFT JOIN cameras c ON i.camera_id = c.id
"""


def _cache_safe_snapshot_url(url: Optional[str]) -> Optional[str]:
    """Append the saved image's mtime so a refreshed snapshot is not served stale from cache.

    Empty paths and files that are missing on disk (manual test rows) are returned unchanged.
    """
    if not url or not url.startswith("/storage/incidents/"):
        return url
    try:
        mtime_ns = (settings.STORAGE_DIR / url.rsplit("/", 1)[-1]).stat().st_mtime_ns
    except OSError:
        return url
    return f"{url}?v={mtime_ns}"


def serialize_incident(row: Any) -> Dict[str, Any]:
    """Convert a SQL_SELECT_INCIDENTS row into the API/event incident shape."""
    d = dict(row)
    d["snapshot_url"] = _cache_safe_snapshot_url(d.get("snapshot_url"))
    d["cloud_synced"] = bool(d["cloud_synced"])
    d["debris_types"] = ["Plastic Sacks", "PET Bottles", "Organic Debris"] if d.get("debris_count", 0) > 0 else []
    return d


async def _ensure_columns(db: aiosqlite.Connection, table: str, columns: Dict[str, str]) -> List[str]:
    """Add any missing columns to a table. Returns the names that were added."""
    cursor = await db.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in await cursor.fetchall()}
    added = []
    for name, ddl in columns.items():
        if name not in existing:
            await db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
            added.append(name)
    return added


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
        await db.execute(SQL_CREATE_WEATHER_READINGS)
        await db.execute(SQL_CREATE_RESPONDERS)
        await db.execute(SQL_CREATE_RESPONDER_GROUPS)
        await db.execute(SQL_CREATE_RESPONDER_GROUP_MEMBERS)
        await db.execute(SQL_CREATE_NOTIFICATION_TEMPLATES)
        await db.execute(SQL_CREATE_NOTIFICATION_DISPATCHES)
        await db.execute(SQL_CREATE_SMS_GATEWAY_CONFIG)

        await _ensure_columns(db, "cameras", CAMERA_EXTRA_COLUMNS)
        await _ensure_columns(db, "notification_dispatches", NOTIFICATION_DISPATCHES_EXTRA_COLUMNS)
        added = await _ensure_columns(db, "incidents", INCIDENT_EXTRA_COLUMNS)
        if "cloud_synced" in added:
            # Known limitation: legacy synced=1 rows are ambiguous (dispatched by an operator vs
            # marked by the old sync bug) and are left untouched. Only the queue tells us cloud state.
            await db.execute(
                """
                UPDATE incidents SET cloud_synced = 1
                WHERE id IN (
                    SELECT entity_id FROM sync_queue WHERE entity_type = 'incident' AND status = 'SYNCED'
                )
                """
            )
        await db.execute(SQL_CREATE_OPEN_INCIDENT_INDEX)
        await db.commit()

        # Seed default responder groups if empty
        cursor = await db.execute("SELECT COUNT(*) FROM responder_groups")
        group_count = (await cursor.fetchone())[0]
        if group_count == 0:
            default_groups = [
                ("grp-poblacion", "Barangay Poblacion QRT", "Primary emergency quick response team for Poblacion district."),
                ("grp-drainage", "Drainage Maintenance Unit", "Engineering crew specialized in culvert clearing and desilting."),
                ("grp-evacuation", "Evacuation Coordination Unit", "Operations team managing evacuation transit and community alerts."),
            ]
            for gid, name, desc in default_groups:
                await db.execute(
                    "INSERT INTO responder_groups (id, name, description) VALUES (?, ?, ?)",
                    (gid, name, desc),
                )
            await db.commit()

        # Seed default responders if empty
        cursor = await db.execute("SELECT COUNT(*) FROM responders")
        responder_count = (await cursor.fetchone())[0]
        if responder_count == 0:
            import json
            default_prefs = json.dumps({"warning": True, "critical": True, "blockage": True, "announcement": True})
            default_responders = [
                ("resp-01", "Juan", "Dela Cruz", "+639171234567", "active", "Barangay Poblacion Outpost", default_prefs),
                ("resp-02", "Maria", "Santos", "+639182345678", "active", "Engineering Field Office", default_prefs),
                ("resp-03", "Antonio", "Reyes", "+639193456789", "active", "DRRMO Central Substation", default_prefs),
                ("resp-04", "Elena", "Bautista", "+639204567890", "active", "Evacuation Center Sector 3", default_prefs),
            ]
            for rid, fname, lname, phone, status_val, loc, prefs in default_responders:
                await db.execute(
                    """
                    INSERT INTO responders (id, first_name, last_name, phone_number, status, location, notif_preferences)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (rid, fname, lname, phone, status_val, loc, prefs),
                )

            # Assign responders to default groups
            default_memberships = [
                ("resp-01", "grp-poblacion"),
                ("resp-02", "grp-drainage"),
                ("resp-03", "grp-poblacion"),
                ("resp-03", "grp-drainage"),
                ("resp-04", "grp-evacuation"),
            ]
            for rid, gid in default_memberships:
                await db.execute(
                    "INSERT INTO responder_group_members (responder_id, group_id) VALUES (?, ?)",
                    (rid, gid),
                )
            await db.commit()

        # Seed default notification templates if empty
        cursor = await db.execute("SELECT COUNT(*) FROM notification_templates")
        template_count = (await cursor.fetchone())[0]
        if template_count == 0:
            default_templates = [
                (
                    "tmpl-blockage",
                    "blockage",
                    "Curb Grate Blockage Alert",
                    "URGENT: Culvert grate blockage detected at {location}. Surface coverage: {occlusion_ratio}%. Immediate clearance required.",
                ),
                (
                    "tmpl-warning",
                    "warning",
                    "Rising Water Inflow Warning",
                    "ADVISORY: Heavy inflow approaching {location} at {time}. Monitor drainage channels.",
                ),
                (
                    "tmpl-critical",
                    "critical",
                    "Critical Overflow Risk",
                    "CRITICAL: Severe obstruction at {location}. Flood threshold reached. Deploy response team immediately.",
                ),
                (
                    "tmpl-announcement",
                    "announcement",
                    "General DRRMO Advisory",
                    "COMMUNITY ADVISORY: Drainage maintenance scheduled for {location} on {time}. Keep grates clear.",
                ),
                (
                    "tmpl-clear",
                    "clear",
                    "Drainage Blockage Resolved",
                    "ALL CLEAR: Obstruction at {location} cleared as of {time}. Normal runoff restored.",
                ),
            ]
            for tid, ttype, title, msg in default_templates:
                await db.execute(
                    "INSERT INTO notification_templates (id, type, title, message) VALUES (?, ?, ?, ?)",
                    (tid, ttype, title, msg),
                )
            await db.commit()
        else:
            # Add tmpl-clear if existing database lacks it
            cursor = await db.execute("SELECT id FROM notification_templates WHERE id = 'tmpl-clear'")
            if not await cursor.fetchone():
                await db.execute(
                    "INSERT INTO notification_templates (id, type, title, message) VALUES (?, ?, ?, ?)",
                    (
                        "tmpl-clear",
                        "clear",
                        "Drainage Blockage Resolved",
                        "ALL CLEAR: Obstruction at {location} cleared as of {time}. Normal runoff restored.",
                    ),
                )
                await db.commit()

        # Seed default SMS gateway config if empty
        cursor = await db.execute("SELECT COUNT(*) FROM sms_gateway_config")
        sms_cfg_count = (await cursor.fetchone())[0]
        if sms_cfg_count == 0:
            await db.execute(
                """
                INSERT INTO sms_gateway_config (
                    id, enabled, mode, gateway_url, api_key, cooldown_minutes, max_retries, default_group_id, last_ping_status
                ) VALUES ('default', 1, 'mock', 'http://192.168.1.100:8080', 'admin:secret', 15, 3, 'grp-drainage', 'UNKNOWN')
                """
            )
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
