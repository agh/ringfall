import { buildChoir, CHOIR, type Choir, kick, SNARE, scheduleVoices } from './sounds';

/**
 * Live procedural score. A sacred-register choir drone (additive sines through vowel formants
 * into a synthesised cathedral reverb) carries the title and the lulls; a low pulse and
 * percussion join during combat. The voices and formants come from sounds.ts, shared with the
 * offline score; this class owns the wall-clock scheduling and the state ramps.
 */
export type MusicState = 'title' | 'calm' | 'combat' | 'silent';

/** Seconds between scheduler ticks: a quarter beat at 120 bpm. */
const TICK = 0.25;

const makeImpulse = (ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer => {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      // Decaying noise with a short fade-in: Moorer's classic synthetic room.
      data[i] = (Math.random() * 2 - 1) * (1 - Math.exp(-i / 400)) * (1 - t) ** decay;
    }
  }
  return buffer;
};

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private choir: Choir | null = null;
  private pulseBus: GainNode | null = null;
  private state: MusicState = 'silent';
  private beat = 0;
  private vowelPhase = 0;

  /** Call from a user gesture. Idempotent. */
  start(ctx: AudioContext, destination: AudioNode): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 4.5, 2.2);
    const dry = ctx.createGain();
    dry.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.master.connect(dry).connect(destination);
    this.master.connect(reverb).connect(wet).connect(destination);

    this.choir = buildChoir(ctx, this.master);

    this.pulseBus = ctx.createGain();
    this.pulseBus.gain.value = 0;
    this.pulseBus.connect(this.master);

    window.setInterval(() => this.schedule(), TICK * 1000);
  }

  setState(state: MusicState): void {
    if (state === this.state || !this.ctx || !this.master || !this.choir || !this.pulseBus) {
      this.state = state;
      return;
    }
    const now = this.ctx.currentTime;
    const ramp = (param: AudioParam, value: number, seconds: number): void => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + seconds);
    };
    switch (state) {
      case 'title':
        ramp(this.master.gain, 0.9, 2.5);
        ramp(this.choir.bus.gain, 0.5, 4);
        ramp(this.pulseBus.gain, 0, 2);
        break;
      case 'calm':
        ramp(this.master.gain, 0.7, 1.5);
        ramp(this.choir.bus.gain, 0.32, 3);
        ramp(this.pulseBus.gain, 0.25, 4);
        break;
      case 'combat':
        ramp(this.master.gain, 0.85, 1.2);
        ramp(this.choir.bus.gain, 0.22, 2);
        ramp(this.pulseBus.gain, 0.9, 1.5);
        break;
      case 'silent':
        ramp(this.master.gain, 0, 1.5);
        break;
    }
    this.state = state;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.pulseBus || !this.choir) return;
    // Slow vowel drift gives the drone its breath.
    this.vowelPhase += CHOIR.vowelRate * TICK;
    this.choir.setVowel(this.vowelPhase, ctx.currentTime);

    if (this.state !== 'combat' && this.state !== 'calm') return;
    this.beat += 1;
    const quarter = this.beat % 4;
    const at = ctx.currentTime + 0.05;
    const bus = this.pulseBus;
    if (this.state === 'combat' && (quarter === 0 || quarter === 2)) {
      scheduleVoices(ctx, bus, at, [kick(62, 0.9)]);
    }
    if (this.state === 'combat' && quarter === 2) scheduleVoices(ctx, bus, at + 0.25, [SNARE]);
    if (this.state === 'calm' && this.beat % 16 === 0)
      scheduleVoices(ctx, bus, at, [kick(48, 0.6)]);
  }
}
