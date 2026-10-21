import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioBank } from '../../src/audio/audio';
import { renderScore } from '../../src/audio/offline';
import { SILENT, SOUNDS, soundFor } from '../../src/audio/sounds';
import { createEnemy, isExiting } from '../../src/core/enemy';
import {
  createGame,
  type GameEvent,
  type GameState,
  IDLE_INPUT,
  type PendingSpawn,
  stepGame,
} from '../../src/core/game';
import { runPlaytest } from '../../src/core/playtest';
import { createRng } from '../../src/core/rng';
import { vec3 } from '../../src/core/vec3';
import {
  DROP_POD_LEAD,
  FINAL_WAVE,
  LEADER_STRIDER_DELAY,
  WAVE_BEATS,
  waveBeat,
} from '../../src/core/waves';
import { CRAFT_FLIGHT_SECONDS, Dropship } from '../../src/render/dropship';
import { LightPool } from '../../src/render/lights';

/**
 * Seam 4 of #97: the dropship renderer (#80), the `dropPod` events the simulation emits, and
 * the sound table, run together over one deterministic steady-bot game. The simulation is the
 * real one; the renderer gets a bare `THREE.Group` as its parent; the audio banks get a fake
 * context that records what they schedule.
 */
const SEED = 7;
const DT = 1 / 60;
/** `src/main.ts`: the time scale during hit-stop, and the hit-stop each event earns. */
const HIT_STOP_SCALE = 0.2;
const hitStopFor = (e: GameEvent): number => {
  if (e.type === 'shieldBroken') return 0.12;
  if (e.type === 'enemyKilled') return e.score >= 300 ? 0.09 : 0.05;
  return 0;
};
/** `src/render/dropship.ts` private timings, restated so a change there shows up here. */
const POD_LINGER = 1.2;
const DUST_SECONDS = 0.7;
const steps = (seconds: number): number => Math.round(seconds / DT);

/** Every state of the seed's game, in step order; `events` are that step's events. */
const recordRun = (): GameState[] => {
  const states: GameState[] = [];
  runPlaytest({ seed: SEED, onStep: (state) => states.push(state) });
  return states;
};
const RUN = recordRun();

const isDropPod = (e: GameEvent): e is Extract<GameEvent, { type: 'dropPod' }> =>
  e.type === 'dropPod';

/** Indices of the steps that launch pods, in order. */
const burstSteps = (run: readonly GameState[]): number[] =>
  run.flatMap((state, i) => (state.events.some(isDropPod) ? [i] : []));

interface Census {
  readonly crafts: number;
  readonly pods: number;
  readonly dust: number;
  readonly craftGroups: THREE.Object3D[];
}

/** What the dropship has in the scene: crafts and pods are groups, dust rings are bare meshes. */
const census = (parent: THREE.Object3D): Census => {
  let crafts = 0;
  let pods = 0;
  let dust = 0;
  const craftGroups: THREE.Object3D[] = [];
  for (const child of parent.children) {
    if (child instanceof THREE.Mesh) {
      dust += 1;
      continue;
    }
    const first = child.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    if (first?.geometry.type === 'BoxGeometry') {
      crafts += 1;
      craftGroups.push(child);
    } else {
      pods += 1;
    }
  }
  return { crafts, pods, dust, craftGroups };
};

/**
 * Plays the run into a dropship the way `scene.ts` does per frame: `handle` for the step's
 * events, then `update`, both on the same clock. `clock(i)` gives the step's presentation time;
 * the simulation clock is `state.time`, the wall-clock model below differs under hit-stop.
 */
const play = (
  run: readonly GameState[],
  clock: (i: number) => number,
  probe: (i: number, state: GameState, seen: Census, parent: THREE.Group) => void,
): THREE.Group => {
  const parent = new THREE.Group();
  const dropship = new Dropship(parent, new LightPool());
  run.forEach((state, i) => {
    const now = clock(i);
    dropship.handle(state.events, now);
    dropship.update(now);
    probe(i, state, census(parent), parent);
  });
  return parent;
};

/**
 * The wall-clock second each step runs at in `src/main.ts` at a steady 60 fps: a frame adds
 * `frameDt * HIT_STOP_SCALE` to the accumulator while hit-stop runs, `frameDt` otherwise.
 */
