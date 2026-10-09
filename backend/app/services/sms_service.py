import asyncio
from contextlib import closing
from datetime import datetime
import json
import logging
import sqlite3
from typing import Any, Dict, List, Optional
import uuid

import httpx

from app.core.config import settings

logger = logging.getLogger("agos.sms_service")


class SMSService:
    """
    Local Phone SMS Gateway Service for AGOS-Offline.
    Communicates with an Android device running the SMSGate app (capcom6/android-sms-gateway)
    over local Wi-Fi / hotspot via HTTP Basic Auth. Also supports simulated 'mock' mode.
    """

    def get_config_sync(self) -> Dict[str, Any]:
        """Fetch current SMS gateway configuration synchronously from SQLite."""
        try:
            with closing(sqlite3.connect(str(settings.DATABASE_PATH))) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM sms_gateway_config WHERE id = 'default'"
                ).fetchone()
                if row:
                    return dict(row)
        except Exception as err:
            logger.debug(f"Error fetching SMS config: {err}")

        return {
            "id": "default",
            "enabled": 1,
            "mode": "mock",
            "gateway_url": "http://192.168.1.100:8080",
            "api_key": "admin:secret",
            "cooldown_minutes": 15,
            "max_retries": 3,
            "default_group_id": "grp-drainage",
            "last_ping_status": "UNKNOWN",
            "last_ping_at": None,
        }

    async def get_config(self) -> Dict[str, Any]:
        """Fetch current SMS gateway configuration asynchronously."""
        import aiosqlite
        try:
            async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute("SELECT * FROM sms_gateway_config WHERE id = 'default'")
                row = await cursor.fetchone()
                if row:
                    return dict(row)
        except Exception as err:
            logger.debug(f"Error fetching SMS config async: {err}")
        return self.get_config_sync()

    async def update_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update SMS gateway configuration."""
        import aiosqlite
        allowed_fields = [
            "enabled", "mode", "gateway_url", "api_key",
            "cooldown_minutes", "max_retries", "default_group_id"
        ]
        clauses = []
        params = []
        for key in allowed_fields:
            if key in updates and updates[key] is not None:
                clauses.append(f"{key} = ?")
                params.append(updates[key])

        if not clauses:
            return await self.get_config()

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        clauses.append("updated_at = ?")
        params.append(now_str)
        params.append("default")

        async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
            await db.execute(
                f"UPDATE sms_gateway_config SET {', '.join(clauses)} WHERE id = ?",
                tuple(params),
            )
            await db.commit()

        return await self.get_config()

    async def ping_gateway(self) -> Dict[str, Any]:
        """Ping the Android SMS Gateway phone or verify mock mode."""
        import aiosqlite
        cfg = await self.get_config()
        mode = cfg.get("mode", "mock")
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if mode == "mock":
            status_result = "ONLINE"
            message = "Mock Mode active. SMS dispatches will be logged to database and console without hardware."
        else:
            gateway_url = (cfg.get("gateway_url") or "").rstrip("/")
            api_key = cfg.get("api_key") or "admin:secret"
            username, password = api_key.split(":", 1) if ":" in api_key else ("admin", api_key)

            try:
                async with httpx.AsyncClient(
                    base_url=gateway_url,
                    timeout=5.0,
                    auth=httpx.BasicAuth(username, password)
                ) as client:
                    resp = await client.get("/")
                    if resp.status_code in [200, 401, 404]:
                        status_result = "ONLINE"
                        message = f"Connected to Android Gateway (HTTP {resp.status_code})"
                    else:
                        status_result = "OFFLINE"
                        message = f"Gateway responded with unexpected HTTP {resp.status_code}"
            except Exception as e:
                status_result = "OFFLINE"
                message = f"Gateway unreachable: {str(e)}"

        async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
            await db.execute(
                "UPDATE sms_gateway_config SET last_ping_status = ?, last_ping_at = ? WHERE id = 'default'",
                (status_result, now_str),
            )
            await db.commit()

        return {
            "status": status_result,
            "mode": mode,
            "message": message,
            "pinged_at": now_str,
            "gateway_url": cfg.get("gateway_url"),
        }

    async def send_one_sms(self, phone_number: str, message: str) -> Dict[str, Any]:
        """
        Send a single SMS message.
        Handles mock simulation or live HTTP dispatch to Android SMSGate app with retries.
        """
        cfg = await self.get_config()
        if not cfg.get("enabled", 1):
            logger.info("SMS delivery is disabled in configuration. Skipping.")
            return {"status": "DISABLED", "phone_number": phone_number}

        mode = cfg.get("mode", "mock")

        if mode == "mock":
            logger.info(f"📱 [MOCK SMS DISPATCH] To: {phone_number} | Message: {message}")
            return {
                "status": "SENT",
                "phone_number": phone_number,
                "mode": "mock",
                "delivered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }

        gateway_url = (cfg.get("gateway_url") or "").rstrip("/")
        api_key = cfg.get("api_key") or "admin:secret"
        username, password = api_key.split(":", 1) if ":" in api_key else ("admin", api_key)
        max_retries = int(cfg.get("max_retries", 3))

        endpoint = "/3rdparty/v1/message" if "sms-gate.app" in gateway_url else "/message"
        payload = {"phoneNumbers": [phone_number], "message": message}

        for attempt in range(1, max_retries + 1):
            try:
                async with httpx.AsyncClient(
                    base_url=gateway_url,
                    timeout=10.0,
                    auth=httpx.BasicAuth(username, password)
                ) as client:
                    resp = await client.post(endpoint, json=payload)
                    if resp.status_code in [200, 201, 202, 204]:
                        logger.info(f"Successfully sent live SMS to {phone_number} on attempt {attempt}")
                        return {
                            "status": "SENT",
                            "phone_number": phone_number,
                            "mode": "live",
                            "delivered_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        }
                    else:
                        logger.warning(
                            f"SMS Gateway returned HTTP {resp.status_code} ({resp.text}) for {phone_number} (attempt {attempt}/{max_retries})"
                        )
            except Exception as exc:
                logger.warning(f"SMS delivery error to {phone_number} (attempt {attempt}/{max_retries}): {exc}")

            if attempt < max_retries:
                await asyncio.sleep(1.0 * attempt)

        return {
            "status": "FAILED",
            "phone_number": phone_number,
            "mode": "live",
            "error": "Exhausted retries or phone gateway unreachable",
        }

    async def send_bulk_sms(self, phone_numbers: List[str], message: str) -> Dict[str, Any]:
        """Send an SMS message to a list of phone numbers with rate pacing."""
        sent = []
        failed = []

        for number in phone_numbers:
            clean_num = number.strip()
            if not clean_num:
                continue
            res = await self.send_one_sms(phone_number=clean_num, message=message)
            if res.get("status") == "SENT":
                sent.append(clean_num)
            else:
                failed.append(clean_num)

            if len(phone_numbers) > 1:
                await asyncio.sleep(0.5)

        return {
            "total": len(phone_numbers),
            "sent": sent,
            "failed": failed,
            "status": "SENT" if not failed else ("PARTIAL" if sent else "FAILED"),
        }

    def dispatch_incident_alert_sync(
        self,
        camera_id: str,
        location: str,
        occlusion_ratio: float,
        is_clear: bool = False,
        incident_id: Optional[str] = None,
        radio_ticket: Optional[str] = None,
    ) -> None:
        """
        Synchronous dispatch helper callable from the video stream processing thread.
        Spawns an async task on the running event loop, or executes via a dedicated runner.
        """
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(
                self.dispatch_incident_alert_async(
                    camera_id=camera_id,
                    location=location,
                    occlusion_ratio=occlusion_ratio,
                    is_clear=is_clear,
                    incident_id=incident_id,
                    radio_ticket=radio_ticket,
                )
            )
        except RuntimeError:
            try:
                # If no running event loop in thread, schedule using run_coroutine_threadsafe or new loop
                import threading
                t = threading.Thread(
                    target=lambda: asyncio.run(
                        self.dispatch_incident_alert_async(
                            camera_id=camera_id,
                            location=location,
                            occlusion_ratio=occlusion_ratio,
                            is_clear=is_clear,
                            incident_id=incident_id,
                            radio_ticket=radio_ticket,
                        )
                    ),
                    daemon=True,
                )
                t.start()
            except Exception as e:
                logger.error(f"Failed to spawn incident alert thread: {e}")

    async def dispatch_incident_alert_async(
        self,
        camera_id: str,
        location: str,
        occlusion_ratio: float,
        is_clear: bool = False,
        incident_id: Optional[str] = None,
        radio_ticket: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Formulate and dispatch SMS alerts to designated responders for a camera incident.
        Uses template interpolation and persists records to notification_dispatches and sync_queue.
        """
        import aiosqlite

        cfg = await self.get_config()
        if not cfg.get("enabled", 1):
            return {"status": "DISABLED"}

        time_str = datetime.now().strftime("%I:%M %p")

        try:
            async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
                db.row_factory = aiosqlite.Row

                # 1. Determine target responder group
                cam_cursor = await db.execute(
                    "SELECT * FROM cameras WHERE id = ?",
                    (camera_id,),
                )
                cam_row = await cam_cursor.fetchone()
                cam_dict = dict(cam_row) if cam_row else {}

                cam_loc = location or cam_dict.get("location") or cam_dict.get("name") or camera_id
                target_group_id = cam_dict.get("target_group_id") or cfg.get("default_group_id", "grp-drainage")

                # 2. Find eligible recipients
                if target_group_id:
                    cursor = await db.execute(
                        """
                        SELECT r.id, r.phone_number, r.notif_preferences
                        FROM responders r
                        JOIN responder_group_members rgm ON r.id = rgm.responder_id
                        WHERE rgm.group_id = ? AND r.status = 'active'
                        """,
                        (target_group_id,),
                    )
                    recipients = await cursor.fetchall()
                else:
                    recipients = []

                # If no group members, fallback to all active responders
                if not recipients:
                    cursor = await db.execute(
                        "SELECT id, phone_number, notif_preferences FROM responders WHERE status = 'active'"
                    )
                    recipients = await cursor.fetchall()

                pref_key = "clear" if is_clear else "critical"
                phone_numbers = []
                recipient_ids = []
                for r in recipients:
                    prefs_raw = r["notif_preferences"]
                    try:
                        prefs = json.loads(prefs_raw) if isinstance(prefs_raw, str) else prefs_raw
                    except Exception:
                        prefs = {}
                    if prefs.get(pref_key, True) or prefs.get("blockage", True):
                        phone_numbers.append(r["phone_number"])
                        recipient_ids.append(r["id"])

                if not phone_numbers:
                    logger.info(f"No eligible responder phone numbers for incident at camera {camera_id}.")
                    return {"status": "NO_RECIPIENTS"}

                # 3. Retrieve template
                template_id = "tmpl-clear" if is_clear else "tmpl-critical"
                t_cursor = await db.execute(
                    "SELECT title, message FROM notification_templates WHERE id = ?",
                    (template_id,),
                )
                t_row = await t_cursor.fetchone()

                if t_row:
                    tmpl_title = t_row["title"]
                    tmpl_msg = t_row["message"]
                else:
                    if is_clear:
                        tmpl_title = "Drainage Blockage Resolved"
                        tmpl_msg = "ALL CLEAR: Obstruction at {location} cleared as of {time}. Normal runoff restored."
                    else:
                        tmpl_title = "Critical Overflow Risk"
                        tmpl_msg = "CRITICAL: Severe obstruction at {location} ({occlusion_ratio}%). Immediate declogging required."

                formatted_msg = tmpl_msg.format(
                    location=cam_loc,
                    occlusion_ratio=f"{occlusion_ratio:.1f}",
                    time=time_str,
                )
                if radio_ticket and f"[{radio_ticket}]" not in formatted_msg and f"Ticket {radio_ticket}" not in formatted_msg:
                    formatted_msg = f"[Ticket {radio_ticket}] {formatted_msg}"

                # 4. Dispatch SMS
                result = await self.send_bulk_sms(phone_numbers=phone_numbers, message=formatted_msg)

                # 5. Persist to notification_dispatches
                dispatch_id = f"disp-{uuid.uuid4().hex[:8]}"
                dispatch_status = "DISPATCHED" if result.get("status") == "SENT" else ("FAILED" if result.get("status") == "FAILED" else "PARTIAL")

                await db.execute(
                    """
                    INSERT INTO notification_dispatches (
                        id, type, title, message, target_group_id, recipient_count, status, incident_id, radio_ticket
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dispatch_id,
                        "clear" if is_clear else "critical",
                        tmpl_title,
                        formatted_msg,
                        target_group_id,
                        len(phone_numbers),
                        dispatch_status,
                        incident_id,
                        radio_ticket,
                    ),
                )

                # 6. Queue to sync_queue
                sync_payload = {
                    "id": dispatch_id,
                    "type": "clear" if is_clear else "critical",
                    "title": tmpl_title,
                    "message": formatted_msg,
                    "target_group_id": target_group_id,
                    "recipient_count": len(phone_numbers),
                    "recipient_ids": recipient_ids,
                    "camera_id": camera_id,
                    "incident_id": incident_id,
                    "radio_ticket": radio_ticket,
                    "status": dispatch_status,
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
                return result
        except Exception as exc:
            logger.warning(f"Unable to dispatch incident alert via SMS: {exc}")
            return {"status": "ERROR", "error": str(exc)}


sms_service = SMSService()
