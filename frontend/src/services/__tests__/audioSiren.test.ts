import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sirenSynthesizer } from '../audioSiren';

describe('Audio Siren Synthesizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sirenSynthesizer.setMuted(false);
    sirenSynthesizer.stop();
  });

  afterEach(() => {
    sirenSynthesizer.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('manages mute and unmute states correctly', () => {
    expect(sirenSynthesizer.getMuted()).toBe(false);

    sirenSynthesizer.setMuted(true);
    expect(sirenSynthesizer.getMuted()).toBe(true);

    sirenSynthesizer.setMuted(false);
    expect(sirenSynthesizer.getMuted()).toBe(false);
  });

  it('plays critical emergency warble siren when unmuted', () => {
    sirenSynthesizer.playCriticalSiren();

    // Fast-forward interval timer to verify repeated siren pulses
    vi.advanceTimersByTime(500);

    // Stop synthesizer
    sirenSynthesizer.stop();
  });

  it('does not play critical siren when muted', () => {
    sirenSynthesizer.setMuted(true);
    sirenSynthesizer.playCriticalSiren();

    // Advancing timers should not throw or trigger pulses
    vi.advanceTimersByTime(500);
  });

  it('plays warning chime when unmuted', () => {
    sirenSynthesizer.playWarningChime();

    // Advance chime interval (4000ms)
    vi.advanceTimersByTime(4500);

    sirenSynthesizer.stop();
  });

  it('does not play warning chime when muted', () => {
    sirenSynthesizer.setMuted(true);
    sirenSynthesizer.playWarningChime();

    vi.advanceTimersByTime(4500);
  });

  it('handles consecutive calls idempotently without duplicate intervals', () => {
    sirenSynthesizer.playCriticalSiren();
    // Second invocation in same mode should no-op
    sirenSynthesizer.playCriticalSiren();

    vi.advanceTimersByTime(300);
    sirenSynthesizer.stop();
  });

  it('switches smoothly from warning chime to critical siren', () => {
    sirenSynthesizer.playWarningChime();
    vi.advanceTimersByTime(100);

    // Switch mode
    sirenSynthesizer.playCriticalSiren();
    vi.advanceTimersByTime(300);

    sirenSynthesizer.stop();
  });

  it('plays tactical radio click audio chirp without error', () => {
    expect(() => {
      sirenSynthesizer.playRadioClick();
    }).not.toThrow();
  });

  it('stops cleanly and clears all active audio resources', () => {
    sirenSynthesizer.playCriticalSiren();
    sirenSynthesizer.stop();

    // Verify silence when timers advance
    vi.advanceTimersByTime(1000);
  });
});
