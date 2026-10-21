import { describe, expect, it } from 'vitest';
import { createEnemy } from '../../src/core/enemy';
import {
  createGame,
  type GameEvent,
  type GameState,
  IDLE_INPUT,
  type InputFrame,
  lookDirection,
  PLAYER_JUMP_SPEED,
  playerEye,
  STARTING_GRENADES,
  stepGame,
} from '../../src/core/game';
import { createPickup, PICKUP_KINDS, WAVE_REWARD_DISTANCE } from '../../src/core/pickups';
import { createRng } from '../../src/core/rng';
import { distanceXZ, vec3 } from '../../src/core/vec3';
import { WATCHER_CHARGE, WATCHER_COOLDOWN, WATCHER_STATS } from '../../src/core/watcher';
import { WAVE_COUNTDOWN } from '../../src/core/waves';
import { createWeapon, type WeaponKind } from '../../src/core/weapon';
import { aabbFromCenter } from '../../src/core/world';

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

  it('spawns the first wave after the countdown', () => {
    const { state, events } = run(createGame({ seed: 2 }), IDLE_INPUT, WAVE_COUNTDOWN + 0.1);
    expect(state.wave.phase).toBe('active');
    expect(state.enemies.length).toBe(3);
    expect(events.some((e) => e.type === 'waveStarted')).toBe(true);
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

  it('declares victory when the final wave is cleared', () => {
    const base = openGame();
    const final: GameState = {
      ...base,
      wave: { number: 8, phase: 'active', phaseEndsAt: 0 },
    };
    const { state, events } = run(final, IDLE_INPUT, 0.1);
    expect(state.status).toBe('won');
    expect(events.some((e) => e.type === 'victory')).toBe(true);
  });
});
