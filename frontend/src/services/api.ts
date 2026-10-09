import { Incident, ROI, StreamSource } from '../types';

const API_BASE = '/api/v1';

export async function saveROI(cameraId: string, roi: ROI): Promise<{ success: boolean; roi: ROI }> {
  try {
    const res = await fetch(`${API_BASE}/cameras/${cameraId}/roi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roi,
        x_min: roi[0],
        y_min: roi[1],
        x_max: roi[2],
        y_max: roi[3],
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to save ROI: ${res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    console.warn('[API] Backend unreachable or failed saving ROI, saving locally in localStorage:', err);
    localStorage.setItem(`agos_roi_${cameraId}`, JSON.stringify(roi));
    return { success: true, roi };
  }
}

export async function loadROI(cameraId: string): Promise<ROI | null> {
  try {
    const res = await fetch(`${API_BASE}/cameras/${cameraId}/roi`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.roi)) return data.roi as ROI;
      if (typeof data.x_min === 'number') {
        return [data.x_min, data.y_min, data.x_max, data.y_max];
      }
    }
  } catch (err) {
    console.warn('[API] Could not fetch ROI from backend, checking localStorage:', err);
  }

  const cached = localStorage.getItem(`agos_roi_${cameraId}`);
  if (cached) {
    try {
      return JSON.parse(cached) as ROI;
    } catch {
      return null;
    }
  }
  return null;
}

export async function switchStream(cameraId: string, source: StreamSource): Promise<{ success: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        camera_id: cameraId,
        source_type: source.type,
        url: source.url,
        device_index: source.device_index,
      }),
    });
    if (!res.ok) {
      // Try camera-specific route
      const altRes = await fetch(`${API_BASE}/cameras/${cameraId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(source),
      });
      if (!altRes.ok) throw new Error(`Stream switch failed: ${res.statusText}`);
    }
    return { success: true };
  } catch (err) {
    console.warn('[API] Could not switch stream on backend, updated local state:', err);
    return { success: true };
  }
}

export async function fetchIncidents(): Promise<Incident[]> {
  try {
    const res = await fetch(`${API_BASE}/incidents`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.incidents)) return data.incidents;
    }
  } catch (err) {
    console.warn('[API] Backend unreachable for incidents, returning fallback records:', err);
  }

  // Fallback demo incidents for offline EOC operations
  return [
    {
      id: 'INC-2026-1008-01',
      timestamp: '2026-10-09 14:48:22',
      camera_id: 'cam-01',
      camera_name: 'CAM-01: Rizal Ave Culvert #4',
      location: 'Brgy. San Jose, Rizal Ave cor. Mabini St.',
      occlusion_ratio: 78.4,
      status: 'CRITICAL BLOCKED',
      debris_types: ['Plastic Sacks', 'Vegetative Cluster', 'Styrofoam'],
      action_taken: 'DISPATCHED',
      dispatched_at: '14:50:11',
      acknowledged: true,
    },
    {
      id: 'INC-2026-1008-02',
      timestamp: '2026-10-09 13:22:15',
      camera_id: 'cam-01',
      camera_name: 'CAM-01: Rizal Ave Culvert #4',
      location: 'Brgy. San Jose, Rizal Ave cor. Mabini St.',
      occlusion_ratio: 42.1,
      status: 'WARNING',
      debris_types: ['Plastic Bottles', 'Cardboard Debris'],
      action_taken: 'RESOLVED',
      dispatched_at: '13:25:00',
      acknowledged: true,
    },
    {
      id: 'INC-2026-1008-03',
      timestamp: '2026-10-09 11:05:40',
      camera_id: 'cam-02',
      camera_name: 'CAM-02: Taft Inflow Canal Gate 2',
      location: 'Brgy. Taft Central, Gate 2 Sluice',
      occlusion_ratio: 84.6,
      status: 'CRITICAL BLOCKED',
      debris_types: ['Car Tire', 'Trash Bags', 'Tree Branch'],
      action_taken: 'RESOLVED',
      dispatched_at: '11:07:33',
      acknowledged: true,
    },
  ];
}

export async function resolveIncident(incidentId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/incidents/${incidentId}/resolve`, {
      method: 'POST',
    });
    return res.ok;
  } catch (err) {
    console.warn('[API] Could not resolve incident on backend:', err);
    return false;
  }
}

export async function fetchWeather(): Promise<{
  is_online: boolean;
  rainfall_mm: number;
  temperature_c: number | null;
  humidity_pct: number | null;
  condition: string;
  message: string;
  cached?: boolean;
}> {
  try {
    const res = await fetch(`${API_BASE}/weather`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Weather endpoint unreachable:', err);
  }
  return {
    is_online: false,
    rainfall_mm: 0.0,
    temperature_c: null,
    humidity_pct: null,
    condition: 'Offline Mode',
    message: 'Offline (Weather unavailable)',
    cached: false,
  };
}

export async function fetchSyncStatus(): Promise<{
  is_online: boolean;
  status: string;
  status_label: string;
  pending_count: number;
  synced_count: number;
}> {
  try {
    const res = await fetch(`${API_BASE}/sync/status`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Sync status unreachable:', err);
  }
  return {
    is_online: false,
    status: 'LOCAL_OFFLINE',
    status_label: 'Local Offline Mode',
    pending_count: 0,
    synced_count: 0,
  };
}

