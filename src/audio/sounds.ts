import type { GameEvent } from '../core/game';
import { WEAPON_SPECS, type WeaponKind } from '../core/weapon';

/**
 * The sound design as data. Every game sound is a list of voices (an oscillator sweep or a
 * filtered noise burst with a gain envelope) keyed by the `GameEvent` that triggers it. The live
 * bank (audio.ts) and the offline score (offline.ts) both schedule from this table through the
 * functions at the bottom, against a `BaseAudioContext`, so the two cannot drift apart except
 * for the live pitch jitter and the offline bus gain, both documented where they are applied.
 */
export interface ToneVoice {
  readonly kind: 'tone';
  readonly type: OscillatorType;
  /** Hz at onset. */
  readonly from: number;
  /** Hz reached after `sweep` seconds. Equal to `from` for a plain blip. */
  readonly to: number;
  /** Seconds the gain decays over; the voice ends when it reaches silence. */
  readonly duration: number;
  readonly gain: number;
  /** Seconds after the event before the voice starts. */
  readonly delay?: number;
  /** Seconds the frequency takes to reach `to`; defaults to `duration`. */
  readonly sweep?: number;
  /** Live playback scales this voice's pitch by the per-event jitter; the score does not. */
  readonly jitter?: boolean;
}

export interface NoiseVoice {
  readonly kind: 'noise';
  /** Seconds of white noise, faded linearly to silence over its length. */
  readonly duration: number;
  readonly gain: number;
  readonly filter: 'lowpass' | 'bandpass';
  /** Filter frequency in Hz. */
  readonly cutoff: number;
  /** Filter resonance; the WebAudio default when omitted. */
  readonly q?: number;
  readonly delay?: number;
}

export type Voice = ToneVoice | NoiseVoice;

export interface Sound {
  readonly voices: readonly Voice[];
  /** Ends a running charge hum before the voices play. */
  readonly cutsCharge?: boolean;
  /** Plays for the first event of its type in a step only; the rest of that step is silent. */
  readonly once?: boolean;
}

/** Events that make no sound on purpose; the unit test refuses any event missing from both lists. */
export const SILENT = [
  'pickupExpired',
  'enemyFled',
  // The hidden switch's seven-note chime is a follow-up; the score tick is the only reaction here.
  'secretFound',
  // The watcher's beam reuses the strider bolt sound: game.ts emits boltFired beside watcherFired.
  // A charge hum and a beam of its own are for the audio pass.
  'watcherCharging',
  'watcherFired',
] as const satisfies readonly GameEvent['type'][];
export type SilentEvent = (typeof SILENT)[number];

/** A shot's voice depends on the weapon, and the rifle's on whether it landed. */
export type ShotKey = `shot:${WeaponKind}` | 'shot:rifle:hit';
export type SoundKey = Exclude<GameEvent['type'], SilentEvent | 'shot'> | ShotKey;

const tone = (
  type: OscillatorType,
  from: number,
  to: number,
  duration: number,
  gain: number,
  extra: Partial<Omit<ToneVoice, 'kind' | 'type' | 'from' | 'to' | 'duration' | 'gain'>> = {},
): ToneVoice => ({ kind: 'tone', type, from, to, duration, gain, ...extra });

const blip = (
  type: OscillatorType,
  hz: number,
  duration: number,
  gain: number,
  extra: Partial<Omit<ToneVoice, 'kind' | 'type' | 'from' | 'to' | 'duration' | 'gain'>> = {},
): ToneVoice => tone(type, hz, hz, duration, gain, extra);

const noise = (
  duration: number,
  gain: number,
  cutoff: number,
  extra: Partial<Omit<NoiseVoice, 'kind' | 'duration' | 'gain' | 'cutoff'>> = {},
): NoiseVoice => ({ kind: 'noise', duration, gain, cutoff, filter: 'lowpass', ...extra });

/** Notes played `gap` seconds apart, each `length` long, with a quiet octave above each. */
const chime = (notes: readonly number[], length: number, gap: number, gain: number): Voice[] =>
  notes.flatMap((hz, i) => [
    blip('triangle', hz, length, gain, { delay: i * gap }),
    blip('sine', hz * 2, length * 0.6, gain * 0.3, { delay: i * gap }),
  ]);

