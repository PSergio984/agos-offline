"""Store-and-forward Supabase synchronization service for AGOS-Offline.

Manages the local SQLite sync_queue, detects internet reachability, and
forwards offline incident logs to the cloud when an active connection is restored.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

import aiosqlite
import httpx

from app.core.config import settings

logger = logging.getLogger("agos.sync")
logger.setLevel(logging.INFO)

PROBE_URL = "https://1.1.1.1"
PROBE_TIMEOUT = 2.0


class SyncService:
    """Manages cloud sync queue drain and internet reachability detection."""

    def __init__(self) -> None:
        self._is_online: bool = False
        self._last_sync_time: Optional[datetime] = None
        self._last_error: Optional[str] = None
        self._worker_task: Optional[asyncio.Task] = None

    @property
    def is_online(self) -> bool:
        return self._is_online

    async def check_internet_reachability(self) -> bool:
        """Check if an external internet connection is currently reachable."""
        try:
            async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
                resp = await client.head(PROBE_URL)
                self._is_online = resp.status_code < 500
                return self._is_online
        except Exception:
            self._is_online = False
            return False

    async def get_status(self) -> Dict[str, Any]:
        """Retrieve current sync queue telemetry from SQLite."""
        async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
            db.row_factory = aiosqlite.Row

            cursor = await db.execute(
                "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'"
            )
            pending_row = await cursor.fetchone()
            pending_count = pending_row["count"] if pending_row else 0

            cursor = await db.execute(
                "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'SYNCED'"
            )
            synced_row = await cursor.fetchone()
            synced_count = synced_row["count"] if synced_row else 0

        reachability = await self.check_internet_reachability()
        has_supabase = bool(settings.SUPABASE_URL and settings.SUPABASE_KEY)

        status_text = "SYNCED_CLOUD" if reachability and pending_count == 0 else "LOCAL_OFFLINE"

        return {
            "is_online": reachability,
            "has_supabase_configured": has_supabase,
            "status": status_text,
            "status_label": "Synced with Cloud" if (reachability and pending_count == 0) else "Local Offline Mode",
            "pending_count": pending_count,
            "synced_count": synced_count,
            "last_sync_time": self._last_sync_time.isoformat() if self._last_sync_time else None,
            "error": self._last_error,
        }

    async def flush_sync_queue(self) -> Dict[str, Any]:
        """Flush pending sync_queue records to Supabase when online."""
        is_online = await self.check_internet_reachability()
        if not is_online:
            return {
                "success": False,
                "synced_count": 0,
                "message": "Cannot sync: System is running in Local Offline Mode",
            }

        async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
            db.row_factory = aiosqlite.Row

            cursor = await db.execute(
                "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 50"
            )
            rows = await cursor.fetchall()

            if not rows:
                return {
                    "success": True,
                    "synced_count": 0,
                    "message": "Sync queue is already empty (all records synced)",
                }

            flushed = 0
            has_supabase = bool(settings.SUPABASE_URL and settings.SUPABASE_KEY)

            for row in rows:
                row_id = row["id"]
                entity_id = row["entity_id"]
                payload_str = row["payload"]
                payload = json.loads(payload_str) if payload_str else {}

                # If Supabase credentials configured, post to Supabase REST table
                if has_supabase:
                    try:
                        headers = {
                            "apikey": settings.SUPABASE_KEY,
                            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
                            "Content-Type": "application/json",
                            "Prefer": "return=minimal",
                        }
                        endpoint = f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/drainage_incidents"
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            res = await client.post(endpoint, json=payload, headers=headers)
                            if res.status_code not in (200, 201):
                                logger.warning(f"Supabase sync rejected row {row_id}: {res.text}")
                                continue
                    except Exception as exc:
                        logger.error(f"Failed to post row {row_id} to Supabase: {exc}")
                        self._last_error = str(exc)
                        continue

                # Mark as SYNCED in SQLite
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                await db.execute(
                    "UPDATE sync_queue SET status = 'SYNCED', updated_at = ? WHERE id = ?",
                    (now_str, row_id),
                )
                await db.execute(
                    "UPDATE incidents SET synced = 1 WHERE id = ?",
                    (entity_id,),
                )
                flushed += 1

            await db.commit()

        self._last_sync_time = datetime.now()
        self._last_error = None
        logger.info(f"Store-and-forward sync flushed {flushed} items to cloud.")

        return {
            "success": True,
            "synced_count": flushed,
            "message": f"Successfully synced {flushed} records to cloud",
        }


sync_service = SyncService()


async def sync_worker_loop() -> None:
    """Continuous background loop checking reachability and draining sync queue."""
    logger.info(f"Store-and-forward sync loop started (poll interval: {settings.SYNC_INTERVAL_SECONDS}s)")
    while True:
        try:
            await asyncio.sleep(settings.SYNC_INTERVAL_SECONDS)
            is_online = await sync_service.check_internet_reachability()
            if is_online:
                await sync_service.flush_sync_queue()
        except asyncio.CancelledError:
            logger.info("Sync worker loop cancelled.")
            break
        except Exception as e:
            logger.debug(f"Sync worker loop idle: {e}")
            await asyncio.sleep(5.0)
