import '@testing-library/jest-dom';
import { vi } from 'vitest';

class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn().mockReturnThis();
  exponentialRampToValueAtTime = vi.fn().mockReturnThis();
  linearRampToValueAtTime = vi.fn().mockReturnThis();
}

class MockAudioNode {
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn().mockReturnThis();
}

class MockOscillatorNode extends MockAudioNode {
  type = 'sine';
  frequency = new MockAudioParam();
  start = vi.fn();
  stop = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = new MockAudioNode();

  createOscillator() {
    return new MockOscillatorNode();
  }

  createGain() {
    return new MockGainNode();
  }

  resume = vi.fn().mockResolvedValue(undefined);
  suspend = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

// Assign mock to window
window.AudioContext = MockAudioContext as unknown as typeof AudioContext;
(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext =
  MockAudioContext as unknown as typeof AudioContext;

// Mock HTMLCanvasElement.getContext('2d')
const mockCanvas2D = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  strokeRect: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  scale: vi.fn(),
  rotate: vi.fn(),
  translate: vi.fn(),
  canvas: { width: 1280, height: 720 },
};

HTMLCanvasElement.prototype.getContext = function (contextId: string, ..._args: unknown[]) {
  if (contextId === '2d') {
    return mockCanvas2D as unknown as CanvasRenderingContext2D;
  }
  return null;
} as unknown as typeof HTMLCanvasElement.prototype.getContext;
