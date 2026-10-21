import { describe, expect, it } from 'vitest';
import {
  CHARGE_HUM,
  chargeSeconds,
  kick,
  SILENT,
  SNARE,
  SOUNDS,
  scheduleVoices,
  soundFor,
  startChargeHum,
  type Voice,
  vowelFormants,
} from '../../src/audio/sounds';
import type { GameEvent } from '../../src/core/game';
import { vec3 } from '../../src/core/vec3';
import { WEAPON_KINDS } from '../../src/core/weapon';

/**
 * Every event type the simulation can emit. `satisfies` makes the compiler reject this object
 * the moment a type is added to or removed from `GameEvent`, so the list below is exhaustive.
 */
const EVENT_TYPES = Object.keys({
  shot: true,
  empty: true,
  reload: true,
  grenadeThrown: true,
  launcherFired: true,
  weaponSwapped: true,
  chargeStarted: true,
  chargeReleased: true,
  beamFired: true,
  pickupSpawned: true,
  pickupTaken: true,
  pickupExpired: true,
  explosion: true,
  enemyKilled: true,
  enemyFled: true,
  enemyBark: true,
  playerDamaged: true,
  shieldBroken: true,
  boltFired: true,
  waveStarted: true,
  waveCleared: true,
  playerDied: true,
  victory: true,
  secretFound: true,
} satisfies Record<GameEvent['type'], true>) as GameEvent['type'][];

const SOUND_KEYS = Object.keys(SOUNDS);
const SILENT_TYPES: readonly string[] = SILENT;

/** The least a fake needs for the scheduler: nodes that connect and params that record calls. */
interface Call {
  readonly method: string;
  readonly args: readonly number[];
}

const fakeParam = (calls: Call[]) => {
  const record =
    (method: string) =>
    (...args: number[]): void => {
      calls.push({ method, args });
    };
  return {
    value: 0,
    setValueAtTime: record('setValueAtTime'),
    exponentialRampToValueAtTime: record('exponentialRampToValueAtTime'),
    linearRampToValueAtTime: record('linearRampToValueAtTime'),
    cancelScheduledValues: record('cancelScheduledValues'),
    setTargetAtTime: record('setTargetAtTime'),
  };
};

interface FakeNode {
  /** What created it; `type` is left free for the scheduler to set. */
  readonly tag: string;
  readonly calls: Call[];
  readonly frequency: ReturnType<typeof fakeParam>;
  readonly gain: ReturnType<typeof fakeParam>;
  readonly Q: ReturnType<typeof fakeParam>;
  readonly connected: FakeNode[];
  connect(target: FakeNode): FakeNode;
  start(at?: number): void;
  stop(at?: number): void;
}

