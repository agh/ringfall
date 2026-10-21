import type { GameEvent } from '../core/game';

/** Tiny procedural sound bank built on WebAudio oscillators: no assets to load or license. */
export class AudioBank {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Must be called from a user gesture; browsers refuse to start audio otherwise. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.blip(e.hitEnemy ? 1400 : 900, 0.05, 'square', 0.35);
          this.noise(0.06, 0.4);
          break;
        case 'empty':
          this.blip(240, 0.08, 'square', 0.25);
          break;
        case 'reload':
          this.blip(500, 0.12, 'triangle', 0.3);
          break;
        case 'enemyKilled':
          this.sweep(900, 200, 0.25, 'sawtooth', 0.4);
          break;
        case 'playerDamaged':
          this.blip(180, 0.1, 'sawtooth', 0.5);
          break;
        case 'shieldBroken':
          this.sweep(1200, 300, 0.5, 'sine', 0.6);
          break;
        case 'explosion':
          this.noise(0.6, 1);
          this.sweep(120, 40, 0.6, 'sine', 0.8);
          break;
        case 'boltFired':
          this.sweep(700, 350, 0.2, 'sine', 0.2);
          break;
        case 'grenadeThrown':
          this.blip(400, 0.05, 'triangle', 0.2);
          break;
        case 'waveStarted':
          this.sweep(300, 600, 0.6, 'triangle', 0.4);
          break;
        case 'waveCleared':
        case 'victory':
          this.sweep(400, 1000, 0.8, 'sine', 0.5);
          break;
        case 'playerDied':
          this.sweep(500, 60, 1.4, 'sawtooth', 0.6);
          break;
      }
    }
  }

  private blip(freq: number, duration: number, type: OscillatorType, gain: number): void {
    this.sweep(freq, freq, duration, type, gain);
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    gain: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(env).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private noise(duration: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    source.connect(filter).connect(env).connect(this.master);
    source.start(now);
  }
}
