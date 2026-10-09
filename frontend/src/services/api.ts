import {
  Incident,
  ModelStatus,
  RainHazard,
  ROI,
  StreamSource,
  Responder,
  ResponderGroup,
  NotificationTemplate,
  AnnouncementPayload,
  NotificationLog,
} from '../types';

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
  weather_code?: number | null;
  rain_hazard?: RainHazard;
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

export async function fetchModelStatus(): Promise<ModelStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      return data.model ?? null;
    }
  } catch (err) {
    console.warn('[API] Health endpoint unreachable:', err);
  }
  return null;
}

/** Text for the header model chip. Tolerates a missing model (older backends). */
export function describeModelChip(model: ModelStatus | null | undefined): { label: string; demo: boolean } | null {
  if (!model) return null;
  const sha = model.weights_sha256 ? model.weights_sha256.slice(0, 8) : 'no-hash';
  const next = typeof model.next_inference_in === 'number' ? ` · next scan ${Math.ceil(model.next_inference_in)}s` : '';
  return {
    label: `${model.model_version ?? 'model'} ${sha}${next}`,
    demo: model.input_source === 'demo' || model.is_synthetic === true,
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

export async function setHazardOverride(active: boolean | null): Promise<RainHazard | null> {
  try {
    const res = await fetch(`${API_BASE}/weather/hazard/override`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not set hazard override:', err);
  }
  return null;
}

// -------------------------------------------------------------
// Responders, Groups & Notifications (Offline-first fallback)
// -------------------------------------------------------------

const DEFAULT_RESPONDER_GROUPS: ResponderGroup[] = [
  {
    id: 'grp-poblacion',
    name: 'Barangay Poblacion QRT',
    description: 'Primary emergency quick response team for Poblacion district.',
    member_count: 2,
    member_ids: ['resp-01', 'resp-03'],
  },
  {
    id: 'grp-drainage',
    name: 'Drainage Maintenance Unit',
    description: 'Engineering crew specialized in culvert clearing and desilting.',
    member_count: 2,
    member_ids: ['resp-02', 'resp-03'],
  },
  {
    id: 'grp-evacuation',
    name: 'Evacuation Coordination Unit',
    description: 'Operations team managing evacuation transit and community alerts.',
    member_count: 1,
    member_ids: ['resp-04'],
  },
];

const DEFAULT_RESPONDERS: Responder[] = [
  {
    id: 'resp-01',
    first_name: 'Juan',
    last_name: 'Dela Cruz',
    phone_number: '+639171234567',
    status: 'active',
    location: 'Barangay Poblacion Outpost',
    notif_preferences: { warning: true, critical: true, blockage: true, announcement: true },
    group_ids: ['grp-poblacion'],
  },
  {
    id: 'resp-02',
    first_name: 'Maria',
    last_name: 'Santos',
    phone_number: '+639182345678',
    status: 'active',
    location: 'Engineering Field Office',
    notif_preferences: { warning: true, critical: true, blockage: true, announcement: true },
    group_ids: ['grp-drainage'],
  },
  {
    id: 'resp-03',
    first_name: 'Antonio',
    last_name: 'Reyes',
    phone_number: '+639193456789',
    status: 'active',
    location: 'DRRMO Central Substation',
    notif_preferences: { warning: true, critical: true, blockage: true, announcement: true },
    group_ids: ['grp-poblacion', 'grp-drainage'],
  },
  {
    id: 'resp-04',
    first_name: 'Elena',
    last_name: 'Bautista',
    phone_number: '+639204567890',
    status: 'active',
    location: 'Evacuation Center Sector 3',
    notif_preferences: { warning: true, critical: true, blockage: true, announcement: true },
    group_ids: ['grp-evacuation'],
  },
];

const DEFAULT_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'tmpl-blockage',
    type: 'blockage',
    title: 'Curb Grate Blockage Alert',
    message: 'URGENT: Culvert grate blockage detected at {location}. Surface coverage: {occlusion_ratio}%. Immediate clearance required.',
  },
  {
    id: 'tmpl-warning',
    type: 'warning',
    title: 'Rising Water Inflow Warning',
    message: 'ADVISORY: Heavy inflow approaching {location} at {time}. Monitor drainage channels.',
  },
  {
    id: 'tmpl-critical',
    type: 'critical',
    title: 'Critical Overflow Risk',
    message: 'CRITICAL: Severe obstruction at {location}. Flood threshold reached. Deploy response team immediately.',
  },
  {
    id: 'tmpl-announcement',
    type: 'announcement',
    title: 'General DRRMO Advisory',
    message: 'COMMUNITY ADVISORY: Drainage maintenance scheduled for {location} on {time}. Keep grates clear.',
  },
];

const DEFAULT_LOGS: NotificationLog[] = [
  {
    id: 'log-01',
    type: 'blockage',
    title: 'Curb Grate Blockage Alert',
    message: 'URGENT: Culvert grate blockage detected at Brgy. San Jose, Rizal Ave cor. Mabini St.. Surface coverage: 78.4%. Immediate clearance required.',
    target_group_id: 'grp-poblacion',
    target_group_name: 'Barangay Poblacion QRT',
    recipient_count: 2,
    status: 'DISPATCHED',
    created_at: '2026-10-09 14:50:11',
  },
  {
    id: 'log-02',
    type: 'warning',
    title: 'Rising Water Inflow Warning',
    message: 'ADVISORY: Heavy inflow approaching Brgy. Taft Central at 13:25:00. Monitor drainage channels.',
    target_group_id: 'grp-drainage',
    target_group_name: 'Drainage Maintenance Unit',
    recipient_count: 2,
    status: 'DISPATCHED',
    created_at: '2026-10-09 13:25:00',
  },
];

function getStoredOr<T>(key: string, fallback: T[]): T[] {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return fallback;
}

function setStored<T>(key: string, data: T[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export async function fetchResponders(): Promise<Responder[]> {
  try {
    const res = await fetch(`${API_BASE}/responders`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.responders)) return data.responders;
    }
  } catch (err) {
    console.warn('[API] Could not fetch responders from backend, using offline cache:', err);
  }
  return getStoredOr('agos_responders', DEFAULT_RESPONDERS);
}

export async function createResponder(payload: Partial<Responder>): Promise<Responder> {
  try {
    const res = await fetch(`${API_BASE}/responders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not save responder on backend, persisting locally:', err);
  }

  const items = getStoredOr('agos_responders', DEFAULT_RESPONDERS);
  const newResp: Responder = {
    id: `resp-${Date.now().toString(36)}`,
    first_name: payload.first_name || '',
    last_name: payload.last_name || '',
    phone_number: payload.phone_number || '',
    status: payload.status || 'active',
    location: payload.location || '',
    notif_preferences: payload.notif_preferences || { warning: true, critical: true, blockage: true, announcement: true },
    group_ids: payload.group_ids || [],
    created_at: new Date().toISOString(),
  };
  const updated = [newResp, ...items];
  setStored('agos_responders', updated);
  return newResp;
}

export async function updateResponder(id: string, payload: Partial<Responder>): Promise<Responder> {
  try {
    const res = await fetch(`${API_BASE}/responders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not update responder on backend, saving locally:', err);
  }

  const items = getStoredOr('agos_responders', DEFAULT_RESPONDERS);
  const updated = items.map((r) => (r.id === id ? { ...r, ...payload } : r));
  setStored('agos_responders', updated);
  const found = updated.find((r) => r.id === id);
  return found || (payload as Responder);
}

export async function deleteResponder(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/responders/${id}`, {
      method: 'DELETE',
    });
    if (res.ok) return true;
  } catch (err) {
    console.warn('[API] Could not delete responder on backend, updating locally:', err);
  }

  const items = getStoredOr('agos_responders', DEFAULT_RESPONDERS);
  setStored('agos_responders', items.filter((r) => r.id !== id));
  return true;
}

export async function fetchResponderGroups(): Promise<ResponderGroup[]> {
  try {
    const res = await fetch(`${API_BASE}/responder-groups`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.groups)) return data.groups;
    }
  } catch (err) {
    console.warn('[API] Could not fetch responder groups from backend, using offline cache:', err);
  }
  return getStoredOr('agos_responder_groups', DEFAULT_RESPONDER_GROUPS);
}

export async function createResponderGroup(payload: Partial<ResponderGroup>): Promise<ResponderGroup> {
  try {
    const res = await fetch(`${API_BASE}/responder-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not create responder group on backend, saving locally:', err);
  }

  const items = getStoredOr('agos_responder_groups', DEFAULT_RESPONDER_GROUPS);
  const newGroup: ResponderGroup = {
    id: `grp-${Date.now().toString(36)}`,
    name: payload.name || 'New Responder Group',
    description: payload.description || '',
    member_count: payload.member_ids?.length || 0,
    member_ids: payload.member_ids || [],
    created_at: new Date().toISOString(),
  };
  setStored('agos_responder_groups', [...items, newGroup]);
  return newGroup;
}

export async function updateResponderGroup(id: string, payload: Partial<ResponderGroup>): Promise<ResponderGroup> {
  try {
    const res = await fetch(`${API_BASE}/responder-groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not update responder group on backend, saving locally:', err);
  }

  const items = getStoredOr('agos_responder_groups', DEFAULT_RESPONDER_GROUPS);
  const updated = items.map((g) => (g.id === id ? { ...g, ...payload } : g));
  setStored('agos_responder_groups', updated);
  return updated.find((g) => g.id === id) || (payload as ResponderGroup);
}

export async function deleteResponderGroup(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/responder-groups/${id}`, {
      method: 'DELETE',
    });
    if (res.ok) return true;
  } catch (err) {
    console.warn('[API] Could not delete responder group on backend, updating locally:', err);
  }

  const items = getStoredOr('agos_responder_groups', DEFAULT_RESPONDER_GROUPS);
  setStored('agos_responder_groups', items.filter((g) => g.id !== id));
  return true;
}

export async function fetchNotificationTemplates(): Promise<NotificationTemplate[]> {
  try {
    const res = await fetch(`${API_BASE}/notification-templates`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.templates)) return data.templates;
    }
  } catch (err) {
    console.warn('[API] Could not fetch templates from backend, using offline cache:', err);
  }
  return getStoredOr('agos_notification_templates', DEFAULT_TEMPLATES);
}

