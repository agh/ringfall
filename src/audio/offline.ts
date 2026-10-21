import type { GameEvent } from '../core/game';
import { runPlaytest } from '../core/playtest';
import { WEAPON_SPECS, type WeaponKind } from '../core/weapon';
import { CHARGE_HUM_FROM, CHARGE_HUM_TO } from './audio';

/** D5, F5, A5 and A5, E6: the same chimes the live bank plays (see audio.ts). */
const PICKUP_ARPEGGIO = [587.33, 698.46, 880];
const SPAWN_CHIME = [880, 1318.51];
/** Seconds the beam takes to charge, so the hum peaks exactly when the shot can fire. */
const CHARGE = WEAPON_SPECS.beam.chargeTime;

/**
 * Renders the score for a seeded bot run without real time: the deterministic simulation is
 * re-run headlessly to recover the event timeline, then every sound is scheduled into an
 * OfflineAudioContext and rendered to a WAV. Used by scripts/record-demo.mjs to give the
 * silent frame capture its soundtrack. Deliberately self-contained: the live Music class
 * relies on wall-clock scheduling, which an offline context does not have.
 */
export interface ScoreOptions {
  readonly seed: number;
  /** Seconds of gameplay to render. */
  readonly seconds: number;
  /** Silence (or title drone only) before the game starts, matching title frames in the film. */
  readonly leadIn: number;
  readonly sampleRate?: number;
}

interface TimedEvent {
  readonly time: number;
  readonly event: GameEvent;
}

const CHOIR_HZ = [73.42, 146.83, 220, 293.66, 349.23, 440];

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

