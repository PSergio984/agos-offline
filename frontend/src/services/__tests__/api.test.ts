import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  saveROI,
  loadROI,
  switchStream,
  fetchIncidents,
  resolveIncident,
  fetchWeather,
  fetchSyncStatus,
  describeModelChip,
} from '../api';
import { ROI, StreamSource } from '../../types';

describe('API Service - Offline First Fallbacks', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('ROI Management', () => {
    it('loadROI returns backend ROI when fetch succeeds', async () => {
      const mockROI: ROI = [0.1, 0.2, 0.8, 0.9];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ roi: mockROI }),
      });

      const result = await loadROI('cam-default');
      expect(result).toEqual(mockROI);
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/cameras/cam-default/roi');
    });

    it('loadROI falls back to localStorage when fetch fails', async () => {
      const cachedROI: ROI = [0.25, 0.35, 0.75, 0.85];
      localStorage.setItem('agos_roi_cam-default', JSON.stringify(cachedROI));

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await loadROI('cam-default');
      expect(result).toEqual(cachedROI);
    });

    it('loadROI returns null when both fetch and localStorage are empty', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      const result = await loadROI('cam-missing');
      expect(result).toBeNull();
    });

    it('saveROI saves to localStorage if backend network fails', async () => {
      const newROI: ROI = [0.15, 0.3, 0.7, 0.85];
      global.fetch = vi.fn().mockRejectedValue(new Error('Failed to reach backend'));

      const response = await saveROI('cam-default', newROI);
      expect(response.success).toBe(true);
      expect(response.roi).toEqual(newROI);

      const stored = localStorage.getItem('agos_roi_cam-default');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(newROI);
    });
  });

  describe('Incidents API', () => {
    it('fetchIncidents returns backend incidents when available', async () => {
      const mockIncidents = [
        {
          id: 'INC-ONLINE-1',
          timestamp: '2026-10-09 15:00:00',
          camera_id: 'cam-01',
          camera_name: 'CAM-01',
          location: 'Bridge Inflow',
          occlusion_ratio: 80.0,
          status: 'CRITICAL BLOCKED',
          debris_types: ['Plastic'],
          action_taken: 'DISPATCHED',
          acknowledged: true,
        },
      ];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockIncidents,
      });

      const incidents = await fetchIncidents();
      expect(incidents).toEqual(mockIncidents);
      expect(incidents.length).toBe(1);
    });

    it('fetchIncidents returns fallback demo records during offline operations', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Server offline'));

      const incidents = await fetchIncidents();
      expect(Array.isArray(incidents)).toBe(true);
      expect(incidents.length).toBeGreaterThanOrEqual(1);
      expect(incidents[0].id).toBe('INC-2026-1008-01');
      expect(incidents[0].status).toBe('CRITICAL BLOCKED');
      expect(incidents[0].debris_types).toEqual([]);
      expect(incidents[0].debris_count).toBe(3);
    });

    it('resolveIncident returns true when backend resolves successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success' }),
      });

      const success = await resolveIncident('INC-101');
      expect(success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/incidents/INC-101/resolve', {
        method: 'POST',
      });
    });

    it('resolveIncident returns false gracefully when backend fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Backend error'));

      const success = await resolveIncident('INC-101');
      expect(success).toBe(false);
    });
  });

  describe('Weather and Sync Status', () => {
    it('fetchWeather returns offline fallback when network is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('No internet'));

      const weather = await fetchWeather();
      expect(weather.is_online).toBe(false);
      expect(weather.rainfall_mm).toBe(0.0);
      expect(weather.condition).toBe('Offline Mode');
    });

    it('fetchWeather returns online weather data when backend is reachable', async () => {
      const mockWeather = {
        is_online: true,
        rainfall_mm: 14.5,
        temperature_c: 29.0,
        humidity_pct: 85,
        condition: 'Heavy Monsoon Rain',
        message: 'PAGASA Yellow Rainfall Advisory',
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockWeather,
      });

      const weather = await fetchWeather();
      expect(weather.is_online).toBe(true);
      expect(weather.rainfall_mm).toBe(14.5);
    });

    it('fetchWeather passes rain_hazard through', async () => {
      const rain_hazard = { active: true, source: 'auto', threshold_mm: 15 };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ is_online: true, rainfall_mm: 20, condition: 'Heavy', message: 'x', rain_hazard }),
      });

      const weather = await fetchWeather();
      expect(weather.rain_hazard).toEqual(rain_hazard);
    });

    it('describeModelChip handles a missing model and flags demo input', () => {
      expect(describeModelChip(undefined)).toBeNull();
      expect(describeModelChip(null)).toBeNull();
      const chip = describeModelChip({
        loaded: true,
        weights_sha256: '9e08da0b06ff',
        model_version: 'legacy-unknown',
        input_source: 'demo',
        next_inference_in: 4.2,
      });
      expect(chip?.label).toContain('9e08da0b');
      expect(chip?.label).toContain('next scan 5s');
      expect(chip?.demo).toBe(true);
    });

    it('fetchSyncStatus returns LOCAL_OFFLINE fallback when endpoint unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Sync unreachable'));

      const sync = await fetchSyncStatus();
      expect(sync.is_online).toBe(false);
      expect(sync.status).toBe('LOCAL_OFFLINE');
      expect(sync.pending_count).toBe(0);
    });
  });

  describe('Stream Switching', () => {
    it('switchStream falls back to local success if server unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network drop'));
      const source: StreamSource = {
        type: 'synthetic',
        name: 'Demo Synthetic',
      };

      const res = await switchStream('cam-default', source);
      expect(res.success).toBe(true);
    });
  });
});
