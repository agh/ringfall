import type { GameEvent } from '../core/game';
import { runPlaytest } from '../core/playtest';
import {
  buildChoir,
  CHOIR,
  type ChargeHum,
  chargeSeconds,
  kick,
  makeLimiter,
  SNARE,
  scheduleVoices,
  soundFor,
  startChargeHum,
} from './sounds';

/**
 * Renders the score for a seeded bot run without real time: the deterministic simulation is
 * re-run headlessly to recover the event timeline, then every sound is scheduled into an
 * OfflineAudioContext and rendered to a WAV. Used by scripts/record-demo.mjs to give the
 * silent frame capture its soundtrack. The voices are the live bank's, from sounds.ts; only
 * the scheduling differs, because the live Music class relies on wall-clock timers that an
 * offline context does not have.
 */
export interface ScoreOptions {
  readonly seed: number;
  /** Seconds of gameplay to render. */
  readonly seconds: number;
  /** Silence (or title drone only) before the game starts, matching title frames in the film. */
  readonly leadIn: number;
  readonly sampleRate?: number;
}

/**
 * Gain of the effects bus in the score. The live bank plays the same voices through a 0.35
 * master; the score mixes them under a choir and through a reverb, so they sit lower.
 *
 * The voices are shared; the mix is not. The score also differs from the live bank in its
 * master (0.8 against the live 0.35 effects and 0.5 music buses), its reverb (a 4 s room at 0.5
 * wet with no dry gain, against the live 4.5 s room at 0.9 wet over a 0.35 dry), its choir
 * level (0.22 against 0.32 to 0.5 by state), its pulse bus (0.7 against 0.9 in combat), and the
 * beat (one kick per half second against the live quarter-beat scheduler). Moving the mix into
 * sounds.ts as data is A4 in #51 and still open; until then the film is its own mix.
 */
export const OFFLINE_SFX_GAIN = 0.4;

interface TimedEvent {
  readonly time: number;
  readonly event: GameEvent;
}

const makeImpulse = (ctx: BaseAudioContext, seconds: number): AudioBuffer => {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      data[i] = (Math.random() * 2 - 1) * (1 - Math.exp(-i / 400)) * (1 - t) ** 2.2;
    }
  }
  return buffer;
};

const encodeWav = (buffer: AudioBuffer): ArrayBuffer => {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const out = new ArrayBuffer(bytes);
  const view = new DataView(out);
  const write = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  let offset = 44;
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, data[c]?.[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
};

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** Recovers the event timeline for a seed by re-running the same deterministic bot game. */
const collectEvents = (seed: number, seconds: number): TimedEvent[] => {
  const timeline: TimedEvent[] = [];
  runPlaytest({
    seed,
    maxSeconds: seconds,
    onStep: (state) => {
      for (const event of state.events) timeline.push({ time: state.time, event });
    },
  });
  return timeline;
};

/** Spans of play with a wave active, when the combat pulse plays. */
const combatWindows = (events: readonly TimedEvent[], end: number): Array<[number, number]> => {
  const windows: Array<[number, number]> = [];
  let from: number | null = null;
  for (const { time, event } of events) {
    if (event.type === 'waveStarted') from = time;
    const over =
      event.type === 'waveCleared' || event.type === 'playerDied' || event.type === 'victory';
    if (over && from !== null) {
      windows.push([from, time]);
      from = null;
    }
  }
  if (from !== null) windows.push([from, end]);
  return windows;
};

export const renderScore = async (options: ScoreOptions): Promise<string> => {
  const sampleRate = options.sampleRate ?? 48000;
  const total = options.leadIn + options.seconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
  // The same brick-wall limiter as the live bank closes the score.
  const limiter = makeLimiter(ctx);
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 4);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  master.connect(limiter);
  master.connect(reverb).connect(wet).connect(limiter);

  // Choir drone through two drifting formants, present for the whole film.
  const choir = buildChoir(ctx, master, total);
  choir.bus.gain.setValueAtTime(0, 0);
  choir.bus.gain.linearRampToValueAtTime(0.22, 3);
  for (let t = 0; t < total; t += 0.5) choir.setVowel(t * CHOIR.vowelRate, t);

  const sfx = ctx.createGain();
  sfx.gain.value = OFFLINE_SFX_GAIN;
  sfx.connect(master);
  // Lower than the live pulse bus (0.9): the score's kick lands every half beat under a reverb.
  const pulse = ctx.createGain();
  pulse.gain.value = 0.7;
  pulse.connect(master);

  // Combat pulse: a kick on beats and a snare on the backbeat while a wave is active.
  const events = collectEvents(options.seed, options.seconds);
  for (const [from, to] of combatWindows(events, options.seconds)) {
    for (let beat = 0, t = from; t < to; beat += 1, t += 0.5) {
      const at = options.leadIn + t;
      scheduleVoices(ctx, pulse, at, [kick(62, 0.9)]);
      if (beat % 2 === 1) scheduleVoices(ctx, pulse, at + 0.25, [SNARE]);
    }
  }

  // Every one-shot sound, in timeline order; the charge hum spans a start and its release.
  let charge: ChargeHum | null = null;
  const cutCharge = (at: number): void => {
    charge?.stop(at);
    charge = null;
  };
  for (const { time, event } of events) {
    const at = options.leadIn + time;
    const sound = soundFor(event);
    if (!sound) continue;
    if (sound.cutsCharge) cutCharge(at);
    if (event.type === 'chargeStarted') {
      cutCharge(at);
      charge = startChargeHum(ctx, sfx, at, chargeSeconds(event.kind));
    }
    scheduleVoices(ctx, sfx, at, sound.voices);
  }
  // A charge still held when the film ends keeps humming to the end.
  cutCharge(total);

  const rendered = await ctx.startRendering();
  return toBase64(encodeWav(rendered));
};
