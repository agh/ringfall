import { describe, expect, it } from 'vitest';
import { BARK_LINES, createEnemy, FLEE_DURATION } from '../../src/core/enemy';
import {
  CROUCH_EYE_DROP,
  createGame,
  type GameEvent,
  type GameState,
  IDLE_INPUT,
  type InputFrame,
  lookDirection,
  PLAYER_EYE_HEIGHT,
  PLAYER_JUMP_SPEED,
  playerEye,
  SECRET_SCORE,
  STARTING_GRENADES,
  stepGame,
  TABLEAU_DURATION,
  TABLEAU_SLOW_SECONDS,
  TABLEAU_TIME_SCALE,
  TAUNT_BARK,
  TAUNT_RADIUS,
  TAUNT_WINDOW,
  timeScaleOf,
} from '../../src/core/game';

import { createPickup, PICKUP_KINDS, WAVE_REWARD_DISTANCE } from '../../src/core/pickups';
import { createRng } from '../../src/core/rng';
import { distanceXZ, vec3 } from '../../src/core/vec3';
import { WATCHER_CHARGE, WATCHER_COOLDOWN, WATCHER_STATS } from '../../src/core/watcher';
import {
  DROP_POD_LEAD,
  FINAL_WAVE,
  LEADER_STRIDER_DELAY,
  WAVE_COUNTDOWN,
  waveBeat,
  waveComposition,
} from '../../src/core/waves';
import { createWeapon, type WeaponKind } from '../../src/core/weapon';
import { aabbFromCenter, placeSecret, SECRET_RADIUS } from '../../src/core/world';

const DT = 1 / 60;

const run = (
  state: GameState,
  input: InputFrame,
  seconds: number,
  seed = 1,
): { state: GameState; events: GameEvent[] } => {
  const rng = createRng(seed);
  const events: GameEvent[] = [];
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    s = stepGame(s, input, DT, rng);
    events.push(...s.events);
  }
  return { state: s, events };
};

/** A game whose arena has no cover, so movement tests are not blocked by random geometry. */
const openGame = (): GameState => {
  const g = createGame({ seed: 1 });
  return { ...g, arena: { ...g.arena, obstacles: [] } };
};

/** An open, active game with the player holding `kind` and the given enemies already awake. */
const armedWith = (kind: WeaponKind, enemies: GameState['enemies']): GameState => {
  const base = openGame();
  const weapon = createWeapon(kind);
  return {
    ...base,
    enemies,
    wave: { ...base.wave, phase: 'active' },
    player: { ...base.player, weapon, weapons: [weapon, null] },
  };
};

const awake = (id: number, kind: 'skimmer' | 'strider', at: ReturnType<typeof vec3>) => ({
  ...createEnemy(id, kind, at, 0),
  state: (kind === 'skimmer' ? 'chase' : 'attack') as 'chase' | 'attack',
});

/** Pitch that puts the reticle on an enemy centre `dist` metres ahead at height `y`. */
const pitchTo = (y: number, dist: number): number => Math.atan2(y - 1.7, dist);