/** D5, F5, A5: the pickup arpeggio sits in the score's D minor. */
const PICKUP_ARPEGGIO = [587.33, 698.46, 880];
/** A5 then E6: the pickup spawn chime. */
const SPAWN_CHIME = [880, 1318.51];

const JITTERED = { jitter: true } as const;

/** The beam's and the launcher's own shots are silent: `beamFired` and `launcherFired` carry them. */
export const SOUNDS: Readonly<Record<SoundKey, Sound>> = {
  'shot:rifle': {
    voices: [blip('square', 900, 0.05, 0.35, JITTERED), noise(0.06, 0.4, 1200)],
  },
  'shot:rifle:hit': {
    voices: [blip('square', 1400, 0.05, 0.35, JITTERED), noise(0.06, 0.4, 1200)],
  },
  'shot:laser': {
    voices: [
      tone('sine', 2600, 1900, 0.09, 0.45, JITTERED),
      blip('sine', 5200, 0.02, 0.12, JITTERED),
    ],
  },
  'shot:scatter': {
    voices: [noise(0.2, 0.9, 3200), tone('sine', 110, 42, 0.28, 0.9, JITTERED)],
  },
  'shot:minigun': {
    voices: [blip('square', 1900, 0.018, 0.22, JITTERED), noise(0.035, 0.3, 2600)],
  },
  'shot:beam': { voices: [] },
  'shot:launcher': { voices: [] },
  empty: { voices: [blip('square', 240, 0.08, 0.25)] },
  reload: { voices: [blip('triangle', 500, 0.12, 0.3)] },
  chargeStarted: { voices: [] },
  chargeReleased: { voices: [], cutsCharge: true },
  /** Crack plus a long low sweep. */
  beamFired: {
    voices: [
      noise(0.05, 1, 7000),
      tone('sine', 320, 55, 0.45, 0.8, JITTERED),
      tone('sawtooth', 1800, 400, 0.12, 0.2, JITTERED),
    ],
  },
  /** Hollow thump. */
  launcherFired: {
    voices: [tone('triangle', 170, 48, 0.3, 0.8, JITTERED), noise(0.12, 0.5, 500)],
  },
  /** Two quick clicks: a bolt drawn and let home. */
  weaponSwapped: {
    cutsCharge: true,
    voices: [
      blip('square', 900, 0.03, 0.25),
      noise(0.04, 0.35, 2200),
      blip('square', 620, 0.03, 0.25, { delay: 0.07 }),
      noise(0.04, 0.3, 1800, { delay: 0.07 }),
    ],
  },
  pickupSpawned: { voices: chime(SPAWN_CHIME, 0.18, 0.12, 0.18) },
  pickupTaken: { cutsCharge: true, voices: chime(PICKUP_ARPEGGIO, 0.14, 0.09, 0.26) },
  enemyKilled: { voices: [tone('sawtooth', 900, 200, 0.25, 0.4)] },
  playerDamaged: { voices: [blip('sawtooth', 180, 0.1, 0.5)] },
  shieldBroken: { voices: [tone('sine', 1200, 300, 0.5, 0.6)] },
  explosion: { voices: [noise(0.6, 1, 1200), tone('sine', 120, 40, 0.6, 0.8)] },
  boltFired: { voices: [tone('sine', 700, 350, 0.2, 0.2)] },
  grenadeThrown: { voices: [blip('triangle', 400, 0.05, 0.2)] },
  waveStarted: { voices: [tone('triangle', 300, 600, 0.6, 0.4)] },
  waveCleared: { voices: [tone('sine', 400, 1000, 0.8, 0.5)] },
  // The run ends with the trigger possibly still held: no chargeReleased will ever follow.
  victory: { cutsCharge: true, voices: [tone('sine', 400, 1000, 0.8, 0.5)] },
  playerDied: { cutsCharge: true, voices: [tone('sawtooth', 500, 60, 1.4, 0.6)] },
  // A routed skimmer's squeal: a rising chirp that answers the strider's death. The flee itself
  // (`enemyFled`) is silent; the bark carries the sound so a pack of three squeals three times.
  enemyBark: { voices: [tone('sine', 900, 1500, 0.14, 0.18, { jitter: true })] },
  /**
   * The dropship passing over: a low engine sweep that falls as it recedes, under a rumble.
   * Once per step: a wave's pods launch together from the one craft the renderer draws.
   */
  dropPod: {
    once: true,
    voices: [tone('sawtooth', 110, 38, 1.8, 0.22), noise(1.2, 0.28, 220, { q: 1.4 })],
  },
};

