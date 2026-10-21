import type { GameEvent } from '../core/game';
import { Music, type MusicState } from './music';
import {
  type ChargeHum,
  chargeSeconds,
  makeLimiter,
  scheduleVoices,
  soundFor,
  startChargeHum,
} from './sounds';

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
  /** Set by `playerDied`: the pulse stays down through the death window until the title card. */
  private dead = false;
  readonly music = new Music();

  constructor() {
    // The score has no end of its own (A5 in #51): leaving the page stops it, and a hidden tab
    // suspends the context so three dozen oscillators do not run under another window.
    window.addEventListener('pagehide', () => this.dispose());
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Must be called from a user gesture; browsers refuse to start audio otherwise. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    // Everything reaches the speakers through one limiter (sounds.ts, LIMITER).
    const limiter = makeLimiter(this.ctx);
    limiter.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(limiter);
    const musicBus = this.ctx.createGain();
    musicBus.gain.value = 0.5;
    musicBus.connect(limiter);
    this.music.start(this.ctx, musicBus);
  }

  setMusic(state: MusicState): void {
    // The death window is the sting's: the loop keeps asking for combat while the corpse
    // settles, and only the title card (or a new game after it) brings the score back.
    if (state === 'title') this.dead = false;
    else if (this.dead) return;
    this.music.setState(state);
  }

  /** Stops the score and closes the context; the bank is unusable afterwards. */
  dispose(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopCharge(ctx.currentTime);
    this.music.stop();
    this.ctx = null;
    this.master = null;
    void ctx.close();
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
      if (e.type === 'playerDied') {
        this.dead = true;
        this.music.setState('silent');
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