const makeFakeContext = (): { ctx: BaseAudioContext; nodes: FakeNode[] } => {
  const nodes: FakeNode[] = [];
  const node = (tag: string): FakeNode => {
    const calls: Call[] = [];
    const made: FakeNode = {
      tag,
      calls,
      frequency: fakeParam(calls),
      gain: fakeParam(calls),
      Q: fakeParam(calls),
      connected: [],
      connect: (target) => {
        made.connected.push(target);
        return target;
      },
      start: (at = 0) => calls.push({ method: 'start', args: [at] }),
      stop: (at = 0) => calls.push({ method: 'stop', args: [at] }),
    };
    nodes.push(made);
    return made;
  };
  const sampleRate = 8000;
  const ctx = {
    sampleRate,
    currentTime: 0,
    destination: node('destination'),
    createOscillator: () => node('oscillator'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('source'),
    createBuffer: (channels: number, length: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, nodes };
};

const allVoices = (): Voice[] => Object.values(SOUNDS).flatMap((sound) => sound.voices);

describe('sound table', () => {
  it('names every GameEvent type, in the table or in SILENT', () => {
    for (const type of EVENT_TYPES) {
      const heard =
        type === 'shot'
          ? WEAPON_KINDS.every((kind) => SOUND_KEYS.includes(`shot:${kind}`))
          : SOUND_KEYS.includes(type);
      expect(heard || SILENT_TYPES.includes(type), `${type} is neither in SOUNDS nor SILENT`).toBe(
        true,
      );
    }
  });

  it('puts no event in both lists and no stranger in either', () => {
    for (const type of SILENT_TYPES) {
      expect(EVENT_TYPES).toContain(type);
      expect(SOUND_KEYS).not.toContain(type);
    }
    for (const key of SOUND_KEYS) {
      const type = key.split(':')[0];
      expect(EVENT_TYPES).toContain(type);
    }
  });

  it('keeps every voice audible and bounded', () => {
    for (const voice of allVoices()) {
      expect(voice.duration).toBeGreaterThan(0);
      expect(voice.gain).toBeGreaterThan(0);
      expect(voice.gain).toBeLessThanOrEqual(1);
      expect(voice.delay ?? 0).toBeGreaterThanOrEqual(0);
      if (voice.kind === 'tone') {
        expect(voice.from).toBeGreaterThan(0);
        expect(voice.to).toBeGreaterThan(0);
        expect(voice.sweep ?? voice.duration).toBeGreaterThan(0);
      } else {
        expect(voice.cutoff).toBeGreaterThan(0);
      }
    }
    for (const voice of [kick(62, 0.9), SNARE]) {
      expect(voice.duration).toBeGreaterThan(0);
      expect(voice.gain).toBeGreaterThan(0);
    }
  });

  it('finds the voice for an event', () => {
    const base = { type: 'shot', from: vec3(0, 0, 0), to: vec3(0, 0, -1), pellets: 1 } as const;
    const hit = soundFor({ ...base, kind: 'rifle', hitEnemy: true });
    const miss = soundFor({ ...base, kind: 'rifle', hitEnemy: false });
    expect(hit).toBe(SOUNDS['shot:rifle:hit']);
    expect(miss).toBe(SOUNDS['shot:rifle']);
    expect(hit).not.toBe(miss);
    // The beam's own shot is silent: beamFired carries it.
    expect(soundFor({ ...base, kind: 'beam', hitEnemy: true })?.voices).toEqual([]);
    expect(soundFor({ type: 'pickupExpired', id: 1 })).toBeNull();
    expect(soundFor({ type: 'playerDied' })).toBe(SOUNDS.playerDied);
    expect(SOUNDS.playerDied.cutsCharge).toBe(true);
  });

  it('schedules every voice as a chain into the bus', () => {
    const { ctx, nodes } = makeFakeContext();
    const bus = ctx.createGain();
    const before = nodes.length;
    const voices = allVoices();
    scheduleVoices(ctx, bus, 2, voices, 1.02);
    const made = nodes.slice(before);
    const tones = voices.filter((v) => v.kind === 'tone').length;
    const noises = voices.length - tones;
    expect(made.filter((n) => n.tag === 'oscillator')).toHaveLength(tones);
    expect(made.filter((n) => n.tag === 'source')).toHaveLength(noises);
    expect(made.filter((n) => n.tag === 'filter')).toHaveLength(noises);
    for (const osc of made.filter((n) => n.tag === 'oscillator')) {
      const start = osc.calls.find((c) => c.method === 'start');
      const stop = osc.calls.find((c) => c.method === 'stop');
      expect(start?.args[0]).toBeGreaterThanOrEqual(2);
      expect(stop?.args[0]).toBeGreaterThan(start?.args[0] ?? Number.POSITIVE_INFINITY);
    }
    // Every chain ends in the bus.
    const leaves = made.filter((n) => n.connected.length === 0 && n.tag !== 'gain');
    expect(leaves).toHaveLength(0);
    expect(made.filter((n) => n.connected.includes(bus as unknown as FakeNode)).length).toBe(
      voices.length,
    );
  });

  it('jitters only the voices marked for it', () => {
    const { ctx, nodes } = makeFakeContext();
    const bus = ctx.createGain();
    const [jittered, plain] = SOUNDS['shot:laser'].voices.map((v) =>
      v.kind === 'tone' ? { ...v, jitter: false } : v,
    );
    const marked = SOUNDS['shot:laser'].voices[0];
    if (!marked || !jittered || !plain || marked.kind !== 'tone') throw new Error('table changed');
    scheduleVoices(ctx, bus, 0, [marked, jittered], 1.5);
    const [a, b] = nodes.filter((n) => n.tag === 'oscillator');
    const onset = (n: FakeNode | undefined) =>
      n?.calls.find((c) => c.method === 'setValueAtTime')?.args[0];
    expect(onset(a)).toBeCloseTo(marked.from * 1.5);
    expect(onset(b)).toBeCloseTo(marked.from);
  });

  it('cuts the charge hum at the level it has reached', () => {
    const { ctx, nodes } = makeFakeContext();
    const bus = ctx.createGain();
    const seconds = chargeSeconds('beam');
    expect(seconds).toBeGreaterThan(0);
    const hum = startChargeHum(ctx, bus, 1, seconds);
    hum.stop(1 + seconds / 2);
    hum.stop(1 + seconds);
    const env = nodes.filter((n) => n.tag === 'gain').at(-1);
    const cut = env?.calls.filter((c) => c.method === 'setValueAtTime').at(-1);
    expect(cut?.args[0]).toBeGreaterThan(0.001);
    expect(cut?.args[0]).toBeLessThan(CHARGE_HUM.gain);
    const stops = nodes.flatMap((n) => n.calls.filter((c) => c.method === 'stop'));
    expect(stops).toHaveLength(1);
    expect(chargeSeconds('rifle')).toBe(CHARGE_HUM.fallbackSeconds);
  });

  it('drifts the vowel between the formant pairs', () => {
    const [a0, b0] = vowelFormants(Math.PI / 2);
    expect(a0).toBeCloseTo(400);
    expect(b0).toBeCloseTo(750);
    const [a1, b1] = vowelFormants(-Math.PI / 2);
    expect(a1).toBeCloseTo(300);
    expect(b1).toBeCloseTo(870);
  });
});

describe('charge hum lifetime', () => {
  it('is cut by every event that can end a run with the trigger held', () => {
    // The simulation stops on victory and death, so no chargeReleased follows either.
    expect(SOUNDS.victory.cutsCharge).toBe(true);
    expect(SOUNDS.playerDied.cutsCharge).toBe(true);
  });
});
