import { describe, expect, it } from 'vitest';
import {
  createEnemy,
  type Enemy,
  FLEE_DURATION,
  FLEE_RADIUS,
  isExiting,
  SKITTISH_HOLD_RANGE,
  startExit,
  startFlee,
  TEMPERAMENTS,
  type Temperament,
} from '../../src/core/enemy';
import {
  createGame,
  type GameEvent,
  type GameState,
  IDLE_INPUT,
  type PendingSpawn,
  stepGame,
  TABLEAU_DURATION,
} from '../../src/core/game';
import type { Grenade } from '../../src/core/grenade';
import { GRENADE_BLAST_RADIUS } from '../../src/core/grenade';
import { createRng } from '../../src/core/rng';
import { distanceXZ, type Vec3, vec3 } from '../../src/core/vec3';
import {
  DROP_POD_LEAD,
  FINAL_WAVE,
  WATCHERS_IN_ROSTER,
  WAVE_COUNTDOWN,
  type WaveSpawn,
  watcherCount,
  waveBeat,
  waveComposition,
} from '../../src/core/waves';

/**
 * Merge seams (#97, pass C): features that landed from different branches, run together through
 * `stepGame` on one deterministic timeline. Seam 1 is the rout (#40) against the tableau's exit
 * (#57) and the temperaments (#47); seam 3 is the watcher (#17) against the drop pods and the
 * generated wave table.
 */

const DT = 1 / 60;

/** Steps `state` idle for `seconds`, keeping every intermediate state and each step's events. */
const trace = (
  state: GameState,
  seconds: number,
  seed = 1,
): { state: GameState; states: GameState[]; events: GameEvent[] } => {
  const rng = createRng(seed);
  const states: GameState[] = [];
  const events: GameEvent[] = [];
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    s = stepGame(s, IDLE_INPUT, DT, rng);
    states.push(s);
    events.push(...s.events);
  }
  return { state: s, states, events };
};

/** A game whose arena has no cover, so nothing stands between an enemy and the arena edge. */
const openGame = (): GameState => {
  const g = createGame({ seed: 1 });
  return { ...g, arena: { ...g.arena, obstacles: [] } };
};

/** The Last Stand already active with these enemies on the field and these grenades on the floor. */
const lastStand = (enemies: readonly Enemy[], grenades: readonly Grenade[] = []): GameState => {
  const base = openGame();
  return {
    ...base,
    enemies,
    grenades,
    wave: { number: FINAL_WAVE, phase: 'active', phaseEndsAt: 0 },
  };
};

const byId = (s: GameState, id: number): Enemy | undefined => s.enemies.find((e) => e.id === id);

const ofType = <T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] =>
  events.flatMap((e) => (e.type === type ? [e as Extract<GameEvent, { type: T }>] : []));

/** A strider on one hit point: the next blast that reaches it is the one that kills it. */
const doomedStrider = (id: number, at: Vec3, leader = false): Enemy => ({
  ...createEnemy(id, 'strider', at, 0, { healthScale: leader ? 3 : 1, leader }),
  state: 'attack',
  health: 1,
});

const LEADER_ID = 50;
const STRIDER_ID = 52;
const WATCHER_ID = 70;
const LEADER_AT = vec3(0, 0, -12);
const STRIDER_AT = vec3(16, 0, 4);

/** The armoured leader already down, so the next step opens the tableau. */
const fallenLeader = (): Enemy => ({
  ...createEnemy(LEADER_ID, 'strider', LEADER_AT, 0, { healthScale: 3, leader: true }),
  state: 'dead',
  health: 0,
  diedAt: 0,
});

/**
 * One skimmer per temperament around the strider at `STRIDER_AT`: all inside `FLEE_RADIUS` of
 * it, none inside a blast at it, and the skittish one inside its hold range of the player with
 * no packmate near enough to the player for it to move.
 */
const PACK_AT: Readonly<Record<Temperament, Vec3>> = {
  chaser: vec3(26, 0, 8),
  ambusher: vec3(16, 0, 14),
  flanker: vec3(8, 0, 12),
  skittish: vec3(8, 0, -4),
};

