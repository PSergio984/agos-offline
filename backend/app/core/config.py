from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
BASE_DIR = BACKEND_DIR.parent

class Settings(BaseSettings):
    PROJECT_NAME: str = "AGOS-Offline"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api/v1"
    
    # Paths
    BASE_DIR: Path = BASE_DIR
    BACKEND_DIR: Path = BACKEND_DIR
    DATABASE_PATH: Path = BACKEND_DIR / "agos.db"
    STORAGE_BASE_DIR: Path = BACKEND_DIR / "storage"
    STORAGE_DIR: Path = BACKEND_DIR / "storage" / "incidents"
    WEIGHTS_PATH: Path = BACKEND_DIR / "app" / "ml" / "weights" / "best.onnx"
    SAMPLE_MEDIA_DIR: Path = BASE_DIR / "sample_media"
    DEFAULT_SAMPLE_VIDEO: Path = BASE_DIR / "sample_media" / "drainage_demo.mp4"
    
    # Thresholds (CLEAR < 25%, WARNING 25-59%, CRITICAL >= 60%)
    CLEAR_THRESHOLD: float = 25.0
    WARNING_THRESHOLD: float = 25.0
    CRITICAL_THRESHOLD: float = 60.0
    
    # YOLO parameters
    CONF_THRESHOLD: float = 0.35
    IOU_THRESHOLD: float = 0.50
    DEFAULT_INPUT_SIZE: int = 640
    
    # Stream & Ingestion settings
    STREAM_FPS: int = 10
    STREAM_RECONNECT_DELAY: float = 2.0
    STREAM_WIDTH: int = 640
    STREAM_HEIGHT: int = 480
    INFERENCE_INTERVAL_SECONDS: float = 3.0
    ENABLE_ADAPTIVE_INFERENCE: bool = True
    INFERENCE_INTERVAL_CLEAR: float = 30.0
    INFERENCE_INTERVAL_BURST: float = 3.0
    
    # Default Region of Interest [x_min, y_min, x_max, y_max] normalized 0..1
    DEFAULT_ROI: List[float] = [0.20, 0.40, 0.80, 0.90]

    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: List[str] = ["*"]

    # Supabase Store-and-Forward Cloud Sync (Optional)
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SYNC_INTERVAL_SECONDS: float = 30.0

    model_config = {"extra": "ignore"}

settings = Settings()
settings.STORAGE_BASE_DIR.mkdir(parents=True, exist_ok=True)
settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
settings.SAMPLE_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
