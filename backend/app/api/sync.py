from fastapi import APIRouter
from app.services.sync_service import sync_service

router = APIRouter()


@router.get("/status")
async def get_sync_status():
    """Retrieve store-and-forward queue status and internet reachability."""
    return await sync_service.get_status()


@router.post("/flush")
async def flush_sync_queue():
    """Trigger an immediate cloud sync flush if online."""
    return await sync_service.flush_sync_queue()