const wallClock = (run: readonly GameState[]): number[] => {
  const wall: number[] = [];
  let hitStop = 0;
  let accumulator = 0;
  let next = 0;
  for (let frame = 0; next < run.length; frame += 1) {
    const now = frame * DT;
    if (hitStop > 0) {
      hitStop = Math.max(0, hitStop - DT);
      accumulator += DT * HIT_STOP_SCALE;
    } else {
      accumulator += DT;
    }
    while (accumulator >= DT - 1e-9 && next < run.length) {
      const state = run[next];
      if (!state) break;
      wall.push(now);
      for (const e of state.events) hitStop = Math.max(hitStop, hitStopFor(e));
      accumulator -= DT;
      next += 1;
    }
  }
  return wall;
};

interface Call {
  readonly method: string;
  readonly args: readonly number[];
}

interface FakeParam {
  value: number;
  readonly calls: Call[];
  setValueAtTime(...args: number[]): void;
  exponentialRampToValueAtTime(...args: number[]): void;
  linearRampToValueAtTime(...args: number[]): void;
  cancelScheduledValues(...args: number[]): void;
  setTargetAtTime(...args: number[]): void;
}

interface FakeNode {
  readonly tag: string;
  type: string;
  buffer: unknown;
  readonly calls: Call[];
  readonly frequency: FakeParam;
  readonly gain: FakeParam;
  readonly Q: FakeParam;
  readonly detune: FakeParam;
  connect<T>(target: T): T;
  start(at?: number): void;
  stop(at?: number): void;
}

const fakeParam = (): FakeParam => {
  const calls: Call[] = [];
  const record =
    (method: string) =>
    (...args: number[]): void => {
      calls.push({ method, args });
    };
  return {
    value: 0,
    calls,
    setValueAtTime: record('setValueAtTime'),
    exponentialRampToValueAtTime: record('exponentialRampToValueAtTime'),
    linearRampToValueAtTime: record('linearRampToValueAtTime'),
    cancelScheduledValues: record('cancelScheduledValues'),
    setTargetAtTime: record('setTargetAtTime'),
  };
};