/** The table entry for an event, or null for an event in `SILENT`. */
export const soundFor = (event: GameEvent): Sound | null => {
  if (event.type === 'shot') {
    const key: ShotKey =
      event.kind === 'rifle' && event.hitEnemy ? 'shot:rifle:hit' : `shot:${event.kind}`;
    return SOUNDS[key];
  }
  if ((SILENT as readonly string[]).includes(event.type)) return null;
  return SOUNDS[event.type as Exclude<SoundKey, ShotKey>];
};

/**
 * `soundFor` over the events of a step: a sound marked `once` answers the first event of its
 * type in the step and null for the rest, so nine Last Stand pods make one engine sweep. The
 * live bank takes a fresh one per `handle` call; the score, which walks a whole timeline, passes
 * each event's simulation time as `step`, and a new value starts a new step.
 */
export const stepSounds = (): ((event: GameEvent, step?: number) => Sound | null) => {
  let current: number | undefined;
  let heard = new Set<GameEvent['type']>();
  return (event, step) => {
    if (step !== current) {
      current = step;
      heard = new Set();
    }
    const sound = soundFor(event);
    if (!sound?.once) return sound;
    if (heard.has(event.type)) return null;
    heard.add(event.type);
    return sound;
  };
};

/** The charge hum: a sine that climbs over the weapon's charge time until the release cuts it. */
export const CHARGE_HUM = {
  from: 120,
  to: 900,
  gain: 0.4,
  /** Seconds the hum takes to fade once released. */
  release: 0.03,
  /** Charge time for a weapon without one, so a stray event still makes a bounded sound. */
  fallbackSeconds: 0.8,
} as const;

/** Seconds the hum takes to peak for a weapon kind. */
export const chargeSeconds = (kind: WeaponKind): number =>
  WEAPON_SPECS[kind].chargeTime || CHARGE_HUM.fallbackSeconds;

/** Music data shared by the live score (music.ts) and the offline score (offline.ts). */
export const CHOIR = {
  /** D2 D3 A3 D4 F4 A4: D minor, open. */
  hz: [73.42, 146.83, 220, 293.66, 349.23, 440],
  /** Three detuned partial sets per voice give a section its width. */
  detuneCents: [-5, 0, 6],
  vibratoHz: 4.8,
  vibratoSpread: 1.4,
  /** Vibrato depth as a fraction of the voice's pitch. */
  vibratoDepth: 0.0035,
  /** Formant pairs in Hz: "ah", "oh", "oo". */
  formants: [
    [600, 1040],
    [400, 750],
    [300, 870],
  ],
  formantQ: [6, 8],
  formantMix: 1.4,
  bodyCutoff: 1800,
  /** Radians per second the vowel drifts, a slow breath. */
  vowelRate: 0.08,
} as const;

/** A kick: a sine that drops to `hz` in 120 ms and rings for 600 ms. */
export const kick = (hz: number, gain: number): ToneVoice =>
  tone('sine', hz * 2.2, hz, 0.6, gain, { sweep: 0.12 });

export const SNARE: NoiseVoice = noise(0.18, 0.5, 1500, { filter: 'bandpass', q: 0.7 });

