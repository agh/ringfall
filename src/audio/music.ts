import { buildChoir, CHOIR, type Choir, kick, SNARE, scheduleVoices } from './sounds';

/**
 * Live procedural score. A sacred-register choir drone (additive sines through vowel formants
 * into a synthesised cathedral reverb) carries the title and the lulls; a low pulse and
 * percussion join during combat. The voices and formants come from sounds.ts, shared with the
 * offline score; this class owns the wall-clock scheduling and the state ramps.
 */
export type MusicState = 'title' | 'calm' | 'combat' | 'silent';

/** Seconds between beats, and between scheduler ticks: a quarter beat at 120 bpm. */
export const TICK = 0.25;
/**
 * How far ahead of the audio clock beats are placed. Two timer ticks, so a tick a whole tick late
 * (a busy main thread, a shader compile, a GC pause) never leaves a hole in the pulse: at 0.3 s
 * the margin was 50 ms, and any hitch past it dropped a beat and shifted the grid. Not more, so
 * a change of state reaches the beat within two ticks.
 */
export const LOOKAHEAD = 0.5;
/** Seconds after a stall before the first beat, so it is never scheduled in the past. */
const RESYNC_GAP = 0.05;

/**
 * Beat times due between a cursor on the audio clock and `now + lookahead`, and the cursor
 * after them. Beats sit at exact multiples of `tick` from one another, whatever the timer
 * does; a cursor behind `now` (the context was suspended, or the tab throttled) restarts
 * just ahead of the clock instead of catching up, so nothing piles up at one instant.
 */
export const beatsDue = (
  cursor: number,
  now: number,
  lookahead = LOOKAHEAD,
  tick = TICK,
): { readonly times: readonly number[]; readonly cursor: number } => {
  let next = cursor < now ? now + RESYNC_GAP : cursor;
  const times: number[] = [];
  while (next < now + lookahead) {
    times.push(next);
    next += tick;
  }
  return { times, cursor: next };
};

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
  /** Audio-clock time of the next beat to place; 0 forces a resync. */
  private nextBeatAt = 0;
  private timer: number | null = null;

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

    this.timer = window.setInterval(() => this.schedule(), TICK * 1000);
  }

  /**
   * Ends the score for good: the timer stops, every drone oscillator stops, and the buses are
   * cut. `silent` only ramps the master to zero and keeps 36 oscillators running; this is for
   * leaving the page.
   */
  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    if (ctx) {
      this.choir?.stop(ctx.currentTime);
      this.master?.disconnect();
    }
    this.ctx = null;
    this.master = null;
    this.choir = null;
    this.pulseBus = null;
    this.state = 'silent';
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
    // A suspended context (an iOS interruption, a hidden tab, record mode without a gesture)
    // has a frozen clock: anything placed against it stacks at one instant and fires as a burst
    // on resume. Nothing is placed until it runs again, and the beat cursor resyncs then.
    if (ctx.state !== 'running') {
      this.nextBeatAt = 0;
      return;
    }
    const now = ctx.currentTime;
    // Slow vowel drift gives the drone its breath.
    this.vowelPhase += CHOIR.vowelRate * TICK;
    this.choir.setVowel(this.vowelPhase, now);

    if (this.state !== 'combat' && this.state !== 'calm') {
      this.nextBeatAt = 0;
      return;
    }
    // Beats ride the audio clock, not the timer: the timer only decides how many are placed.
    const due = beatsDue(this.nextBeatAt, now);
    this.nextBeatAt = due.cursor;
    for (const at of due.times) {
      this.beat += 1;
      this.placeBeat(ctx, this.pulseBus, at);
    }
  }

  private placeBeat(ctx: AudioContext, bus: GainNode, at: number): void {
    const quarter = this.beat % 4;
    if (this.state === 'combat' && (quarter === 0 || quarter === 2)) {
      scheduleVoices(ctx, bus, at, [kick(62, 0.9)]);
    }
    if (this.state === 'combat' && quarter === 2) scheduleVoices(ctx, bus, at + 0.25, [SNARE]);
    if (this.state === 'calm' && this.beat % 16 === 0)
      scheduleVoices(ctx, bus, at, [kick(48, 0.6)]);
  }
}
