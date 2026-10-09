import json
import base64
import asyncio
import logging
from typing import Set, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.services.stream_service import stream_service

logger = logging.getLogger("agos.ws")
logger.setLevel(logging.INFO)

router = APIRouter()


class ConnectionManager:
    """Manages active WebSocket connections and handles broadcasts."""
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._broadcast_task: Optional[asyncio.Task] = None
        self._is_broadcasting: bool = False

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
            logger.info(f"WebSocket client connected. Total active: {len(self._connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)
            logger.info(f"WebSocket client disconnected. Total active: {len(self._connections)}")

    async def broadcast_json(self, message: Dict[str, Any]) -> None:
        """Broadcast a JSON message to all active clients."""
        async with self._lock:
            clients = list(self._connections)

        if not clients:
            return

        dead_clients = []
        for ws in clients:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.debug(f"Failed to send to client: {e}")
                dead_clients.append(ws)

        if dead_clients:
            async with self._lock:
                for ws in dead_clients:
                    self._connections.discard(ws)

    def count(self) -> int:
        return len(self._connections)


manager = ConnectionManager()


async def broadcast_loop() -> None:
    """Continuous background loop broadcasting video frames & detection telemetry."""
    interval = 1.0 / max(1, settings.STREAM_FPS)
    logger.info(f"Stream broadcaster loop started (target FPS: {settings.STREAM_FPS})")

    while True:
        try:
            start_time = asyncio.get_running_loop().time()

            # Only encode and broadcast when clients are actively listening
            if manager.count() > 0:
                jpeg_bytes = stream_service.get_latest_jpeg()
                if jpeg_bytes is not None:
                    b64_frame = base64.b64encode(jpeg_bytes).decode("ascii")
                    status_info = stream_service.get_status()
                    detection_info = stream_service.latest_detection

                    message = {
                        "type": "stream_tick",
                        "frame": f"data:image/jpeg;base64,{b64_frame}",
                        "image": f"data:image/jpeg;base64,{b64_frame}",
                        "frame_b64": f"data:image/jpeg;base64,{b64_frame}",
                        "timestamp": datetime.now().isoformat(),
                        "camera_id": stream_service.current_camera_id,
                        "roi": stream_service.roi,
                        "fps": status_info.get("fps", 0.0),
                        "status": detection_info.get("status", "CLEAR"),
                        "occlusion_ratio": detection_info.get("occlusion_ratio", 0.0),
                        "raw_ratio": detection_info.get("raw_ratio", 0.0),
                        "debris_count": detection_info.get("debris_count", 0),
                        "detections": detection_info.get("boxes", []),
                        "connection": {
                            "is_connected": status_info.get("is_connected", False),
                            "is_synthetic": status_info.get("is_synthetic", False),
                            "source_type": status_info.get("source_type", "unknown"),
                            "source": status_info.get("source", ""),
                            "error": status_info.get("error"),
                        },
                        "detection": detection_info,
                    }

                    await manager.broadcast_json(message)

            elapsed = asyncio.get_running_loop().time() - start_time
            sleep_duration = max(0.01, interval - elapsed)
            await asyncio.sleep(sleep_duration)

        except asyncio.CancelledError:
            logger.info("Broadcaster loop cancelled.")
            break
        except Exception as e:
            logger.error(f"Error in broadcast loop: {e}", exc_info=True)
            await asyncio.sleep(0.5)


@router.websocket("/ws")
async def websocket_stream_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time video stream frames and detection telemetry.
    URL: ws://localhost:8000/ws
    """
    await manager.connect(websocket)

    # Immediately send initial status handshake
    try:
        initial_status = {
            "type": "connected",
            "camera_id": stream_service.current_camera_id,
            "roi": stream_service.roi,
            "status": stream_service.get_status(),
            "detection": stream_service.latest_detection,
            "server_time": datetime.now().isoformat()
        }
        await websocket.send_json(initial_status)
    except Exception:
        await manager.disconnect(websocket)
        return

    try:
        while True:
            # Receive client interactions (heartbeat, ROI adjustment, etc.)
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                action = msg.get("action") or msg.get("type")

                if action == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": datetime.now().isoformat()})
                elif action == "get_status":
                    await websocket.send_json({
                        "type": "status",
                        "status": stream_service.get_status(),
                        "detection": stream_service.latest_detection
                    })
                elif action == "update_roi":
                    roi = msg.get("roi")
                    if roi and len(roi) == 4:
                        stream_service.set_roi(roi)
                        await websocket.send_json({
                            "type": "roi_updated",
                            "roi": stream_service.roi
                        })
            except json.JSONDecodeError:
                # Simple string ping
                if data.strip().lower() == "ping":
                    await websocket.send_text("pong")
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket client exception: {e}")
        await manager.disconnect(websocket)
