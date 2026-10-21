import type { GameEvent } from '../core/game';
import { Music, type MusicState } from './music';
import { type ChargeHum, chargeSeconds, scheduleVoices, soundFor, startChargeHum } from './sounds';

/** Live-only pitch jitter so a magazine does not sound like one looped sample. */
const PITCH_JITTER = 0.03;

/**
 * Tiny procedural sound bank built on WebAudio oscillators: no assets to load or license.
 * Every voice comes from the table in sounds.ts; this class only owns the context, the buses,
 * and the one stateful sound, the charge hum.
 */
export class AudioBank {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private charge: ChargeHum | null = null;
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

  /**
   * Cuts every held voice. The overlay freezes the simulation, so the chargeReleased that
   * would end a held beam charge never arrives; without this the hum plays over the title.
   */
  silence(): void {
    if (!this.ctx) return;
    this.stopCharge(this.ctx.currentTime);
  }

  handle(events: readonly GameEvent[]): void {
    if (!this.ctx || !this.master) return;
    for (const e of events) {
      const sound = soundFor(e);
      if (!sound) continue;
      const now = this.ctx.currentTime;
      if (sound.cutsCharge) this.stopCharge(now);
      if (e.type === 'chargeStarted') {
        this.stopCharge(now);
        this.charge = startChargeHum(this.ctx, this.master, now, chargeSeconds(e.kind));
      }
      scheduleVoices(this.ctx, this.master, now, sound.voices, this.jitter());
    }
  }

  private stopCharge(now: number): void {
    this.charge?.stop(now);
    this.charge = null;
  }

  private jitter(): number {
    return 1 + (Math.random() - 0.5) * 2 * PITCH_JITTER;
  }
}
