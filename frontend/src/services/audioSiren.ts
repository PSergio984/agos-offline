/**
 * Web Audio API Emergency Siren Synthesizer for AGOS-Offline Console
 * Generates real-time pulsed warning and critical emergency alarm tones
 * with zero external audio assets.
 */

class AudioSirenSynthesizer {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isPlaying: boolean = false;
  private currentMode: 'CRITICAL' | 'WARNING' | null = null;
  private intervalId: number | null = null;
  private activeOscillator: OscillatorNode | null = null;
  private activeGain: GainNode | null = null;

  constructor() {
    // Lazily initialized on first user interaction
  }

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted) {
      this.stop();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public playCriticalSiren(): void {
    if (this.isMuted) return;
    if (this.isPlaying && this.currentMode === 'CRITICAL') return;

    this.stop();
    this.initContext();
    if (!this.ctx) return;

    this.isPlaying = true;
    this.currentMode = 'CRITICAL';

    // Emergency warble siren: Alternating 880Hz (A5) and 660Hz (E5) pulses
    let state = false;
    const playPulse = () => {
      if (!this.ctx || !this.isPlaying || this.isMuted) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(state ? 880 : 660, now);
      osc.frequency.exponentialRampToValueAtTime(state ? 920 : 620, now + 0.18);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.23);

      state = !state;
    };

    playPulse();
    this.intervalId = window.setInterval(playPulse, 240);
  }

  public playWarningChime(): void {
    if (this.isMuted) return;
    if (this.isPlaying && this.currentMode === 'WARNING') return;

    this.stop();
    this.initContext();
    if (!this.ctx) return;

    this.isPlaying = true;
    this.currentMode = 'WARNING';

    // Warning chime: Double beep every 4 seconds
    const playBeep = () => {
      if (!this.ctx || !this.isPlaying || this.isMuted) return;

      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Second beep
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.18); // A5
      gain2.gain.setValueAtTime(0.12, now + 0.18);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.18);
      osc2.stop(now + 0.35);
    };

    playBeep();
    this.intervalId = window.setInterval(playBeep, 4000);
  }

  public playRadioClick(): void {
    this.initContext();
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.setValueAtTime(800, now + 0.04);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public stop(): void {
    this.isPlaying = false;
    this.currentMode = null;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.activeOscillator) {
      try {
        this.activeOscillator.stop();
        this.activeOscillator.disconnect();
      } catch {
        // ignore
      }
      this.activeOscillator = null;
    }
    if (this.activeGain) {
      try {
        this.activeGain.disconnect();
      } catch {
        // ignore
      }
      this.activeGain = null;
    }
  }
}

export const sirenSynthesizer = new AudioSirenSynthesizer();