const packId = (temperament: Temperament): number => 60 + TEMPERAMENTS.indexOf(temperament);

const pack = (): Enemy[] =>
  TEMPERAMENTS.map((temperament) => ({
    ...createEnemy(packId(temperament), 'skimmer', PACK_AT[temperament], 0, { temperament }),
    state: 'chase' as const,
  }));

/** A grenade lying on the floor at `at` whose fuse runs out at `explodeAt`. */
const fused = (id: number, at: Vec3, explodeAt: number): Grenade => ({
  id,
  position: at,
  velocity: vec3(),
  explodeAt,
});

/** The step in which the enemy with `id` was reported killed, or -1. */
const killStep = (states: readonly GameState[], id: number): number =>
  states.findIndex((s) => s.events.some((e) => e.type === 'enemyKilled' && e.id === id));

describe('seam 1: rout, exit-flee and temperaments on one skimmer', () => {
  it('lays the pack out as the scenario assumes', () => {
    for (const t of TEMPERAMENTS) {
      expect(distanceXZ(PACK_AT[t], STRIDER_AT)).toBeLessThan(FLEE_RADIUS);
      expect(distanceXZ(PACK_AT[t], STRIDER_AT)).toBeGreaterThan(GRENADE_BLAST_RADIUS);
      expect(distanceXZ(PACK_AT[t], LEADER_AT)).toBeGreaterThan(GRENADE_BLAST_RADIUS);
    }
    expect(distanceXZ(PACK_AT.skittish, vec3())).toBeLessThan(SKITTISH_HOLD_RANGE);
    expect(distanceXZ(STRIDER_AT, vec3())).toBeGreaterThan(GRENADE_BLAST_RADIUS);
    expect(distanceXZ(LEADER_AT, vec3())).toBeGreaterThan(GRENADE_BLAST_RADIUS);
  });

  it('a routed skimmer of every temperament exits when the final leader falls mid-rout and never chases again', () => {
    // A blast kills the one-hit strider at 0.5 s and routs the pack; a second blast kills the
    // one-hit leader at 1 s, while every rout timer still has 3.5 s to run.
    const start = lastStand(
      [doomedStrider(LEADER_ID, LEADER_AT, true), doomedStrider(STRIDER_ID, STRIDER_AT), ...pack()],
      [fused(90, STRIDER_AT, 0.5), fused(91, LEADER_AT, 1)],
    );
    const { state, states, events } = trace(start, 1 + TABLEAU_DURATION + 0.5);

    // (c) The skittish skimmer holds position until the rout: its goal is null, not a step.
    const routed = killStep(states, STRIDER_ID);
    expect(routed).toBeGreaterThan(20);
    for (const s of states.slice(0, routed)) {
      expect(byId(s, packId('skittish'))?.position).toEqual(PACK_AT.skittish);
      expect(byId(s, packId('skittish'))?.state).toBe('chase');
    }
    expect(byId(states[routed - 1] as GameState, packId('chaser'))?.position).not.toEqual(
      PACK_AT.chaser,
    );

    // The strider's death routs all four for FLEE_DURATION, and each one barks.
    const atRout = states[routed] as GameState;
    expect(
      ofType(atRout.events, 'enemyFled')
        .map((e) => e.id)
        .sort(),
    ).toEqual(TEMPERAMENTS.map(packId));
    expect(ofType(atRout.events, 'enemyBark')).toHaveLength(TEMPERAMENTS.length);
    for (const t of TEMPERAMENTS) {
      const e = byId(atRout, packId(t));
      expect(e?.state).toBe('flee');
      expect(e?.fleeUntil).toBeCloseTo(atRout.time + FLEE_DURATION);
    }

    // The leader falls during the rout: the same step turns every rout into an exit.
    const won = killStep(states, LEADER_ID);
    expect(won).toBeGreaterThan(routed);
    expect(won).toBeLessThan(routed + Math.round(FLEE_DURATION / DT));
    const atVictory = states[won] as GameState;
    expect(ofType(atVictory.events, 'victory')).toHaveLength(1);
    expect(atVictory.tableau).not.toBeNull();
    for (const t of TEMPERAMENTS) {
      const e = byId(atVictory, packId(t));
      expect(e?.state).toBe('flee');
      expect(e?.fleeUntil).toBe(Number.POSITIVE_INFINITY);
      expect(isExiting(e as Enemy)).toBe(true);
    }

    // From then on no skimmer is ever anything but exiting, including after the rout timer
    // (and its refresh on the leader's death) would have run out.
    for (const s of states.slice(won + 1)) {
      for (const e of s.enemies.filter((x) => x.kind === 'skimmer')) {
        expect(isExiting(e)).toBe(true);
      }
    }
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(false);
    // Each one is removed past the arena edge before the tableau ends, and the run is won.
    const tableauEnd = states.findIndex((s) => s.status === 'won');
    expect(tableauEnd).toBeGreaterThan(won);
    expect((states[tableauEnd] as GameState).time).toBeCloseTo(
      atVictory.time + TABLEAU_DURATION,
      1,
    );
    expect((states[tableauEnd] as GameState).enemies).toEqual([]);
    expect(state.status).toBe('won');
    expect(state.enemies).toEqual([]);
  });

  it('a skimmer already exiting stays exiting when a late blast kills a strider in the tableau', () => {
    // The leader is down before the first step, so the tableau opens at once and every survivor
    // exits. A grenade on the floor by the one-hit strider goes off at 0.5 s and kills it on its
    // way out; `routSkimmers` then runs over a pack that is already leaving for good.
    const start = lastStand(
      [fallenLeader(), doomedStrider(STRIDER_ID, STRIDER_AT), ...pack()],
      [fused(90, STRIDER_AT, 0.5)],
    );
    const { state, states, events } = trace(start, TABLEAU_DURATION + 0.5);

    const atVictory = states[0] as GameState;
    expect(ofType(atVictory.events, 'victory')).toHaveLength(1);
    expect(isExiting(byId(atVictory, STRIDER_ID) as Enemy)).toBe(true);
    for (const t of TEMPERAMENTS) expect(isExiting(byId(atVictory, packId(t)) as Enemy)).toBe(true);

    const blast = killStep(states, STRIDER_ID);
    expect(blast).toBeGreaterThan(0);
    const atBlast = states[blast] as GameState;
    expect(atBlast.tableau).not.toBeNull();
    expect(ofType(atBlast.events, 'explosion')).toHaveLength(1);
    // Everyone was within FLEE_RADIUS of the strider when it died, and all are still on the field.
    for (const t of TEMPERAMENTS) {
      const before = byId(states[blast - 1] as GameState, packId(t)) as Enemy;
      expect(distanceXZ(before.position, STRIDER_AT)).toBeLessThan(FLEE_RADIUS);
      expect(before.health).toBe(before.maxHealth);
    }
    // A second strider death must not downgrade an exit to a timed rout...
    for (const t of TEMPERAMENTS) {
      const e = byId(atBlast, packId(t)) as Enemy;
      expect(e.health).toBe(e.maxHealth);
      expect(e.state).toBe('flee');
      expect(e.fleeUntil).toBe(Number.POSITIVE_INFINITY);
    }
    // ...and nothing changed for them, so there is no rout to announce or bark.
    expect(ofType(atBlast.events, 'enemyFled')).toEqual([]);
    expect(ofType(atBlast.events, 'enemyBark')).toEqual([]);

    for (const s of states.slice(blast + 1)) {
      for (const e of s.enemies.filter((x) => x.kind === 'skimmer')) {
        expect(isExiting(e)).toBe(true);
      }
    }
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(false);
    expect(state.status).toBe('won');
    expect(state.enemies).toEqual([]);

    // The same rule, stated on the function the seam runs through.
    const exiting = startExit({ ...createEnemy(1, 'skimmer', vec3(0, 0, -5), 0), state: 'chase' });
    expect(startFlee(exiting, 3)).toBe(exiting);
  });
});

