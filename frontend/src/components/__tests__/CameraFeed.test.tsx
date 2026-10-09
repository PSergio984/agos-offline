import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { CameraFeed } from '../CameraFeed';

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWebSocket.last = this;
  }
  send = vi.fn();
  close = vi.fn();
}

describe('CameraFeed envelope guard', () => {
  const originalWs = globalThis.WebSocket;

  beforeEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    globalThis.WebSocket = originalWs;
    vi.restoreAllMocks();
  });

  it('ignores typed envelopes so they cannot reset live telemetry', async () => {
    const onTelemetryUpdate = vi.fn();
    render(<CameraFeed roi={[0.2, 0.4, 0.8, 0.9]} onTelemetryUpdate={onTelemetryUpdate} />);
    const ws = FakeWebSocket.last!;

    await act(async () => {
      await ws.onmessage!({ data: JSON.stringify({ type: 'stream_tick', status: 'CRITICAL', occlusion_ratio: 80 }) });
    });
    expect(onTelemetryUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await ws.onmessage!({ data: JSON.stringify({ type: 'model_status', data: { loaded: true } }) });
    });
    expect(onTelemetryUpdate).toHaveBeenCalledTimes(1);
  });
});