/** Formant pair for a vowel phase in radians: drifts between "ah" and the other two vowels. */
export const vowelFormants = (phase: number): readonly [number, number] => {
  const blend = (Math.sin(phase) + 1) / 2;
  const [a0, b0] = CHOIR.formants[0];
  const [a1, b1] = CHOIR.formants[blend > 0.5 ? 1 : 2];
  const t = Math.abs(blend - 0.5) * 2;
  return [a0 + (a1 - a0) * t, b0 + (b1 - b0) * t];
};

/**
 * One noise buffer per length per context, filled on first use. Filling is synchronous main-thread
 * work (0.1 ms for a minigun round, 1.4 ms for an explosion, 2.2 ms for the drop pod's 1.2 s) and
 * a fresh buffer per voice allocated about 8 MB over a five-wave run, all of it inside the event
 * handler of a simulation step.
 */
const noiseBuffers = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

const noiseBuffer = (ctx: BaseAudioContext, seconds: number): AudioBuffer => {
  const length = Math.floor(ctx.sampleRate * seconds);
  let cache = noiseBuffers.get(ctx);
  if (!cache) {
    cache = new Map();
    noiseBuffers.set(ctx, cache);
  }
  const cached = cache.get(length);
  if (cached) return cached;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  cache.set(length, buffer);
  return buffer;
};

/** Fills every noise length the table and the snare use, so no first shot or wave start pays for it. */
export const warmNoise = (ctx: BaseAudioContext): void => {
  for (const sound of Object.values(SOUNDS)) {
    for (const voice of sound.voices) if (voice.kind === 'noise') noiseBuffer(ctx, voice.duration);
  }
  noiseBuffer(ctx, SNARE.duration);
};

const scheduleTone = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  at: number,
  voice: ToneVoice,
  pitch: number,
): void => {
  const scale = voice.jitter ? pitch : 1;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = voice.type;
  osc.frequency.setValueAtTime(voice.from * scale, at);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(1, voice.to * scale),
    at + (voice.sweep ?? voice.duration),
  );
  env.gain.setValueAtTime(voice.gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + voice.duration);
  osc.connect(env).connect(bus);
  osc.start(at);
  osc.stop(at + voice.duration + 0.05);
};

const scheduleNoise = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  at: number,
  voice: NoiseVoice,
): void => {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, voice.duration);
  const filter = ctx.createBiquadFilter();
  filter.type = voice.filter;
  filter.frequency.value = voice.cutoff;
  if (voice.q !== undefined) filter.Q.value = voice.q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(voice.gain, at);
  env.gain.exponentialRampToValueAtTime(0.001, at + voice.duration);
  source.connect(filter).connect(env).connect(bus);
  source.start(at);
};

/**
 * Schedules every voice at context time `at` into `bus`. `pitch` multiplies the frequency of
 * voices marked `jitter`; the live bank passes a small random factor per event so a magazine
 * does not sound like one looped sample, the offline score leaves it at 1.
 */
export const scheduleVoices = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  at: number,
  voices: readonly Voice[],
  pitch = 1,
): void => {
  for (const voice of voices) {
    const start = at + (voice.delay ?? 0);
    if (voice.kind === 'tone') scheduleTone(ctx, bus, start, voice, pitch);
    else scheduleNoise(ctx, bus, start, voice);
  }
};

export interface ChargeHum {
  /** Fades the hum out from context time `at`; the ramp is cut wherever it has reached. */
  stop(at: number): void;
}

/** Starts the charge hum at `at`, rising over `seconds` to its peak and holding there. */
export const startChargeHum = (
  ctx: BaseAudioContext,
  bus: AudioNode,
  at: number,
  seconds: number,
): ChargeHum => {
  const floor = 0.001;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(CHARGE_HUM.from, at);
  osc.frequency.exponentialRampToValueAtTime(CHARGE_HUM.to, at + seconds);
  env.gain.setValueAtTime(floor, at);
  env.gain.exponentialRampToValueAtTime(CHARGE_HUM.gain, at + seconds);
  osc.connect(env).connect(bus);
  osc.start(at);
  let stopped = false;
  return {
    stop: (release) => {
      if (stopped) return;
      stopped = true;
      const cut = Math.max(at, release);
      // The level the exponential ramp has reached by `cut`, so the fade starts from it.
      const progress = Math.min(1, (cut - at) / seconds);
      const level = floor * (CHARGE_HUM.gain / floor) ** progress;
      env.gain.cancelScheduledValues(cut);
      env.gain.setValueAtTime(level, cut);
      env.gain.exponentialRampToValueAtTime(floor, cut + CHARGE_HUM.release);
      osc.stop(cut + CHARGE_HUM.release + 0.02);
    },
  };
};