describe('game', () => {
  it('starts in a countdown with a full loadout', () => {
    const g = createGame({ seed: 3 });
    expect(g.status).toBe('playing');
    expect(g.wave.phase).toBe('countdown');
    expect(g.player.grenades).toBe(STARTING_GRENADES);
    expect(g.player.weapon.kind).toBe('rifle');
    expect(g.player.weapons).toEqual([g.player.weapon, null]);
    expect(g.player.activeSlot).toBe(0);
    expect(g.pickups).toEqual([]);
    expect(g.player.vitality.shield).toBe(100);
    expect(playerEye(g.player).y).toBeCloseTo(1.7);
    expect(lookDirection(g.player).z).toBeCloseTo(-1);
  });

  it('spawns the first wave by drop pod after the countdown', () => {
    const { state, events } = run(createGame({ seed: 2 }), IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
    expect(state.wave.phase).toBe('active');
    expect(state.enemies.length).toBe(3);
    expect(state.pendingSpawns).toEqual([]);
    const started = events.find((e) => e.type === 'waveStarted');
    expect(started).toEqual({ type: 'waveStarted', number: 1, name: 'Scouts' });
    const pods = events.filter((e) => e.type === 'dropPod');
    expect(pods).toHaveLength(3);
    for (const pod of pods) {
      if (pod.type !== 'dropPod') continue;
      const enemy = state.enemies.find((e) => e.id === pod.id);
      expect(enemy?.kind).toBe(pod.kind);
      expect(enemy?.position).toEqual(pod.at);
      expect(enemy?.activeAt).toBeCloseTo(pod.activeAt);
      expect(pod.leader).toBe(false);
      // The pod is announced DROP_POD_LEAD before the enemy can act; it is invulnerable until then.
      expect(pod.activeAt - (state.time - 0.1)).toBeCloseTo(DROP_POD_LEAD, 1);
    }
    expect(state.enemies.every((e) => e.state === 'spawning')).toBe(true);
  });

  it("lands The Leader's strider four seconds after its skimmers", () => {
    const base = openGame();
    const leader: GameState = {
      ...base,
      wave: { number: 2, phase: 'countdown', phaseEndsAt: base.time + WAVE_COUNTDOWN },
    };
    const early = run(leader, IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
    expect(early.events.find((e) => e.type === 'waveStarted')).toEqual({
      type: 'waveStarted',
      number: 2,
      name: 'The Leader',
    });
    expect(early.state.enemies.map((e) => e.kind)).toEqual([
      'skimmer',
      'skimmer',
      'skimmer',
      'skimmer',
    ]);
    expect(early.state.pendingSpawns).toHaveLength(1);
    expect(early.state.pendingSpawns[0]?.spawn.kind).toBe('strider');
    expect(early.state.pendingSpawns[0]?.dropAt).toBeCloseTo(
      WAVE_COUNTDOWN + LEADER_STRIDER_DELAY,
      1,
    );
    // Killing the skimmers does not clear the wave while the strider is still inbound.
    const skimmersDown: GameState = {
      ...early.state,
      enemies: early.state.enemies.map((e) => ({ ...e, state: 'dead' as const, diedAt: 3 })),
    };
    const late = run(skimmersDown, IDLE_INPUT, LEADER_STRIDER_DELAY);
    expect(late.events.some((e) => e.type === 'waveCleared')).toBe(false);
    const pod = late.events.find((e) => e.type === 'dropPod');
    expect(pod?.type === 'dropPod' && pod.kind).toBe('strider');
    expect(late.state.enemies.filter((e) => e.kind === 'strider')).toHaveLength(1);
    expect(late.state.pendingSpawns).toEqual([]);
    expect(late.state.wave.phase).toBe('active');
  });

  it('moves the player with WASD-style input relative to yaw', () => {
    const { state } = run(openGame(), { ...IDLE_INPUT, forward: 1 }, 1);
    expect(state.player.position.z).toBeLessThan(-5);
    const turned = run(openGame(), { ...IDLE_INPUT, forward: 1, yaw: Math.PI / 2 }, 1).state;
    expect(turned.player.position.x).toBeLessThan(-5);
    const sprint = run(openGame(), { ...IDLE_INPUT, forward: 1, sprint: true }, 1).state;
    expect(sprint.player.position.z).toBeLessThan(state.player.position.z);
  });

  it('jumps and lands', () => {
    const rng = createRng(1);
    let s = stepGame(openGame(), { ...IDLE_INPUT, jump: true }, DT, rng);
    expect(s.player.onGround).toBe(false);
    expect(s.player.verticalVelocity).toBeCloseTo(PLAYER_JUMP_SPEED);
    for (let i = 0; i < 120; i += 1) s = stepGame(s, IDLE_INPUT, DT, rng);
    expect(s.player.onGround).toBe(true);
    expect(s.player.position.y).toBe(0);
  });

  it('shoots an enemy standing in front of the player', () => {
    const base = openGame();
    const enemy = { ...createEnemy(99, 'skimmer', vec3(0, 0, -8), 0), state: 'chase' as const };
    const armed: GameState = { ...base, enemies: [enemy], wave: { ...base.wave, phase: 'active' } };
    // Aim slightly down: the skimmer's centre sits below eye height.
    const pitch = Math.atan2(0.6 - 1.7, 8);
    const { state, events } = run(armed, { ...IDLE_INPUT, fire: true, pitch }, 0.5);
    const shots = events.filter((e) => e.type === 'shot');
    expect(shots.length).toBeGreaterThan(2);
    expect(shots.some((e) => e.type === 'shot' && e.hitEnemy)).toBe(true);
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(state.kills).toBe(1);
    expect(state.score).toBeGreaterThan(0);
    expect(state.player.weapon.magazine).toBeLessThan(32);
    expect(shots.every((e) => e.type === 'shot' && e.kind === 'rifle' && e.pellets === 1)).toBe(
      true,
    );
    // The slot mirrors the active weapon after every step.
    expect(state.player.weapons[state.player.activeSlot]).toBe(state.player.weapon);
  });

  it('swaps between two slots on an edge-triggered input and ignores an empty holster', () => {
    const base = openGame();
    const rifle = base.player.weapon;
    const laser = createWeapon('laser');
    const rng = createRng(1);
    const alone = stepGame(base, { ...IDLE_INPUT, swapWeapon: true }, DT, rng);
    expect(alone.player.activeSlot).toBe(0);
    expect(alone.events.some((e) => e.type === 'weaponSwapped')).toBe(false);

    const two: GameState = {
      ...base,
      player: { ...base.player, weapons: [rifle, laser], weapon: { ...rifle, spin: 0.5 } },
    };
    const swapped = stepGame(two, { ...IDLE_INPUT, swapWeapon: true }, DT, rng);
    expect(swapped.player.activeSlot).toBe(1);
    expect(swapped.player.weapon.kind).toBe('laser');
    expect(swapped.player.weapons[1]).toBe(swapped.player.weapon);
    expect(swapped.player.weapons[0]).toMatchObject({ kind: 'rifle', spin: 0 });
    expect(swapped.events).toContainEqual({ type: 'weaponSwapped', kind: 'laser', slot: 1 });
    // Holding swap does not keep flipping: the input is one event per press.
    const back = stepGame(swapped, { ...IDLE_INPUT, swapWeapon: true }, DT, rng);
    expect(back.player.activeSlot).toBe(0);
    expect(back.player.weapon.kind).toBe('rifle');
    const held = stepGame(back, IDLE_INPUT, DT, rng);
    expect(held.player.activeSlot).toBe(0);
  });

  it('laser: a single pinpoint ray that drops a skimmer in one shot', () => {
    const armed = armedWith('laser', [awake(1, 'skimmer', vec3(0, 0, -40))]);
    const pitch = pitchTo(0.6, 40);
    const { state, events } = run(armed, { ...IDLE_INPUT, fire: true, pitch }, 0.05);
    const shots = events.filter((e) => e.type === 'shot');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ kind: 'laser', pellets: 1, hitEnemy: true });
    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(state.player.weapon.magazine).toBe(11);
  });

  it('scatter: eight pellets per pull that shred up close and tickle at range', () => {
    const close = armedWith('scatter', [awake(1, 'skimmer', vec3(0, 0, -4))]);
    const near = run(close, { ...IDLE_INPUT, fire: true, pitch: pitchTo(0.6, 4) }, 0.05);
    const shot = near.events.find((e) => e.type === 'shot');
    expect(shot).toMatchObject({ kind: 'scatter', pellets: 8, hitEnemy: true });
    expect(near.events.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(near.state.player.weapon.magazine).toBe(5);

    const far = armedWith('scatter', [awake(2, 'strider', vec3(0, 0, -13))]);
    const long = run(far, { ...IDLE_INPUT, fire: true, pitch: pitchTo(1.3, 13) }, 0.05);
    const strider = long.state.enemies.find((e) => e.id === 2);
    expect(strider).toBeDefined();
    // At 13 m each pellet carries well under its 14 damage, so eight cannot do 112.
    expect(strider?.health).toBeGreaterThan(120 - 8 * 14 * 0.5);
    expect(strider?.health).toBeLessThan(120);
  });

  it('beam: holds a charge, fires on release, and cuts through every enemy on the line', () => {
    const armed = armedWith('beam', [
      awake(1, 'strider', vec3(0, 0, -8)),
      awake(2, 'strider', vec3(0, 0, -14)),
    ]);
    const pitch = pitchTo(1.3, 8);
    const held = run(armed, { ...IDLE_INPUT, fire: true, pitch }, 1);
    expect(held.events.filter((e) => e.type === 'chargeStarted')).toEqual([
      { type: 'chargeStarted', kind: 'beam' },
    ]);
    expect(held.state.player.weapon.charge).toBe(1);
    expect(held.events.some((e) => e.type === 'shot')).toBe(false);
    expect(held.state.player.weapon.magazine).toBe(4);

    const released = run(held.state, { ...IDLE_INPUT, pitch }, 0.05);
    expect(released.events).toContainEqual({ type: 'chargeReleased', kind: 'beam', charge: 1 });
    const beam = released.events.find((e) => e.type === 'beamFired');
    expect(beam).toMatchObject({ hits: 2 });
    expect(released.events.find((e) => e.type === 'shot')).toMatchObject({
      kind: 'beam',
      pellets: 1,
      hitEnemy: true,
    });
    expect(released.events.filter((e) => e.type === 'enemyKilled')).toHaveLength(2);
    expect(released.state.player.weapon.magazine).toBe(3);
    expect(released.state.player.weapon.charge).toBe(0);

    // Letting go early wastes nothing and fires nothing.
    const early = run(armedWith('beam', []), { ...IDLE_INPUT, fire: true }, 0.3);
    const dropped = run(early.state, IDLE_INPUT, DT);
    expect(dropped.events.some((e) => e.type === 'beamFired')).toBe(false);
    expect(dropped.events.find((e) => e.type === 'chargeReleased')).toMatchObject({
      charge: expect.closeTo(0.3 / 0.8, 1),
    });
  });

  it('minigun: fires slowly until it spins up, then at full rate, and cannot reload', () => {
    const armed = armedWith('minigun', []);
    const first = run(armed, { ...IDLE_INPUT, fire: true }, 0.5);
    const slow = first.events.filter((e) => e.type === 'shot').length;
    const second = run(first.state, { ...IDLE_INPUT, fire: true }, 0.5);
    const fast = second.events.filter((e) => e.type === 'shot').length;
    expect(first.state.player.weapon.spin).toBeCloseTo(1);
    expect(fast).toBeGreaterThan(slow * 1.5);
    expect(fast).toBeGreaterThanOrEqual(10);
    expect(second.state.player.weapon.magazine).toBe(120 - slow - fast);
    const reload = run(second.state, { ...IDLE_INPUT, reload: true }, DT);
    expect(reload.events.some((e) => e.type === 'reload')).toBe(false);
  });

  it('launcher: lobs a round that bursts on the floor and hurts a strider nearby', () => {
    const armed = armedWith('launcher', [awake(1, 'strider', vec3(0, 0, -12))]);
    const rng = createRng(1);
    let s = stepGame(armed, { ...IDLE_INPUT, fire: true }, DT, rng);
    expect(s.events.some((e) => e.type === 'launcherFired')).toBe(true);
    expect(s.events.some((e) => e.type === 'shot')).toBe(false);
    expect(s.grenades).toHaveLength(1);
    expect(s.grenades[0]?.kind).toBe('round');
    expect(s.player.weapon.magazine).toBe(2);
    const events: GameEvent[] = [];
    for (let i = 0; i < 60; i += 1) {
      s = stepGame(s, IDLE_INPUT, DT, rng);
      events.push(...s.events);
    }
    const blast = events.find((e) => e.type === 'explosion');
    expect(blast).toBeDefined();
    if (blast?.type === 'explosion') {
      expect(blast.at.y).toBe(0);
      expect(blast.at.z).toBeLessThan(-9);
    }
    expect(s.grenades).toHaveLength(0);
    const strider = s.enemies.find((e) => e.id === 1);
    expect(strider === undefined || strider.health < 120).toBe(true);
  });

  it('takes a pickup by walking over it: an empty slot fills, a full one is replaced', () => {
    const base = openGame();
    const start: GameState = {
      ...base,
      pickups: [createPickup(50, 'laser', vec3(0, 0, -2), 0)],
    };
    const first = run(start, { ...IDLE_INPUT, forward: 1 }, 0.4);
    expect(first.events).toContainEqual({ type: 'pickupTaken', id: 50, kind: 'laser', slot: 1 });
    expect(first.state.pickups).toHaveLength(0);
    expect(first.state.player.activeSlot).toBe(1);
    expect(first.state.player.weapon.kind).toBe('laser');
    expect(first.state.player.weapons[0]?.kind).toBe('rifle');

    const again: GameState = {
      ...first.state,
      pickups: [createPickup(51, 'beam', first.state.player.position, first.state.time)],
    };
    const second = run(again, IDLE_INPUT, DT);
    expect(second.events).toContainEqual({ type: 'pickupTaken', id: 51, kind: 'beam', slot: 1 });
    expect(second.state.player.weapons.map((w) => w?.kind)).toEqual(['rifle', 'beam']);
    expect(second.state.player.weapon.kind).toBe('beam');
    expect(second.state.pickups).toHaveLength(0);
  });

  it('expires pickups that nobody collects', () => {
    const base = openGame();
    const start: GameState = {
      ...base,
      pickups: [createPickup(60, 'scatter', vec3(10, 0, 10), -19.5)],
    };
    const { state, events } = run(start, IDLE_INPUT, 1);
    expect(events).toContainEqual({ type: 'pickupExpired', id: 60 });
    expect(state.pickups).toHaveLength(0);
  });

  it('drops weapons from kills with the seeded rng', () => {
    const striders = Array.from({ length: 6 }, (_, i) =>
      awake(20 + i, 'strider', vec3(0, 0, -6 - i * 2)),
    );
    const armed = armedWith('beam', striders);
    const pitch = pitchTo(1.3, 6);
    const held = run(armed, { ...IDLE_INPUT, fire: true, pitch }, 1);
    const { state, events } = run(held.state, { ...IDLE_INPUT, pitch }, DT);
    const kills = events.filter((e) => e.type === 'enemyKilled').length;
    expect(kills).toBeGreaterThanOrEqual(4);
    const drops = events.filter((e) => e.type === 'pickupSpawned');
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(drops.length).toBeLessThanOrEqual(kills);
    for (const d of drops) {
      if (d.type !== 'pickupSpawned') continue;
      expect(d.kind).not.toBe('beam');
      expect(d.kind).not.toBe('rifle');
      expect(PICKUP_KINDS).toContain(d.kind);
      expect(state.pickups.find((p) => p.id === d.id)?.position).toEqual(d.at);
    }
  });

  it('reports an empty magazine and reloads on request', () => {
    const base = openGame();
    const dry: GameState = {
      ...base,
      player: { ...base.player, weapon: { ...base.player.weapon, magazine: 0 } },
    };
    const empty = run(dry, { ...IDLE_INPUT, fire: true }, 0.1);
    expect(empty.events.some((e) => e.type === 'empty')).toBe(true);
    const reload = run(dry, { ...IDLE_INPUT, reload: true }, 2.5);
    expect(reload.events.filter((e) => e.type === 'reload')).toHaveLength(1);
    expect(reload.state.player.weapon.magazine).toBe(32);
  });

  it('throws a grenade that explodes and damages nearby enemies', () => {
    const base = openGame();
    const enemy = { ...createEnemy(5, 'strider', vec3(0, 0, -14), 0), state: 'attack' as const };
    const armed: GameState = {
      ...base,
      enemies: [enemy],
      wave: { ...base.wave, phase: 'active' },
      player: { ...base.player, pitch: 0.35 },
    };
    const rng = createRng(1);
    let s = stepGame(armed, { ...IDLE_INPUT, throwGrenade: true, pitch: 0.35 }, DT, rng);
    expect(s.player.grenades).toBe(STARTING_GRENADES - 1);
    expect(s.grenades).toHaveLength(1);
    const events: GameEvent[] = [];
    for (let i = 0; i < 60 * 3; i += 1) {
      s = stepGame(s, { ...IDLE_INPUT, pitch: 0.35 }, DT, rng);
      events.push(...s.events);
    }
    expect(events.some((e) => e.type === 'explosion')).toBe(true);
    expect(s.grenades).toHaveLength(0);
    const target = s.enemies.find((e) => e.id === 5);
    expect(target === undefined || target.health < 120).toBe(true);
  });

  it('lets enemies hurt the player, break the shield, and eventually kill them', () => {
    const base = openGame();
    const enemies = Array.from({ length: 6 }, (_, i) =>
      createEnemy(10 + i, 'skimmer', vec3(0.5 * i, 0, -1.5), 0),
    );
    const swarmed: GameState = { ...base, enemies, wave: { ...base.wave, phase: 'active' } };
    const { state, events } = run(swarmed, IDLE_INPUT, 20);
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(true);
    expect(events.some((e) => e.type === 'shieldBroken')).toBe(true);
    expect(events.some((e) => e.type === 'playerDied')).toBe(true);
    expect(state.status).toBe('dead');
    // A finished game is frozen.
    const frozen = stepGame(state, { ...IDLE_INPUT, forward: 1 }, DT, createRng(1));
    expect(frozen.player.position).toEqual(state.player.position);
    expect(frozen.events).toHaveLength(0);
  });

  it('routs the skimmers near a dying strider, and only those, for four seconds', () => {
    // A strider with one hit point 8 m ahead; a skimmer 6 m from it and another 38 m away.
    const strider = { ...awake(1, 'strider', vec3(0, 0, -8)), health: 1 };
    const near = awake(2, 'skimmer', vec3(6, 0, -8));
    const far = awake(3, 'skimmer', vec3(-26, 0, 20));
    const state = armedWith('rifle', [strider, near, far]);
    const pitch = pitchTo(1.3, 8);
    const kill = run(state, { ...IDLE_INPUT, fire: true, pitch }, 0.1);
    const killed = kill.events.filter((e) => e.type === 'enemyKilled');
    expect(killed).toEqual([expect.objectContaining({ id: 1 })]);
    const fled = kill.events.filter((e) => e.type === 'enemyFled');
    expect(fled).toEqual([{ type: 'enemyFled', id: 2, kind: 'skimmer' }]);
    const barks = kill.events.filter((e) => e.type === 'enemyBark');
    expect(barks).toEqual([{ type: 'enemyBark', id: 2, line: BARK_LINES[0] }]);
    // The rout is announced after the kill, in the same step.
    expect(kill.events.indexOf(fled[0] as GameEvent)).toBeGreaterThan(
      kill.events.indexOf(killed[0] as GameEvent),
    );
    const byId = (s: GameState, id: number) => s.enemies.find((e) => e.id === id);
    expect(byId(kill.state, 2)?.state).toBe('flee');
    expect(byId(kill.state, 3)?.state).toBe('chase');
    expect(byId(kill.state, 3)?.fleeUntil).toBeNull();

    // Hold fire: the near skimmer runs for the whole rout, then comes back.
    const mid = run(kill.state, IDLE_INPUT, FLEE_DURATION - 0.2);
    const runner = byId(mid.state, 2);
    expect(runner?.state).toBe('flee');
    expect(distanceXZ(runner?.position ?? vec3(), mid.state.player.position)).toBeGreaterThan(
      distanceXZ(near.position, state.player.position),
    );
    expect(mid.events.some((e) => e.type === 'playerDamaged')).toBe(false);
    const after = run(mid.state, IDLE_INPUT, 0.4);
    expect(byId(after.state, 2)?.state).not.toBe('flee');
    expect(byId(after.state, 2)?.fleeUntil).toBeNull();
  });

  it('does not rout anyone for a skimmer kill, and barks once per routed skimmer', () => {
    const skimmer = { ...awake(1, 'skimmer', vec3(0, 0, -8)), health: 1 };
    const pack = [awake(2, 'skimmer', vec3(4, 0, -12)), awake(3, 'skimmer', vec3(-4, 0, -12))];
    const skimmerKill = run(
      armedWith('rifle', [skimmer, ...pack]),
      { ...IDLE_INPUT, fire: true, pitch: pitchTo(0.6, 8) },
      0.1,
    );
    expect(skimmerKill.events.some((e) => e.type === 'enemyKilled' && e.id === 1)).toBe(true);
    expect(skimmerKill.events.some((e) => e.type === 'enemyFled')).toBe(false);
    expect(skimmerKill.events.some((e) => e.type === 'enemyBark')).toBe(false);

    const strider = { ...awake(1, 'strider', vec3(0, 0, -8)), health: 1 };
    const striderKill = run(
      armedWith('rifle', [strider, ...pack]),
      { ...IDLE_INPUT, fire: true, pitch: pitchTo(1.3, 8) },
      0.1,
    );
    const fled = striderKill.events.filter((e) => e.type === 'enemyFled').map((e) => e.id);
    expect(fled.sort()).toEqual([2, 3]);
    const barks = striderKill.events.filter((e) => e.type === 'enemyBark');
    expect(barks.map((e) => e.id).sort()).toEqual([2, 3]);
    for (const b of barks) expect(BARK_LINES).toContain(b.line);
  });

  it('spawns bolts from striders that can hit the player', () => {
    const base = openGame();
    const strider = { ...createEnemy(7, 'strider', vec3(0, 0, -10), 0), state: 'attack' as const };
    const armed: GameState = {
      ...base,
      enemies: [strider],
      wave: { ...base.wave, phase: 'active' },
    };
    const { events } = run(armed, IDLE_INPUT, 6);
    expect(events.some((e) => e.type === 'boltFired')).toBe(true);
    expect(events.some((e) => e.type === 'playerDamaged')).toBe(true);
  });

  it('a watcher kills a stationary player in the open in the expected time, and cover saves them', () => {
    const base = openGame();
    const watcher = { ...createEnemy(8, 'watcher', vec3(0, 0, -28), 0), state: 'chase' as const };
    const exposed: GameState = {
      ...base,
      enemies: [watcher],
      wave: { ...base.wave, phase: 'active' },
    };
    // 200 points of shield and health at 35 per beam is at least six beams: the first lands
    // after the spawn-set attack delay plus the 1.2 s charge, the rest every charge-plus-cooldown.
    // The cycle is longer than the shield's recharge delay, so the shield claws back part of each
    // beam and a lone watcher needs more beams than the floor; it still gets there.
    const floorBeams = Math.ceil(200 / WATCHER_STATS.damage);
    const cycle = WATCHER_CHARGE + WATCHER_COOLDOWN;
    const earliest = watcher.nextAttackAt + WATCHER_CHARGE + (floorBeams - 1) * cycle;
    const { state, events } = run(exposed, IDLE_INPUT, 90);
    expect(state.status).toBe('dead');
    const fired = events.filter((e) => e.type === 'watcherFired');
    expect(fired.length).toBeGreaterThanOrEqual(floorBeams);
    expect(fired.every((e) => e.type === 'watcherFired' && e.hit)).toBe(true);
    expect(events.filter((e) => e.type === 'watcherCharging')).toHaveLength(fired.length);
    // The beam borrows the strider bolt sound until it has its own.
    expect(events.filter((e) => e.type === 'boltFired')).toHaveLength(fired.length);
    const damage = events.filter((e) => e.type === 'playerDamaged');
    expect(damage).toHaveLength(fired.length);
    expect(events.some((e) => e.type === 'playerDied')).toBe(true);
    expect(state.time).toBeGreaterThanOrEqual(earliest);
    expect(state.time).toBeLessThan(90);

    // Wide enough that the watcher's slow orbit cannot find a line past it inside the run.
    const wall = aabbFromCenter(0, -4, 30, 4, 1);
    const sheltered: GameState = { ...exposed, arena: { ...exposed.arena, obstacles: [wall] } };
    const safe = run(sheltered, IDLE_INPUT, 30);
    expect(safe.state.status).toBe('playing');
    expect(safe.events.some((e) => e.type === 'playerDamaged')).toBe(false);
    expect(safe.events.some((e) => e.type === 'watcherCharging')).toBe(false);
    expect(safe.state.player.vitality.shield).toBe(100);
  });

  it('clears a wave, awards the bonus, and advances', () => {
    const base = openGame();
    const started = run(base, IDLE_INPUT, WAVE_COUNTDOWN + 0.1).state;
    const cleared: GameState = {
      ...started,
      enemies: started.enemies.map((e) => ({ ...e, state: 'dead' as const, diedAt: started.time })),
    };
    const { state, events } = run(cleared, IDLE_INPUT, 6);
    expect(events.some((e) => e.type === 'waveCleared')).toBe(true);
    expect(state.wave.number).toBe(2);
    expect(state.score).toBeGreaterThanOrEqual(500);
    expect(state.enemies.length).toBeGreaterThan(0);
    // Wave 2 onwards starts with a reward pickup six metres ahead of the player.
    const reward = events.find((e) => e.type === 'pickupSpawned');
    expect(reward).toBeDefined();
    if (reward?.type === 'pickupSpawned') {
      expect(PICKUP_KINDS).toContain(reward.kind);
      expect(distanceXZ(reward.at, state.player.position)).toBeCloseTo(WAVE_REWARD_DISTANCE);
      expect(reward.at.z).toBeCloseTo(-WAVE_REWARD_DISTANCE);
    }
    expect(state.pickups).toHaveLength(1);
  });

  it('places no reward on the first wave', () => {
    const { events } = run(createGame({ seed: 2 }), IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
    expect(events.some((e) => e.type === 'pickupSpawned')).toBe(false);
  });

  it('spawns the Last Stand with one armoured leader at triple health', () => {
    const base = openGame();
    const last: GameState = {
      ...base,
      wave: { number: FINAL_WAVE, phase: 'countdown', phaseEndsAt: base.time + WAVE_COUNTDOWN },
    };
    const { state, events } = run(last, IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
    expect(events.find((e) => e.type === 'waveStarted')).toEqual({
      type: 'waveStarted',
      number: FINAL_WAVE,
      name: 'Last Stand',
    });
    expect(state.enemies).toHaveLength(waveBeat(FINAL_WAVE).spawns.length);
    const leaders = state.enemies.filter((e) => e.leader);
    expect(leaders).toHaveLength(1);
    expect(leaders[0]?.kind).toBe('strider');
    expect(leaders[0]?.health).toBe(360);
    expect(leaders[0]?.maxHealth).toBe(360);
    const pods = events.filter((e) => e.type === 'dropPod' && e.leader);
    expect(pods).toHaveLength(1);
  });

  it('ends the final wave when the leader falls: the survivors flee and the tableau holds', () => {
    const base = openGame();
    const leader = {
      ...createEnemy(50, 'strider', vec3(0, 0, -12), 0, { healthScale: 3, leader: true }),
      state: 'attack' as const,
    };
    const survivor = awake(51, 'skimmer', vec3(6, 0, -4));
    const final: GameState = {
      ...base,
      enemies: [leader, survivor],
      kills: 30,
      shieldBreaks: 2,
      wave: { number: FINAL_WAVE, phase: 'active', phaseEndsAt: 0 },
    };
    // The leader is still up: the wave carries on and the player can be hurt.
    const fighting = run(final, IDLE_INPUT, 2);
    expect(fighting.state.status).toBe('playing');
    expect(fighting.state.tableau).toBeNull();
    expect(fighting.events.some((e) => e.type === 'victory')).toBe(false);
    expect(fighting.events.some((e) => e.type === 'playerDamaged')).toBe(true);

    const leaderDown: GameState = {
      ...final,
      enemies: [{ ...leader, state: 'dead', health: 0, diedAt: 0 }, survivor],
    };
    const won = run(leaderDown, IDLE_INPUT, 0.5);
    const victory = won.events.find((e) => e.type === 'victory');
    expect(victory).toEqual({ type: 'victory', kills: 30, shieldBreaks: 2 });
    expect(won.state.wave.phase).toBe('won');
    expect(won.state.status).toBe('playing');
    expect(won.state.tableau).not.toBeNull();
    expect(won.state.score).toBe(500);
    const fleeing = won.state.enemies.find((e) => e.id === 51);
    expect(fleeing?.state).toBe('flee');
    expect(fleeing?.fleeUntil).toBe(Number.POSITIVE_INFINITY);
    expect(distanceXZ(fleeing?.position ?? vec3(), won.state.player.position)).toBeGreaterThan(
      distanceXZ(survivor.position, final.player.position),
    );
    // Slow motion for the opening of the tableau, then normal speed.
    const opened = stepGame(leaderDown, IDLE_INPUT, DT, createRng(1));
    expect(opened.tableau?.startedAt).toBeCloseTo(DT);
    expect(timeScaleOf(opened)).toBe(TABLEAU_TIME_SCALE);
    expect(timeScaleOf({ ...opened, time: DT + TABLEAU_SLOW_SECONDS * TABLEAU_TIME_SCALE })).toBe(
      1,
    );
    expect(timeScaleOf(final)).toBe(1);
    // Input is ignored and the player cannot be hurt while the tableau holds.
    const held = run(won.state, { ...IDLE_INPUT, forward: 1, fire: true, yaw: 1 }, 1);
    expect(held.state.player.position).toEqual(won.state.player.position);
    expect(held.state.player.yaw).toBe(won.state.player.yaw);
    expect(held.events.some((e) => e.type === 'shot')).toBe(false);
    expect(held.events.some((e) => e.type === 'playerDamaged')).toBe(false);
    // The tableau ends after TABLEAU_DURATION with the survivors gone and the run won.
    const ended = run(won.state, IDLE_INPUT, TABLEAU_DURATION);
    expect(ended.state.status).toBe('won');
    expect(ended.state.enemies.filter((e) => e.state === 'flee')).toEqual([]);
    expect(stepGame(ended.state, IDLE_INPUT, DT, createRng(1)).events).toEqual([]);
  });

  it('counts shield breaks for the tableau', () => {
    const g = createGame({ seed: 4 });
    expect(g.shieldBreaks).toBe(0);
    const swarm = Array.from({ length: 4 }, (_, i) =>
      awake(60 + i, 'skimmer', vec3(i - 1.5, 0, -1.5)),
    );
    const base = openGame();
    const swarmed: GameState = { ...base, enemies: swarm, wave: { ...base.wave, phase: 'active' } };
    const { state, events } = run(swarmed, IDLE_INPUT, 8);
    const breaks = events.filter((e) => e.type === 'shieldBroken').length;
    expect(breaks).toBeGreaterThan(0);
    expect(state.shieldBreaks).toBe(breaks);
  });

  it('keeps a death that lands in the same step as the last kill', () => {
    // A grenade at the player's feet kills the last wave-8 skimmer and the one-health player
    // in one step. The wave stage runs last; without a guard it overwrote dead with won.
    const base = armedWith('rifle', [awake(1, 'skimmer', vec3(0, 0, -3))]);
    const doomed: GameState = {
      ...base,
      wave: { number: 8, phase: 'active', phaseEndsAt: 0 },
      player: { ...base.player, vitality: { ...base.player.vitality, shield: 0, health: 1 } },
      grenades: [{ id: 99, position: vec3(0, 0, -2), velocity: vec3(0, 0, 0), explodeAt: 0 }],
    };
    const { state, events } = run(doomed, IDLE_INPUT, DT);
    expect(events.map((e) => e.type)).toContain('playerDied');
    expect(events.map((e) => e.type)).not.toContain('victory');
    expect(state.status).toBe('dead');
  });

  it('blasts spare a spawning enemy, as shots do', () => {
    const base = armedWith('rifle', [createEnemy(1, 'skimmer', vec3(0, 0, -3), 0)]);
    expect(base.enemies[0]?.state).toBe('spawning');
    const primed: GameState = {
      ...base,
      grenades: [{ id: 99, position: vec3(0, 0, -3), velocity: vec3(0, 0, 0), explodeAt: 0 }],
    };
    const { state } = run(primed, IDLE_INPUT, DT);
    expect(state.enemies[0]?.health).toBe(base.enemies[0]?.health);
    expect(state.enemies[0]?.state).toBe('spawning');
  });

  describe('easter eggs', () => {
    const rng = createRng(1);

    it('hands skimmers the four temperaments round-robin per wave', () => {
      const { state } = run(createGame({ seed: 2 }), IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
      const skimmers = state.enemies.filter((e) => e.kind === 'skimmer');
      expect(skimmers.length).toBe(waveComposition(1).filter((k) => k === 'skimmer').length);
      expect(skimmers.map((e) => e.temperament)).toEqual(['chaser', 'ambusher', 'flanker']);
      expect(state.enemies.every((e) => e.kind === 'skimmer' || e.temperament === 'chaser')).toBe(
        true,
      );
    });

    it('tracks the player velocity the ambusher leads', () => {
      const { state } = run(openGame(), { ...IDLE_INPUT, forward: 1 }, 0.5);
      expect(state.player.velocity.z).toBeCloseTo(-6);
      expect(state.player.velocity.x).toBeCloseTo(0);
      const stopped = stepGame(state, IDLE_INPUT, DT, rng);
      expect(stopped.player.velocity.z).toBeCloseTo(0);
    });

    it('crouching lowers the eye by 0.6 m and standing restores it', () => {
      const crouched = stepGame(openGame(), { ...IDLE_INPUT, crouch: true }, DT, rng);
      expect(crouched.player.crouching).toBe(true);
      expect(playerEye(crouched.player).y).toBeCloseTo(PLAYER_EYE_HEIGHT - CROUCH_EYE_DROP);
      expect(playerEye(crouched.player).y).toBeCloseTo(1.1);
      expect(crouched.player.position.y).toBe(0);
      const stood = stepGame(crouched, IDLE_INPUT, DT, rng);
      expect(stood.player.crouching).toBe(false);
      expect(playerEye(stood.player).y).toBeCloseTo(PLAYER_EYE_HEIGHT);
    });

    it('shots leave from the crouched eye', () => {
      const armed = armedWith('rifle', []);
      const s = stepGame(armed, { ...IDLE_INPUT, crouch: true, fire: true }, DT, rng);
      const shot = s.events.find((e) => e.type === 'shot');
      expect(shot?.type === 'shot' && shot.from.y).toBeCloseTo(1.1);
    });

    /** Steps `state` through `pattern`, one entry per step, crouching where it is true. */
    const crouchPattern = (
      state: GameState,
      pattern: readonly boolean[],
    ): { state: GameState; events: GameEvent[] } => {
      const events: GameEvent[] = [];
      let s = state;
      for (const crouch of pattern) {
        s = stepGame(s, { ...IDLE_INPUT, crouch }, DT, rng);
        events.push(...s.events);
      }
      return { state: s, events };
    };
    /** `n` crouch toggles spread over `seconds`, as step-by-step input. */
    const toggles = (n: number, seconds: number): boolean[] => {
      const steps = Math.round(seconds / DT);
      const gap = Math.floor(steps / n);
      return Array.from({ length: steps }, (_, i) => Math.floor(i / gap) < n && i % gap < gap / 2);
    };
    const graveSide = (skimmerAt: ReturnType<typeof vec3>): GameState => {
      const base = armedWith('rifle', [awake(7, 'skimmer', skimmerAt)]);
      return { ...base, graves: [vec3(1, 0, 0)] };
    };

    it('three crouches within 1.5 s over a fallen strider earn a bark from a survivor', () => {
      const { state, events } = crouchPattern(graveSide(vec3(0, 0, -20)), toggles(3, 1.2));
      const barks = events.filter((e) => e.type === 'enemyBark');
      expect(barks).toEqual([{ type: 'enemyBark', id: 7, line: TAUNT_BARK }]);
      expect(TAUNT_BARK).toBe('DISRESPECTFUL');
      // The history resets: holding the crouch afterwards does not bark again.
      expect(state.player.crouchStarts).toEqual([]);
      const more = crouchPattern(state, toggles(2, 0.8));
      expect(more.events.some((e) => e.type === 'enemyBark')).toBe(false);
    });

    it('stays quiet with too few toggles, too slow, away from a grave, or with no witness', () => {
      expect(crouchPattern(graveSide(vec3(0, 0, -20)), toggles(2, 1.2)).events).not.toContainEqual(
        expect.objectContaining({ type: 'enemyBark' }),
      );
      const slow = crouchPattern(graveSide(vec3(0, 0, -20)), toggles(3, TAUNT_WINDOW * 2.2));
      expect(slow.events.some((e) => e.type === 'enemyBark')).toBe(false);
      const far: GameState = {
        ...graveSide(vec3(0, 0, -20)),
        graves: [vec3(TAUNT_RADIUS + 1, 0, 0)],
      };
      expect(crouchPattern(far, toggles(3, 1.2)).events.some((e) => e.type === 'enemyBark')).toBe(
        false,
      );
      const noGrave: GameState = { ...graveSide(vec3(0, 0, -20)), graves: [] };
      expect(
        crouchPattern(noGrave, toggles(3, 1.2)).events.some((e) => e.type === 'enemyBark'),
      ).toBe(false);
      const witnessless: GameState = { ...graveSide(vec3(0, 0, -20)), enemies: [] };
      const quiet = crouchPattern(witnessless, toggles(3, 1.2));
      expect(quiet.events.some((e) => e.type === 'enemyBark')).toBe(false);
      // The taunt is spent even without a witness; it is the act that counts.
      expect(quiet.state.player.crouchStarts).toEqual([]);
    });

    it('records where striders fall', () => {
      const strider = awake(5, 'strider', vec3(0, 0, -8));
      const armed = armedWith('laser', [{ ...strider, health: 1 }]);
      const pitch = pitchTo(1.3, 8);
      const { state } = run(armed, { ...IDLE_INPUT, fire: true, pitch }, 0.2);
      expect(state.graves).toEqual([vec3(0, 0, -8)]);
      // Skimmer deaths leave no grave.
      const skim = armedWith('laser', [{ ...awake(6, 'skimmer', vec3(0, 0, -8)), health: 1 }]);
      const after = run(skim, { ...IDLE_INPUT, fire: true, pitch: pitchTo(0.6, 8) }, 0.2).state;
      expect(after.kills).toBe(1);
      expect(after.graves).toEqual([]);
    });

    it('shooting the hidden switch scores 1000 once and announces it', () => {
      const block = aabbFromCenter(0, -12, 2, 3, 2);
      const secret = placeSecret([block], createRng(1));
      expect(secret).toEqual({ at: vec3(0, 1, -13), normal: vec3(0, 0, -1) });
      const base = armedWith('laser', []);
      const armed: GameState = {
        ...base,
        arena: { ...base.arena, obstacles: [block], secret },
        player: { ...base.player, position: vec3(0, 0, -18), yaw: Math.PI },
      };
      // The player stands on the far side of the block, looking back at its hidden face.
      const pitch = Math.atan2(1 - 1.7, 5);
      const look = { ...IDLE_INPUT, fire: true, pitch, yaw: Math.PI };
      const { state, events } = run(armed, look, 1);
      const found = events.filter((e) => e.type === 'secretFound');
      expect(found).toEqual([{ type: 'secretFound', at: vec3(0, 1, -13), score: SECRET_SCORE }]);
      expect(state.secretsFound).toBe(1);
      expect(state.score).toBeGreaterThanOrEqual(SECRET_SCORE);
      expect(events.filter((e) => e.type === 'shot').length).toBeGreaterThan(1);
    });

    it('the switch does not trip through its block, past the glyph, or in an open arena', () => {
      const block = aabbFromCenter(0, -12, 2, 3, 2);
      const secret = placeSecret([block], createRng(1));
      const base = armedWith('laser', []);
      const withSecret: GameState = {
        ...base,
        arena: { ...base.arena, obstacles: [block], secret },
      };
      // From the centre the glyph is behind the block; the block stops the shot first.
      const pitch = Math.atan2(1 - 1.7, 13);
      const blocked = run(withSecret, { ...IDLE_INPUT, fire: true, pitch }, 0.5);
      expect(blocked.state.secretsFound).toBe(0);
      expect(blocked.state.score).toBeLessThan(SECRET_SCORE);
      // Just wide of the glyph's radius from behind: a miss.
      const behind: GameState = {
        ...withSecret,
        player: { ...withSecret.player, position: vec3(0, 0, -18), yaw: Math.PI },
      };
      const wide = Math.atan2(SECRET_RADIUS * 1.6, 5);
      const miss = run(behind, { ...IDLE_INPUT, fire: true, pitch, yaw: Math.PI + wide }, 0.5);
      expect(miss.state.secretsFound).toBe(0);
      // No cover, no switch.
      const bare = armedWith('rifle', []);
      const open = run(
        { ...bare, arena: { ...bare.arena, secret: null } },
        { ...IDLE_INPUT, fire: true },
        0.2,
      );
      expect(open.state.secretsFound).toBe(0);
    });
  });
});
