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
  radio_ticket?: string | null;
  radio_dispatched_at?: string | null;
}

export type IncidentRecord = Incident & {
  resolved?: boolean;
  thumbnail_url?: string;
};

export interface RainHazard {
  active: boolean;
  source: 'auto' | 'override';
  threshold_mm: number;
}

export interface WeatherSnapshot {
  is_online: boolean;
  rainfall_mm: number;
  temperature_c: number | null;
  humidity_pct: number | null;
  condition: string;
  message: string;
  location?: string;
  cached?: boolean;
  weather_code?: number | null;
  timestamp?: string;
  rain_hazard?: RainHazard;
  wind_speed_kmh?: number | null;
  wind_direction_degrees?: number | null;
  cloud_cover_percent?: number | null;
  precipitation_description?: string | null;
  temperature_description?: string | null;
  humidity_level?: string | null;
  wind_category?: string | null;
  wind_direction_label?: string | null;
  cloudiness?: string | null;
  comfort_level?: string | null;
  storm_risk_level?: string | null;
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

export interface ResponderNotificationPreferences {
  warning: boolean;
  critical: boolean;
  blockage: boolean;
  announcement: boolean;
}

export interface Responder {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  status: 'active' | 'inactive' | string;
  location: string;
  notif_preferences: ResponderNotificationPreferences | string;
  created_at?: string;
  group_ids?: string[];
}

export interface ResponderGroup {
  id: string;
  name: string;
  description: string;
  created_at?: string;
  member_count?: number;
  member_ids?: string[];
}

export interface NotificationTemplate {
  id: string;
  type: 'blockage' | 'warning' | 'critical' | 'announcement' | string;
  title: string;
  message: string;
  created_at?: string;
}

export interface AnnouncementPayload {
  type: string;
  title: string;
  message: string;
  target_group_id?: string;
}

export interface NotificationLog {
  id: string;
  type: string;
  title: string;
  message: string;
  target_group_id?: string | null;
  target_group_name?: string | null;
  recipient_count: number;
  status: string;
  created_at: string;
}

export interface SmsGatewayConfig {
  id: string;
  enabled: number;
  mode: 'live' | 'mock';
  gateway_url: string;
  api_key: string;
  cooldown_minutes: number;
  max_retries: number;
  default_group_id: string;
  last_ping_status: string;
  last_ping_at: string | null;
}

export interface SmsTestRequest {
  phone_number: string;
  message?: string;
}

export interface DispatchRequestPayload {
  radio_ticket?: string;
  channel?: string;
  assigned_group_id?: string;
  send_sms?: boolean;
  notes?: string;
}

export interface DispatchStatusResponse {
  incident_id: string;
  radio_ticket: string | null;
  radio_dispatched: boolean;
  radio_dispatched_at?: string | null;
  sms_dispatched: boolean;
  sms_details?: {
    id: string;
    type: string;
    title: string;
    message: string;
    target_group_id?: string | null;
    target_group_name?: string | null;
    recipient_count: number;
    status: string;
    created_at: string;
  } | null;
}