const noiseBuffer = (ctx: BaseAudioContext, seconds: number): AudioBuffer => {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
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

export const renderScore = async (options: ScoreOptions): Promise<string> => {
  const sampleRate = options.sampleRate ?? 48000;
  const total = options.leadIn + options.seconds;
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * total), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 4);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  master.connect(ctx.destination);
  master.connect(reverb).connect(wet).connect(ctx.destination);

  // Choir drone through two drifting formants, present for the whole film.
  const choir = ctx.createGain();
  choir.gain.setValueAtTime(0, 0);
  choir.gain.linearRampToValueAtTime(0.22, 3);
  const formantA = ctx.createBiquadFilter();
  formantA.type = 'bandpass';
  formantA.Q.value = 6;
  const formantB = ctx.createBiquadFilter();
  formantB.type = 'bandpass';
  formantB.Q.value = 8;
  for (let t = 0; t < total; t += 0.5) {
    const blend = (Math.sin(t * 0.12) + 1) / 2;
    formantA.frequency.setTargetAtTime(600 - 300 * blend, t, 0.5);
    formantB.frequency.setTargetAtTime(1040 - 170 * blend, t, 0.5);
  }
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 1800;
  choir.connect(formantA).connect(master);
  choir.connect(formantB).connect(master);
  choir.connect(body).connect(master);
  for (const hz of CHOIR_HZ) {
    const voice = ctx.createGain();
    voice.gain.value = hz < 100 ? 0.5 : 0.14;
    voice.connect(choir);
    for (const cents of [-5, 0, 6]) {
      const osc = ctx.createOscillator();
      osc.type = hz < 100 ? 'sine' : 'sawtooth';
      osc.frequency.value = hz;
      osc.detune.value = cents;
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 4.8 + Math.random() * 1.4;
      const depth = ctx.createGain();
      depth.gain.value = hz * 0.0035;
      vibrato.connect(depth).connect(osc.frequency);
      vibrato.start(0);
      osc.connect(voice);
      osc.start(0);
      osc.stop(total);
    }
  }

  const sfx = ctx.createGain();
  sfx.gain.value = 0.5;
  sfx.connect(master);
  const pulse = ctx.createGain();
  pulse.gain.value = 0.9;
  pulse.connect(master);

  const sweep = (
    at: number,
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    bus: AudioNode = sfx,
  ): void => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration);
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(env).connect(bus);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  };
  const noise = (
    at: number,
    duration: number,
    gain: number,
    cutoff: number,
    bus: AudioNode = sfx,
  ): void => {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + duration);
    source.connect(filter).connect(env).connect(bus);
    source.start(at);
  };

  // Combat pulse: a kick on beats while a wave is active.
  const events = collectEvents(options.seed, options.seconds);
  let combatFrom: number | null = null;
  const combatWindows: Array<[number, number]> = [];
  for (const { time, event } of events) {
    if (event.type === 'waveStarted') combatFrom = time;
    if (
      (event.type === 'waveCleared' || event.type === 'playerDied' || event.type === 'victory') &&
      combatFrom !== null
    ) {
      combatWindows.push([combatFrom, time]);
      combatFrom = null;
    }
  }
  if (combatFrom !== null) combatWindows.push([combatFrom, options.seconds]);
  for (const [from, to] of combatWindows) {
    for (let beat = 0, t = from; t < to; beat += 1, t += 0.5) {
      const at = options.leadIn + t;
      if (beat % 2 === 0) sweep(at, 136, 62, 0.6, 'sine', 0.9, pulse);
      if (beat % 4 === 2) noise(at + 0.25, 0.18, 0.4, 1500, pulse);
    }
  }

  const shot = (at: number, kind: WeaponKind, hitEnemy: boolean): void => {
    switch (kind) {
      case 'rifle':
        sweep(at, hitEnemy ? 1400 : 900, hitEnemy ? 1400 : 900, 0.05, 'square', 0.25);
        noise(at, 0.06, 0.3, 1200);
        break;
      case 'laser':
        sweep(at, 2600, 1900, 0.09, 'sine', 0.35);
        sweep(at, 5200, 5200, 0.02, 'sine', 0.1);
        break;
      case 'scatter':
        noise(at, 0.2, 0.7, 3200);
        sweep(at, 110, 42, 0.28, 'sine', 0.7);
        break;
      case 'minigun':
        sweep(at, 1900, 1900, 0.018, 'square', 0.18);
        noise(at, 0.035, 0.25, 2600);
        break;
      case 'beam':
      case 'launcher':
        break;
    }
  };
  const chime = (
    at: number,
    notes: readonly number[],
    length: number,
    gap: number,
    gain: number,
  ) => {
    notes.forEach((hz, i) => {
      sweep(at + i * gap, hz, hz, length, 'triangle', gain);
      sweep(at + i * gap, hz * 2, hz * 2, length * 0.6, 'sine', gain * 0.3);
    });
  };
  /** The charge hum rises from its start until the matching release cuts it. */
  const chargeHum = (from: number, to: number): void => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(CHARGE_HUM_FROM, from);
    osc.frequency.exponentialRampToValueAtTime(CHARGE_HUM_TO, from + CHARGE);
    env.gain.setValueAtTime(0.001, from);
    env.gain.exponentialRampToValueAtTime(0.3, from + CHARGE);
    env.gain.setValueAtTime(0.3, Math.max(from + CHARGE, to));
    env.gain.exponentialRampToValueAtTime(0.001, Math.max(from + CHARGE, to) + 0.03);
    osc.connect(env).connect(sfx);
    osc.start(from);
    osc.stop(Math.max(from + CHARGE, to) + 0.05);
  };

  /** Every one-shot sound, in timeline order; the charge hum spans a start and its release. */
  const scheduleEvents = (): void => {
    let chargeFrom: number | null = null;
    const cutCharge = (at: number): void => {
      if (chargeFrom !== null) chargeHum(chargeFrom, at);
      chargeFrom = null;
    };
    for (const { time, event } of events) {
      const at = options.leadIn + time;
      switch (event.type) {
        case 'shot':
          shot(at, event.kind, event.hitEnemy);
          break;
        case 'chargeStarted':
          chargeFrom = at;
          break;
        case 'chargeReleased':
          cutCharge(at);
          break;
        case 'weaponSwapped':
          cutCharge(at);
          sweep(at, 900, 900, 0.03, 'square', 0.2);
          noise(at, 0.04, 0.3, 2200);
          sweep(at + 0.07, 620, 620, 0.03, 'square', 0.2);
          noise(at + 0.07, 0.04, 0.25, 1800);
          break;
        case 'pickupTaken':
          cutCharge(at);
          chime(at, PICKUP_ARPEGGIO, 0.14, 0.09, 0.22);
          break;
        case 'playerDied':
          cutCharge(at);
          sweep(at, 500, 60, 1.4, 'sawtooth', 0.5);
          break;
        case 'beamFired':
          noise(at, 0.05, 0.8, 7000);
          sweep(at, 320, 55, 0.45, 'sine', 0.7);
          sweep(at, 1800, 400, 0.12, 'sawtooth', 0.15);
          break;
        case 'launcherFired':
          sweep(at, 170, 48, 0.3, 'triangle', 0.7);
          noise(at, 0.12, 0.4, 500);
          break;
        case 'pickupSpawned':
          chime(at, SPAWN_CHIME, 0.18, 0.12, 0.15);
          break;
        case 'empty':
          sweep(at, 240, 240, 0.08, 'square', 0.2);
          break;
        case 'reload':
          sweep(at, 500, 500, 0.12, 'triangle', 0.25);
          break;
        case 'enemyKilled':
          sweep(at, 900, 200, 0.25, 'sawtooth', 0.35);
          break;
        case 'playerDamaged':
          sweep(at, 180, 180, 0.1, 'sawtooth', 0.4);
          break;
        case 'shieldBroken':
          sweep(at, 1200, 300, 0.5, 'sine', 0.5);
          break;
        case 'explosion':
          noise(at, 0.6, 0.9, 1200);
          sweep(at, 120, 40, 0.6, 'sine', 0.8);
          break;
        case 'boltFired':
          sweep(at, 700, 350, 0.2, 'sine', 0.15);
          break;
        case 'grenadeThrown':
          sweep(at, 400, 400, 0.05, 'triangle', 0.2);
          break;
        case 'waveStarted':
          sweep(at, 300, 600, 0.6, 'triangle', 0.35);
          break;
        case 'waveCleared':
        case 'victory':
          sweep(at, 400, 1000, 0.8, 'sine', 0.45);
          break;
      }
    }
    // A charge still held when the film ends keeps humming to the end.
    if (chargeFrom !== null) chargeHum(chargeFrom, total);
  };
  scheduleEvents();

  const rendered = await ctx.startRendering();
  return toBase64(encodeWav(rendered));
};