describe('seam 3: the watcher behind its roster flag, the drop pods and the wave table', () => {
  const watcherSpawn: WaveSpawn = { kind: 'watcher', delay: 0, healthScale: 1, leader: false };
  const WATCHER_AT = vec3(0, 0, -28);

  /** The pending entry `spawnWave` would hold for a watcher pod launching at `dropAt`. */
  const watcherPod = (dropAt: number): PendingSpawn => ({
    id: WATCHER_ID,
    spawn: watcherSpawn,
    temperament: 'chaser',
    at: WATCHER_AT,
    dropAt,
  });

  it('flag off: wave 1 launches only the pods in its beat and never a watcher', () => {
    expect(WATCHERS_IN_ROSTER).toBe(false);
    for (let wave = 1; wave <= FINAL_WAVE; wave += 1) {
      expect(waveComposition(wave)).not.toContain('watcher');
    }
    const { state, events } = trace(openGame(), WAVE_COUNTDOWN + 0.1);
    const pods = ofType(events, 'dropPod');
    expect(pods).toHaveLength(waveBeat(1).spawns.length);
    for (const pod of pods) expect(waveComposition(1)).toContain(pod.kind);
    expect(pods.some((p) => p.kind === 'watcher')).toBe(false);
    expect(state.enemies.some((e) => e.kind === 'watcher')).toBe(false);
    expect(state.pendingSpawns.filter((p) => p.spawn.kind === 'watcher')).toEqual([]);
  });

  it('flag on, simulated: the Last Stand watcher pod launches, honours the pod lead, and is no holdout', () => {
    expect(watcherCount(FINAL_WAVE)).toBe(1);
    const leader: Enemy = {
      ...createEnemy(LEADER_ID, 'strider', LEADER_AT, 0, { healthScale: 3, leader: true }),
      state: 'attack',
    };
    const start: GameState = { ...lastStand([leader]), pendingSpawns: [watcherPod(0.5)] };
    const { states, events } = trace(start, 0.5 + DROP_POD_LEAD + 1);

    const launch = states.findIndex((s) => s.events.some((e) => e.type === 'dropPod'));
    expect(launch).toBeGreaterThan(0);
    for (const s of states.slice(0, launch)) {
      expect(byId(s, WATCHER_ID)).toBeUndefined();
      expect(s.pendingSpawns.map((p) => p.id)).toEqual([WATCHER_ID]);
    }
    const atLaunch = states[launch] as GameState;
    const pod = ofType(atLaunch.events, 'dropPod');
    expect(pod).toEqual([
      {
        type: 'dropPod',
        id: WATCHER_ID,
        kind: 'watcher',
        at: WATCHER_AT,
        activeAt: atLaunch.time + DROP_POD_LEAD,
        leader: false,
      },
    ]);
    expect(atLaunch.pendingSpawns).toEqual([]);
    const landed = byId(atLaunch, WATCHER_ID) as Enemy;
    expect(landed.state).toBe('spawning');
    expect(landed.activeAt).toBe(pod[0]?.activeAt);

    // The pod lead is honoured: spawning until `activeAt`, then holding the perimeter.
    for (const s of states.slice(launch + 1)) {
      const w = byId(s, WATCHER_ID) as Enemy;
      if (s.time < landed.activeAt) expect(w.state).toBe('spawning');
      else expect(w.state === 'chase' || w.state === 'attack').toBe(true);
    }
    const awake = states.find((s) => s.time >= landed.activeAt) as GameState;
    expect((byId(awake, WATCHER_ID) as Enemy).state).toBe('chase');
    expect(ofType(events, 'watcherCharging').every((e) => e.id === WATCHER_ID)).toBe(true);
    expect(ofType(events, 'watcherCharging').length).toBeGreaterThan(0);
    // The wave stayed active throughout: the leader is up, and it is the only holdout.
    expect(states.every((s) => s.wave.phase === 'active')).toBe(true);

    // A `leaderDown` wave does not count the watcher, live or still in its pod.
    const last = states[states.length - 1] as GameState;
    const leaderFalls: GameState = {
      ...last,
      enemies: last.enemies.map((e) => (e.leader ? { ...e, state: 'dead', diedAt: last.time } : e)),
    };
    const won = stepGame(leaderFalls, IDLE_INPUT, DT, createRng(1));
    expect(won.wave.phase).toBe('won');
    expect(ofType(won.events, 'victory')).toHaveLength(1);
    expect(isExiting(byId(won, WATCHER_ID) as Enemy)).toBe(true);
    const podded: GameState = { ...lastStand([fallenLeader()]), pendingSpawns: [watcherPod(2)] };
    const wonEarly = stepGame(podded, IDLE_INPUT, DT, createRng(1));
    expect(wonEarly.wave.phase).toBe('won');
    expect(wonEarly.pendingSpawns).toEqual([]);
  });

  it('flag on, simulated: a `cleared` wave counts the watcher as a holdout, pod and all', () => {
    const base = openGame();
    const scouts: GameState = {
      ...base,
      wave: { number: 1, phase: 'active', phaseEndsAt: 0 },
      pendingSpawns: [watcherPod(0.5)],
    };
    expect(waveBeat(1).ending).toBe('cleared');
    const { state, states, events } = trace(scouts, 0.5 + DROP_POD_LEAD + 0.5);
    expect(ofType(events, 'dropPod').map((e) => e.kind)).toEqual(['watcher']);
    expect(states.every((s) => s.wave.phase === 'active')).toBe(true);
    expect(events.some((e) => e.type === 'waveCleared')).toBe(false);
    const w = byId(state, WATCHER_ID) as Enemy;
    expect(w.state === 'chase' || w.state === 'attack').toBe(true);

    const slain: GameState = {
      ...state,
      enemies: state.enemies.map((e) => ({ ...e, state: 'dead' as const, diedAt: state.time })),
    };
    const cleared = stepGame(slain, IDLE_INPUT, DT, createRng(1));
    expect(cleared.wave.phase).toBe('cleared');
    expect(ofType(cleared.events, 'waveCleared')).toEqual([{ type: 'waveCleared', number: 1 }]);
  });

  it('the tableau sends an exiting watcher off the arena instead of leaving it on the perimeter', () => {
    // A watcher holding the band, due to charge half a second in; the leader is already down.
    const watcher: Enemy = {
      ...createEnemy(WATCHER_ID, 'watcher', WATCHER_AT, 0),
      state: 'chase',
      nextAttackAt: 0.5,
    };
    const start = lastStand([fallenLeader(), watcher]);
    const { state, states, events } = trace(start, TABLEAU_DURATION + 1);

    const atVictory = states[0] as GameState;
    expect(ofType(atVictory.events, 'victory')).toHaveLength(1);
    const exiting = byId(atVictory, WATCHER_ID) as Enemy;
    expect(exiting.state).toBe('flee');
    expect(exiting.fleeUntil).toBe(Number.POSITIVE_INFINITY);

    // It keeps leaving: never back to chase or attack, never charging or firing, and it gets
    // further from the player every step until it is past the edge and removed.
    let last = exiting;
    for (const s of states.slice(1)) {
      const w = byId(s, WATCHER_ID);
      if (w === undefined) break;
      expect(w.state).toBe('flee');
      expect(isExiting(w)).toBe(true);
      expect(distanceXZ(w.position, s.player.position)).toBeGreaterThan(
        distanceXZ(last.position, s.player.position),
      );
      last = w;
    }
    expect(distanceXZ(last.position, vec3())).toBeGreaterThan(state.arena.halfSize);
    expect(ofType(events, 'watcherCharging')).toEqual([]);
    expect(ofType(events, 'watcherFired')).toEqual([]);
    expect(ofType(events, 'boltFired')).toEqual([]);
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(false);
    expect(state.status).toBe('won');
    expect(state.enemies).toEqual([]);
  });

  it('the wave table in the design doc shows the design count of watchers, not the roster', () => {
    // The doc generator prints `watcherCount`, so with the flag on nothing in the table moves;
    // with it off the Watchers column reads 1 on the Last Stand while the roster fields none.
    expect(waveBeat(FINAL_WAVE).spawns.filter((s) => s.kind === 'watcher')).toHaveLength(
      WATCHERS_IN_ROSTER ? watcherCount(FINAL_WAVE) : 0,
    );
  });
});