export interface Choir {
  /** Gain feeding the formants and body; silent until the caller ramps it up. */
  readonly bus: GainNode;
  /** Moves the formants towards the vowel at `phase` from context time `at`. */
  setVowel(phase: number, at: number): void;
  /** Stops every oscillator at context time `at` and disconnects the drone; not reversible. */
  stop(at: number): void;
}

/**
 * Master-bus limiter. Four skimmers dying under one grenade sum to 1.19 full scale before the
 * music; a compressor set as a brick wall (hard knee, high ratio, fast attack) at -6 dBFS keeps
 * the mix below clipping without touching a single shot. The same node closes the offline score
 * so the film and the game clip, or do not, together. Chosen by the numbers, not by ear.
 */
export const LIMITER = {
  threshold: -6,
  knee: 2,
  ratio: 16,
  attack: 0.002,
  release: 0.2,
} as const;

export const makeLimiter = (ctx: BaseAudioContext): DynamicsCompressorNode => {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = LIMITER.threshold;
  node.knee.value = LIMITER.knee;
  node.ratio.value = LIMITER.ratio;
  node.attack.value = LIMITER.attack;
  node.release.value = LIMITER.release;
  return node;
};

/**
 * Builds the choir drone: additive detuned voices through two drifting formants and a body
 * filter into `destination`. Pass `stopAt` on an offline context so the render can finish.
 */
export const buildChoir = (
  ctx: BaseAudioContext,
  destination: AudioNode,
  stopAt?: number,
): Choir => {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  const [qA, qB] = CHOIR.formantQ;
  const formantA = ctx.createBiquadFilter();
  formantA.type = 'bandpass';
  formantA.Q.value = qA;
  const formantB = ctx.createBiquadFilter();
  formantB.type = 'bandpass';
  formantB.Q.value = qB;
  const formantMix = ctx.createGain();
  formantMix.gain.value = CHOIR.formantMix;
  bus.connect(formantA).connect(formantMix);
  bus.connect(formantB).connect(formantMix);
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = CHOIR.bodyCutoff;
  bus.connect(body);
  formantMix.connect(destination);
  body.connect(destination);

  const oscillators: OscillatorNode[] = [];
  for (const hz of CHOIR.hz) {
    const voice = ctx.createGain();
    voice.gain.value = hz < 100 ? 0.5 : 0.16;
    voice.connect(bus);
    for (const cents of CHOIR.detuneCents) {
      const osc = ctx.createOscillator();
      osc.type = hz < 100 ? 'sine' : 'sawtooth';
      osc.frequency.value = hz;
      osc.detune.value = cents;
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = CHOIR.vibratoHz + Math.random() * CHOIR.vibratoSpread;
      const depth = ctx.createGain();
      depth.gain.value = hz * CHOIR.vibratoDepth;
      vibrato.connect(depth).connect(osc.frequency);
      vibrato.start(0);
      osc.connect(voice);
      osc.start(0);
      if (stopAt !== undefined) {
        osc.stop(stopAt);
        vibrato.stop(stopAt);
      }
      oscillators.push(osc, vibrato);
    }
  }

  let stopped = stopAt !== undefined;
  return {
    bus,
    setVowel: (phase, at) => {
      const [a, b] = vowelFormants(phase);
      formantA.frequency.setTargetAtTime(a, at, 0.5);
      formantB.frequency.setTargetAtTime(b, at, 0.5);
    },
    stop: (at) => {
      if (stopped) return;
      stopped = true;
      for (const osc of oscillators) osc.stop(at);
      formantMix.disconnect();
      body.disconnect();
    },
  };
};
