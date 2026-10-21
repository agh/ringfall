import type { GameEvent } from '../core/game';
import { WEAPON_SPECS, type WeaponKind } from '../core/weapon';
import { Music, type MusicState } from './music';

/** Hz the beam charge hum starts and ends at; it rises over the spec's charge time. */
export const CHARGE_HUM_FROM = 120;
export const CHARGE_HUM_TO = 900;
/** Live-only pitch jitter so a magazine does not sound like one looped sample. */
const PITCH_JITTER = 0.03;
/** D5, F5, A5: the pickup arpeggio sits in the score's D minor. */
const PICKUP_ARPEGGIO = [587.33, 698.46, 880];
/** A5 then E6: the pickup spawn chime. */
const SPAWN_CHIME = [880, 1318.51];

/** Tiny procedural sound bank built on WebAudio oscillators: no assets to load or license. */
export class AudioBank {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private charge: { osc: OscillatorNode; env: GainNode } | null = null;
  readonly music = new Music();

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
    const musicBus = this.ctx.createGain();
    musicBus.gain.value = 0.5;
    musicBus.connect(this.ctx.destination);
    this.music.start(this.ctx, musicBus);
  }

  setMusic(state: MusicState): void {
    this.music.setState(state);
  }

  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          this.shot(e.kind, e.hitEnemy);
          break;
        case 'empty':
          this.blip(240, 0.08, 'square', 0.25);
          break;
        case 'reload':
          this.blip(500, 0.12, 'triangle', 0.3);
          break;
        case 'chargeStarted':
          this.startCharge(e.kind);
          break;
        case 'chargeReleased':
          this.stopCharge();
          break;
        case 'beamFired':
          this.beam();
          break;
        case 'launcherFired':
          this.launcher();
          break;
        case 'weaponSwapped':
          this.stopCharge();
          this.swapClick();
          break;
        case 'pickupSpawned':
          this.chime(SPAWN_CHIME, 0.18, 0.12, 0.18);
          break;
        case 'pickupTaken':
          this.stopCharge();
          this.chime(PICKUP_ARPEGGIO, 0.14, 0.09, 0.26);
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
          this.stopCharge();
          this.sweep(500, 60, 1.4, 'sawtooth', 0.6);
          break;
      }
    }
  }

  /** One voice per kind; the beam's own shot is silent because `beamFired` carries it. */
  private shot(kind: WeaponKind, hitEnemy: boolean): void {
    const j = this.jitter();
    switch (kind) {
      case 'rifle':
        this.blip((hitEnemy ? 1400 : 900) * j, 0.05, 'square', 0.35);
        this.noise(0.06, 0.4);
        break;
      case 'laser':
        this.sweep(2600 * j, 1900 * j, 0.09, 'sine', 0.45);
        this.blip(5200 * j, 0.02, 'sine', 0.12);
        break;
      case 'scatter':
        this.noise(0.2, 0.9, 3200);
        this.sweep(110 * j, 42, 0.28, 'sine', 0.9);
        break;
      case 'minigun':
        this.blip(1900 * j, 0.018, 'square', 0.22);
        this.noise(0.035, 0.3, 2600);
        break;
      case 'beam':
      case 'launcher':
        break;
    }
  }

  /** A sine that climbs from 120 Hz to 900 Hz over the charge; `stopCharge` cuts it. */
  private startCharge(kind: WeaponKind): void {
    if (!this.ctx || !this.master) return;
    this.stopCharge();
    const now = this.ctx.currentTime;
    const duration = WEAPON_SPECS[kind].chargeTime || 0.8;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(CHARGE_HUM_FROM, now);
    osc.frequency.exponentialRampToValueAtTime(CHARGE_HUM_TO, now + duration);
    env.gain.setValueAtTime(0.001, now);
    env.gain.exponentialRampToValueAtTime(0.4, now + duration);
    osc.connect(env).connect(this.master);
    osc.start(now);
    this.charge = { osc, env };
  }

  private stopCharge(): void {
    if (!this.ctx || !this.charge) return;
    const now = this.ctx.currentTime;
    const { osc, env } = this.charge;
    env.gain.cancelScheduledValues(now);
    env.gain.setValueAtTime(Math.max(0.001, env.gain.value), now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.stop(now + 0.05);
    this.charge = null;
  }

  /** Crack plus a long low sweep. */
  private beam(): void {
    const j = this.jitter();
    this.noise(0.05, 1, 7000);
    this.sweep(320 * j, 55, 0.45, 'sine', 0.8);
    this.sweep(1800 * j, 400, 0.12, 'sawtooth', 0.2);
  }

  /** Hollow thump. */
  private launcher(): void {
    const j = this.jitter();
    this.sweep(170 * j, 48, 0.3, 'triangle', 0.8);
    this.noise(0.12, 0.5, 500);
  }

  /** Two quick clicks: a bolt drawn and let home. */
  private swapClick(): void {
    this.blip(900, 0.03, 'square', 0.25);
    this.noise(0.04, 0.35, 2200);
    this.blip(620, 0.03, 'square', 0.25, 0.07);
    this.noise(0.04, 0.3, 1800, 0.07);
  }

  /** Notes played `gap` seconds apart, each `length` long. */
  private chime(notes: readonly number[], length: number, gap: number, gain: number): void {
    notes.forEach((hz, i) => {
      this.sweep(hz, hz, length, 'triangle', gain, i * gap);
      this.sweep(hz * 2, hz * 2, length * 0.6, 'sine', gain * 0.3, i * gap);
    });
  }

  private jitter(): number {
    return 1 + (Math.random() - 0.5) * 2 * PITCH_JITTER;
  }

  private blip(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    this.sweep(freq, freq, duration, type, gain, delay);
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime + delay;
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

  private noise(duration: number, gain: number, cutoff = 1200, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime + delay;
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
    filter.frequency.value = cutoff;
    source.connect(filter).connect(env).connect(this.master);
    source.start(now);
  }
}