export async function createNotificationTemplate(payload: Partial<NotificationTemplate>): Promise<NotificationTemplate> {
  try {
    const res = await fetch(`${API_BASE}/notification-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not create template on backend, saving locally:', err);
  }

  const items = getStoredOr('agos_notification_templates', DEFAULT_TEMPLATES);
  const newTmpl: NotificationTemplate = {
    id: `tmpl-${Date.now().toString(36)}`,
    type: payload.type || 'announcement',
    title: payload.title || 'Untitled Advisory',
    message: payload.message || '',
    created_at: new Date().toISOString(),
  };
  setStored('agos_notification_templates', [...items, newTmpl]);
  return newTmpl;
}

export async function updateNotificationTemplate(id: string, payload: Partial<NotificationTemplate>): Promise<NotificationTemplate> {
  try {
    const res = await fetch(`${API_BASE}/notification-templates/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not update template on backend, saving locally:', err);
  }

  const items = getStoredOr('agos_notification_templates', DEFAULT_TEMPLATES);
  const updated = items.map((t) => (t.id === id ? { ...t, ...payload } : t));
  setStored('agos_notification_templates', updated);
  return updated.find((t) => t.id === id) || (payload as NotificationTemplate);
}

export async function deleteNotificationTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/notification-templates/${id}`, {
      method: 'DELETE',
    });
    if (res.ok) return true;
  } catch (err) {
    console.warn('[API] Could not delete template on backend, updating locally:', err);
  }

  const items = getStoredOr('agos_notification_templates', DEFAULT_TEMPLATES);
  setStored('agos_notification_templates', items.filter((t) => t.id !== id));
  return true;
}

export async function sendAnnouncement(
  payload: AnnouncementPayload
): Promise<{ success: boolean; dispatch_id?: string; recipient_count?: number }> {
  try {
    const res = await fetch(`${API_BASE}/notifications/announce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[API] Could not send announcement to backend, recording locally:', err);
  }

  // Local dispatch recording
  const groups = getStoredOr<ResponderGroup>('agos_responder_groups', DEFAULT_RESPONDER_GROUPS);
  const targetGroup = groups.find((g) => g.id === payload.target_group_id);
  const recipientCount = targetGroup?.member_count ?? 4;
  const dispatchId = `disp-${Date.now().toString(36)}`;

  const logs = getStoredOr<NotificationLog>('agos_notification_logs', DEFAULT_LOGS);
  const newLog: NotificationLog = {
    id: dispatchId,
    type: payload.type || 'announcement',
    title: payload.title,
    message: payload.message,
    target_group_id: payload.target_group_id,
    target_group_name: targetGroup?.name || 'All Registered Responders',
    recipient_count: recipientCount,
    status: 'DISPATCHED',
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
  setStored('agos_notification_logs', [newLog, ...logs]);

  return { success: true, dispatch_id: dispatchId, recipient_count: recipientCount };
}

export async function fetchNotificationLogs(): Promise<NotificationLog[]> {
  try {
    const res = await fetch(`${API_BASE}/notification-logs`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.logs)) return data.logs;
    }
  } catch (err) {
    console.warn('[API] Could not fetch notification logs from backend, using offline cache:', err);
  }
  return getStoredOr('agos_notification_logs', DEFAULT_LOGS);
}