/** The least of WebAudio both banks need, recording every node made and every call on it. */
const makeFakeAudio = (sampleRate = 8000) => {
  const nodes: FakeNode[] = [];
  const node = (tag: string): FakeNode => {
    const calls: Call[] = [];
    const made: FakeNode = {
      tag,
      type: '',
      buffer: null,
      calls,
      frequency: fakeParam(),
      gain: fakeParam(),
      Q: fakeParam(),
      detune: fakeParam(),
      connect: (target) => target,
      start: (at = 0) => calls.push({ method: 'start', args: [at] }),
      stop: (at = 0) => calls.push({ method: 'stop', args: [at] }),
    };
    nodes.push(made);
    return made;
  };
  const createBuffer = (channels: number, length: number) => ({
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  });
  const ctx = {
    sampleRate,
    currentTime: 0,
    destination: node('destination'),
    createOscillator: () => node('oscillator'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('source'),
    createConvolver: () => node('convolver'),
    createBuffer,
    resume: () => Promise.resolve(),
    startRendering: () => Promise.resolve(createBuffer(2, 8)),
  };
  return { ctx, nodes };
};

/** The dropship's engine sweep: the only sawtooth in the table that starts at 110 Hz. */
const engineSweeps = (nodes: readonly FakeNode[]): FakeNode[] =>
  nodes.filter(
    (n) => n.tag === 'oscillator' && n.type === 'sawtooth' && n.frequency.calls[0]?.args[0] === 110,
  );
const startOf = (n: FakeNode): number => n.calls.find((c) => c.method === 'start')?.args[0] ?? -1;

describe('seam 4: dropship, dropPod events, sound table', () => {
  it('runs the whole game: five waves, six pod launches, victory', () => {
    const last = RUN.at(-1);
    expect(last?.status).toBe('won');
    expect(burstSteps(RUN)).toHaveLength(6);
    expect(RUN.some((s) => s.events.some((e) => e.type === 'victory'))).toBe(true);
  });

  it('(1) answers every event type the run emits from SOUNDS or SILENT', () => {
    const seen = new Set<GameEvent['type']>();
    for (const state of RUN) {
      for (const e of state.events) {
        seen.add(e.type);
        const sound = soundFor(e);
        if ((SILENT as readonly string[]).includes(e.type)) {
          expect(sound, e.type).toBeNull();
        } else {
          // `SOUNDS[type]` is `undefined`, not null, for a stranger: `scheduleVoices` would
          // then crash on `.voices`. The `Record<SoundKey, Sound>` annotation on SOUNDS is what
          // stops a new GameEvent type from compiling until it is in one of the two lists.
          expect(sound, e.type).toBeDefined();
          expect(sound, e.type).not.toBeNull();
          expect(Array.isArray(sound?.voices), e.type).toBe(true);
        }
      }
    }
    for (const type of ['dropPod', 'waveStarted', 'waveCleared', 'enemyKilled', 'victory']) {
      expect([...seen]).toContain(type);
    }
  });

  it('(3) announces every pod DROP_POD_LEAD before its enemy goes active', () => {
    let pods = 0;
    for (const state of RUN) {
      for (const e of state.events.filter(isDropPod)) {
        pods += 1;
        expect(e.activeAt - state.time).toBeCloseTo(DROP_POD_LEAD, 9);
        const enemy = state.enemies.find((x) => x.id === e.id);
        expect(enemy?.activeAt).toBe(e.activeAt);
        expect(enemy?.state).toBe('spawning');
      }
    }
    expect(pods).toBe(WAVE_BEATS.reduce((n, beat) => n + beat.spawns.length, 0));
  });

  it('(2)(3)(4) one craft per burst, pods capped by the roster, and nothing left behind', () => {
    const bursts = burstSteps(RUN);
    const first = bursts[0];
    if (first === undefined) throw new Error('no pods launched');
    const rosterOf = (state: GameState): number => waveBeat(state.wave.number).spawns.length;
    const wave1 = RUN[first]?.events.filter(isDropPod).length ?? 0;
    const at = new Map<number, Census>();
    const launches: THREE.Object3D[] = [];
    const parent = play(
      RUN,
      (i) => RUN[i]?.time ?? 0,
      (i, state, seen) => {
        at.set(i, seen);
        for (const g of seen.craftGroups) if (!launches.includes(g)) launches.push(g);
        expect(seen.crafts, `step ${i}`).toBeLessThanOrEqual(1);
        expect(seen.pods, `step ${i}`).toBeLessThanOrEqual(rosterOf(state));
        if (bursts.includes(i)) expect(seen.crafts, `burst at step ${i}`).toBe(1);
        // Every wave starts with the previous wave's craft, pods and dust gone.
        if (state.events.some((e) => e.type === 'waveStarted')) {
          expect(seen, `waveStarted at step ${i}`).toMatchObject({ crafts: 0, pods: 0, dust: 0 });
        }
      },
    );
    const seen = (i: number): Census => {
      const c = at.get(i);
      if (!c) throw new Error(`no census for step ${i}`);
      return c;
    };
    // Wave 1: three pods leave at the burst, land after the lead, sink POD_LINGER later.
    expect(seen(first).pods).toBe(wave1);
    expect(seen(first).dust).toBe(0);
    const landed = first + steps(DROP_POD_LEAD) + 1;
    expect(seen(landed - 2).dust).toBe(0);
    expect(seen(landed).dust).toBe(wave1);
    expect(seen(landed).pods).toBe(wave1);
    expect(seen(landed + steps(DUST_SECONDS) - 2).dust).toBe(wave1);
    expect(seen(landed + steps(DUST_SECONDS) + 1).dust).toBe(0);
    const sunk = first + steps(DROP_POD_LEAD + POD_LINGER);
    expect(seen(sunk - 1).pods).toBe(wave1);
    expect(seen(sunk + 2).pods).toBe(0);
    // The craft crosses for CRAFT_FLIGHT_SECONDS from the burst.
    const gone = first + steps(CRAFT_FLIGHT_SECONDS);
    expect(seen(gone - 1).crafts).toBe(1);
    expect(seen(gone + 1).crafts).toBe(0);
    // One craft per wave on the simulation clock: the Leader's strider shares its skimmers'.
    expect(launches).toHaveLength(WAVE_BEATS.length);
    // The scene is empty once the run is over.
    expect(parent.children).toHaveLength(0);
  });

  it("(2) The Leader's strider launches one step before its craft leaves: no craft, no second craft", () => {
    const [skimmers, strider] = burstSteps(RUN).filter((i) => RUN[i]?.wave.number === 2);
    if (skimmers === undefined || strider === undefined) throw new Error('wave 2 not recorded');
    expect(RUN[skimmers]?.events.filter(isDropPod).map((e) => e.kind)).toEqual(
      Array.from({ length: 4 }, () => 'skimmer'),
    );
    expect(RUN[strider]?.events.filter(isDropPod).map((e) => e.kind)).toEqual(['strider']);
    // The skimmers' pods launch the step after waveStarted; the strider's dropAt is measured
    // from waveStarted itself, so the gap is LEADER_STRIDER_DELAY less one step.
    expect(strider - skimmers).toBe(steps(LEADER_STRIDER_DELAY) - 1);
    const t = ((RUN[strider]?.time ?? 0) - (RUN[skimmers]?.time ?? 0)) / CRAFT_FLIGHT_SECONDS;
    expect(t).toBeLessThan(1);
    expect(t).toBeCloseTo(1 - DT / CRAFT_FLIGHT_SECONDS, 3);
    let craftAtBurst: THREE.Object3D | undefined;
    let craftAtStrider: THREE.Object3D | undefined;
    let craftToPod = 0;
    play(
      RUN.slice(0, strider + 1),
      (i) => RUN[i]?.time ?? 0,
      (i, state, seen, parent) => {
        if (i === skimmers) craftAtBurst = seen.craftGroups[0];
        if (i !== strider) return;
        craftAtStrider = seen.craftGroups[0];
        const pod = state.events.find(isDropPod);
        const podGroup = parent.children.find(
          (c) => !(c instanceof THREE.Mesh) && !seen.craftGroups.includes(c) && c.position.y > 10,
        );
        if (!pod || !podGroup || !craftAtStrider) throw new Error('strider pod not drawn');
        craftToPod = craftAtStrider.position.distanceTo(podGroup.position);
      },
    );
    // Held (cosmetic): the craft is still in flight by one step, so the renderer does not
    // launch another, and the strider's pod drops from the sky with the craft well past the far
    // wall on the first skimmer's chord. On the wall clock (see (6)) the same pod gets a craft
    // of its own whenever a kill's hit-stop has pushed the craft past the end of its flight.
    expect(craftAtStrider).toBe(craftAtBurst);
    expect(craftToPod).toBeGreaterThan(15);
  });

  it('(6) measures the pod-to-enemy drift the wall clock adds under hit-stop', () => {
    const wall = wallClock(RUN);
    expect(wall).toHaveLength(RUN.length);
    let maxDrift = 0;
    let drifted = 0;
    for (const [i, state] of RUN.entries()) {
      for (const e of state.events.filter(isDropPod)) {
        const active = RUN.findIndex((s, j) => j >= i && s.time >= e.activeAt - 1e-9);
        const landsAtWall = (wall[i] ?? 0) + DROP_POD_LEAD;
        const drift = (wall[active] ?? 0) - landsAtWall;
        expect(drift).toBeGreaterThanOrEqual(-DT);
        if (drift > DT) drifted += 1;
        maxDrift = Math.max(maxDrift, drift);
      }
    }
    // Held: the pod can land this long before its enemy stands up, which the invulnerable
    // `spawning` state covers. One shield break (0.12 s) or one chain of kills inside the
    // 1.5 s fall is the whole budget; the tableau's slow motion starts after the last pod.
    expect(maxDrift).toBeLessThan(0.25);
    const launches: THREE.Object3D[] = [];
    play(
      RUN,
      (i) => wall[i] ?? 0,
      (_i, _state, seen) => {
        expect(seen.crafts).toBeLessThanOrEqual(1);
        for (const g of seen.craftGroups) if (!launches.includes(g)) launches.push(g);
      },
    );
    // The wall clock may or may not give the strider its own craft; either way at most one flies.
    expect(launches.length).toBeGreaterThanOrEqual(WAVE_BEATS.length);
    expect(launches.length).toBeLessThanOrEqual(WAVE_BEATS.length + 1);
    // Reported, not asserted: the numbers the hold rests on.
    expect({ maxDrift: Number(maxDrift.toFixed(4)), drifted, crafts: launches.length }).toEqual(
      expect.objectContaining({ drifted: expect.any(Number) }),
    );
  });

  it('(7) a pod launched in the step the leader falls still drops, while its enemy exits', () => {
    const base = createGame({ seed: 1 });
    const leader = {
      ...createEnemy(9, 'strider', vec3(0, 0, -10), 0, { leader: true }),
      state: 'dead' as const,
      health: 0,
      diedAt: base.time,
    };
    const pending: PendingSpawn = {
      id: 10,
      spawn: { kind: 'skimmer', delay: 0, healthScale: 1, leader: false },
      temperament: 'chaser',
      at: vec3(12, 0, 12),
      dropAt: base.time,
    };
    const armed: GameState = {
      ...base,
      enemies: [leader],
      pendingSpawns: [pending],
      wave: { number: FINAL_WAVE, phase: 'active', phaseEndsAt: 0 },
    };
    const next = stepGame(armed, IDLE_INPUT, DT, createRng(1));
    const types = next.events.map((e) => e.type);
    expect(types).toContain('dropPod');
    expect(types).toContain('victory');
    expect(types.indexOf('dropPod')).toBeLessThan(types.indexOf('victory'));
    const spawned = next.enemies.find((e) => e.id === 10);
    expect(spawned && isExiting(spawned)).toBe(true);
    expect(next.pendingSpawns).toHaveLength(0);
    // The renderer draws the pod anyway and tidies it up; held as cosmetic because no
    // leaderDown beat in the table delays a spawn, so a pod cannot launch after the leader can die.
    for (const beat of WAVE_BEATS.filter((b) => b.ending === 'leaderDown')) {
      expect(beat.spawns.every((s) => s.delay === 0)).toBe(true);
    }
    const parent = new THREE.Group();
    const dropship = new Dropship(parent, new LightPool());
    dropship.handle(next.events, next.time);
    dropship.update(next.time);
    expect(census(parent)).toMatchObject({ crafts: 1, pods: 1, dust: 0 });
    dropship.update(next.time + DROP_POD_LEAD + DT);
    expect(census(parent)).toMatchObject({ crafts: 1, pods: 1, dust: 1 });
    dropship.update(next.time + DROP_POD_LEAD + POD_LINGER + CRAFT_FLIGHT_SECONDS + DT);
    expect(parent.children).toHaveLength(0);
  });
});

describe('seam 4: the dropPod sound is the ship, not the pods', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastStand = (): GameState => {
    const state = RUN.find((s) => s.wave.number === FINAL_WAVE && s.events.some(isDropPod));
    if (!state) throw new Error('the Last Stand never launched');
    return state;
  };

  it('(5) the live bank plays one engine sweep for the nine Last Stand pods', () => {
    const { ctx, nodes } = makeFakeAudio();
    vi.stubGlobal('window', {
      AudioContext: class {
        constructor() {
          Object.assign(this, ctx);
        }
      },
      setInterval: () => 0,
    });
    const bank = new AudioBank();
    bank.unlock();
    const step = lastStand();
    const pods = step.events.filter(isDropPod);
    expect(pods).toHaveLength(waveBeat(FINAL_WAVE).spawns.length);
    const before = nodes.length;
    bank.handle(step.events);
    const made = nodes.slice(before);
    expect(engineSweeps(made)).toHaveLength(1);
    // The pods' other voices are gone with it: a noise source per non-dropPod noise voice only.
    const expectedNoises = step.events
      .filter((e) => !isDropPod(e))
      .flatMap((e) => soundFor(e)?.voices ?? [])
      .filter((v) => v.kind === 'noise').length;
    const dropPodNoises = SOUNDS.dropPod.voices.filter((v) => v.kind === 'noise').length;
    expect(made.filter((n) => n.tag === 'source')).toHaveLength(expectedNoises + dropPodNoises);
  });

  it('(5) the offline score schedules the same one sweep per launch as the live bank', async () => {
    const { ctx, nodes } = makeFakeAudio();
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        constructor() {
          Object.assign(this, ctx);
        }
      },
    );
    const end = lastStand().time + 1;
    await renderScore({ seed: SEED, seconds: end, leadIn: 0, sampleRate: 8000 });
    const sweeps = engineSweeps(nodes);
    const starts = new Set(sweeps.map((n) => startOf(n).toFixed(3)));
    expect(starts.size).toBe(burstSteps(RUN).length);
    expect(sweeps).toHaveLength(burstSteps(RUN).length);
  });
});
