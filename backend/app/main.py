import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from app.core.config import settings
from app.core.database import init_db, get_active_camera_record
from app.services.stream_service import stream_service
from app.services.sync_service import sync_worker_loop
from app.services.weather_service import weather_worker_loop
from app.api.cameras import router as cameras_router, switch_stream_source, StreamSwitchRequest
from app.api.incidents import router as incidents_router
from app.api.weather import router as weather_router
from app.api.sync import router as sync_router
from app.api.responders import router as responders_router
from app.api.notifications import router as notifications_router
from app.api.sms import router as sms_router
from app.api.ws import router as ws_router, broadcast_loop, manager

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger("agos.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle management.
    Initializes embedded SQLite database, starts video ingestion stream,
    runs background WebSocket broadcaster, and store-and-forward sync worker.
    """
    logger.info(f"Starting {settings.PROJECT_NAME} v{settings.VERSION}...")

    # 1. Initialize SQLite tables and seed defaults
    await init_db()
    logger.info("SQLite database initialized and verified.")

    # 2. Retrieve active camera configuration
    active_cam = await get_active_camera_record()
    if active_cam:
        logger.info(f"Loaded active camera: {active_cam['name']} ({active_cam['source']})")
        stream_service.start(
            source=active_cam["source"],
            camera_id=active_cam["id"],
            roi=active_cam.get("roi")
        )
    else:
        logger.warning("No active camera found. Starting stream with default sample video.")
        stream_service.start(
            source=str(settings.DEFAULT_SAMPLE_VIDEO),
            camera_id="cam-default",
            roi=list(settings.DEFAULT_ROI)
        )

    # 3. Start background WebSocket frame & telemetry broadcaster loop
    broadcast_task = asyncio.create_task(broadcast_loop())
    logger.info("WebSocket broadcaster task started.")

    # 4. Start background store-and-forward cloud sync worker loop
    sync_task = asyncio.create_task(sync_worker_loop())
    logger.info("Store-and-forward sync worker task started.")

    # 5. Start weather poller (stores a row every WEATHER_FETCH_INTERVAL_SECONDS when online)
    weather_task = asyncio.create_task(weather_worker_loop(manager.broadcast_json))
    logger.info("Weather worker task started.")

    yield

    # Shutdown sequence
    logger.info("Shutting down stream ingestion, WebSocket broadcaster, and sync worker...")
    broadcast_task.cancel()
    sync_task.cancel()
    weather_task.cancel()
    try:
        await asyncio.gather(broadcast_task, sync_task, weather_task, return_exceptions=True)
    except Exception:
        pass

    stream_service.stop()
    logger.info("AGOS-Offline backend shutdown complete.")


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Local-AI Drainage Inflow & Flood Mitigation Console for Philippine LGU Command Centers",
    lifespan=lifespan
)

# CORS Middleware (allows operator console from localhost:5173 or other intranet clients)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file mount for locally stored incident frames
app.mount(
    "/storage",
    StaticFiles(directory=str(settings.STORAGE_BASE_DIR)),
    name="storage"
)

# API Routers
app.include_router(cameras_router, prefix=f"{settings.API_PREFIX}/cameras", tags=["Cameras"])
app.include_router(incidents_router, prefix=f"{settings.API_PREFIX}/incidents", tags=["Incidents"])
app.include_router(weather_router, prefix=f"{settings.API_PREFIX}/weather", tags=["Weather"])
app.include_router(sync_router, prefix=f"{settings.API_PREFIX}/sync", tags=["Sync"])
app.include_router(responders_router, prefix="/api/v1", tags=["responders"])
app.include_router(notifications_router, prefix="/api/v1", tags=["notifications"])
app.include_router(sms_router, prefix="/api/v1", tags=["SMS"])
app.include_router(ws_router)
app.include_router(ws_router, prefix=settings.API_PREFIX)


@app.post(f"{settings.API_PREFIX}/stream", tags=["Cameras"])
async def stream_switch_fallback(payload: StreamSwitchRequest = None):
    """Direct alias for switching streams from root API prefix."""
    import aiosqlite
    async with aiosqlite.connect(str(settings.DATABASE_PATH)) as db:
        return await switch_stream_source(payload=payload, db=db)


@app.get("/", tags=["Health"])
@app.get("/health", tags=["Health"])
@app.get(f"{settings.API_PREFIX}/health", tags=["Health"])
async def health_check():
    """Health check endpoint providing system status and stream telemetry."""
    return {
        "status": "online",
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": "offline-edge",
        "active_camera_id": stream_service.current_camera_id,
        "stream": stream_service.get_status(),
        "model": stream_service.get_model_status(),
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        log_level="info"
    )
