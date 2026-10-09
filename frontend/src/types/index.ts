export type ROI = [number, number, number, number]; // [x_min, y_min, x_max, y_max] normalized 0.0 - 1.0

export interface ROIObject {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

export type OcclusionStatus = 'CLEAR' | 'WARNING' | 'CRITICAL' | 'CRITICAL BLOCKED';

export interface Detection {
  id?: string;
  label: string;
  confidence: number;
  box: [number, number, number, number]; // [x_min, y_min, x_max, y_max] normalized 0..1
}

export interface FrameTelemetry {
  frame_b64?: string;
  image?: string;
  timestamp: number | string;
  fps: number;
  latency_ms: number;
  occlusion_ratio: number; // percentage 0..100
  status: OcclusionStatus;
  roi: ROI;
  detections: Detection[];
  camera_id: string;
  camera_name: string;
  location?: string;
  hysteresis_ratio?: string; // e.g. "2/3 frames"
  trash_count?: number;
  pond_level_cm?: number;
  store_and_forward_queue_size?: number;
}

export type StreamSourceType = 'demo' | 'webcam' | 'rtsp';

export interface StreamSource {
  id: string;
  type: StreamSourceType;
  name: string;
  description: string;
  url?: string;
  device_index?: number;
}

export interface Incident {
  id: string;
  timestamp: string;
  camera_id: string;
  camera_name: string;
  location: string;
  occlusion_ratio: number;
  status: OcclusionStatus;
  debris_types: string[];
  snapshot_url?: string;
  action_taken?: 'PENDING' | 'DISPATCHED' | 'RESOLVED' | 'CLEARED';
  dispatched_at?: string;
  acknowledged?: boolean;
  source_type?: string; // 'demo' | 'live' | 'manual' | 'unknown'
  cloud_synced?: boolean;
}

export interface RainHazard {
  active: boolean;
  source: 'auto' | 'override';
  threshold_mm: number;
}

export interface ModelStatus {
  loaded: boolean;
  weights_sha256?: string | null;
  model_version?: string | null;
  input_source?: 'demo' | 'live' | string;
  is_synthetic?: boolean;
  next_inference_in?: number | null;
  interval_seconds?: number | null;
}
