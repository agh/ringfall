import { describe, expect, it } from 'vitest';
import {
  BARK_LINES,
  createEnemy,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  enemyCenter,
  FLEE_DURATION,
  FLEE_EXIT_MARGIN,
  FLEE_EXIT_SPEED_FACTOR,
  FLEE_SPEED_FACTOR,
  hasFled,
  pickBark,
  SPAWN_DELAY,
  startExit,
  startFlee,
  updateEnemy,
} from '../../src/core/enemy';
import { createRng } from '../../src/core/rng';
import { distanceXZ, vec3 } from '../../src/core/vec3';
import type { Arena } from '../../src/core/world';

const arena: Arena = { halfSize: 30, obstacles: [] };
const feet = vec3(0, 0, 0);
const eye = vec3(0, 1.7, 0);

describe('enemy', () => {
  it('waits out the spawn delay before chasing', () => {
    const e = createEnemy(1, 'skimmer', vec3(0, 0, -10), 0);
    const rng = createRng(1);
    expect(updateEnemy(e, arena, feet, eye, 0.1, 0.1, rng).enemy.state).toBe('spawning');
    const active = updateEnemy(e, arena, feet, eye, 0.1, SPAWN_DELAY, rng).enemy;
    expect(active.state).toBe('chase');
  });

  it('closes distance to the player and melees in range', () => {
    let e: Enemy = { ...createEnemy(1, 'skimmer', vec3(0, 0, -10), 0), state: 'chase' };
    const rng = createRng(1);
    const startDist = distanceXZ(e.position, feet);
    let hits = 0;
    for (let i = 0; i < 240; i += 1) {
      const now = 2 + i / 60;
      const { enemy, action } = updateEnemy(e, arena, feet, eye, 1 / 60, now, rng);
      e = enemy;
      if (action?.type === 'melee') hits += 1;
    }
    expect(distanceXZ(e.position, feet)).toBeLessThan(startDist);
    expect(e.state).toBe('attack');
    expect(hits).toBeGreaterThan(0);
    // Facing +Z (towards the player) is yaw = pi in the renderer's convention.
    expect(Math.abs(e.yaw)).toBeCloseTo(Math.PI, 1);
  });

  it('striders keep their distance and fire bolts at the player', () => {
    let e: Enemy = { ...createEnemy(2, 'strider', vec3(0, 0, -10), 0), state: 'chase' };
    const rng = createRng(5);
    let bolts = 0;
    for (let i = 0; i < 300; i += 1) {
      const now = 2 + i / 60;
      const { enemy, action } = updateEnemy(e, arena, feet, eye, 1 / 60, now, rng);
      e = enemy;
      if (action?.type === 'bolt') {
        bolts += 1;
        expect(action.direction.z).toBeGreaterThan(0);
        expect(action.damage).toBe(ENEMY_STATS.strider.damage);
      }
    }
    expect(bolts).toBeGreaterThan(1);
    expect(distanceXZ(e.position, feet)).toBeGreaterThan(ENEMY_STATS.strider.attackRange * 0.4);
  });

  it('backs away when a ranged unit is crowded', () => {
    const e = { ...createEnemy(2, 'strider', vec3(0, 0, -2), 0), state: 'chase' as const };
    const { enemy } = updateEnemy(e, arena, feet, eye, 1 / 60, 5, createRng(1));
    expect(distanceXZ(enemy.position, feet)).toBeGreaterThan(2);
  });

  it('takes damage, dies once, and then ignores updates', () => {
    const e = createEnemy(3, 'skimmer', vec3(0, 0, -5), 0);
    expect(enemyCenter(e).y).toBeCloseTo(ENEMY_STATS.skimmer.height / 2);
    const hurt = damageEnemy(e, 10, 1);
    expect(hurt.killed).toBe(false);
    expect(hurt.enemy.health).toBe(30);
    const dead = damageEnemy(hurt.enemy, 100, 2);
    expect(dead.killed).toBe(true);
    expect(dead.enemy.state).toBe('dead');
    expect(dead.enemy.diedAt).toBe(2);
    expect(damageEnemy(dead.enemy, 5, 3).killed).toBe(false);
    expect(damageEnemy(e, 0, 3).enemy).toBe(e);
    const { enemy, action } = updateEnemy(dead.enemy, arena, feet, eye, 1, 10, createRng(1));
    expect(enemy).toBe(dead.enemy);
    expect(action).toBeNull();
  });

  it('spawns with the archetype health unless scaled, and remembers its maximum', () => {
    const plain = createEnemy(4, 'strider', vec3(0, 0, -5), 0);
    expect(plain.health).toBe(ENEMY_STATS.strider.maxHealth);
    expect(plain.maxHealth).toBe(ENEMY_STATS.strider.maxHealth);
    expect(plain.leader).toBe(false);
    expect(plain.activeAt).toBe(SPAWN_DELAY);
    const armoured = createEnemy(5, 'strider', vec3(0, 0, -5), 2, {
      healthScale: 3,
      leader: true,
      spawnDelay: 1.5,
    });
    expect(armoured.health).toBe(360);
    expect(armoured.maxHealth).toBe(360);
    expect(armoured.leader).toBe(true);
    expect(armoured.activeAt).toBe(3.5);
    expect(damageEnemy(armoured, 120, 3).enemy.health).toBe(240);
  });

  it('exits away from the player at double speed and leaves the arena', () => {
    const e = startExit({ ...createEnemy(6, 'skimmer', vec3(0, 0, -10), 0), state: 'attack' });
    expect(e.state).toBe('flee');
    expect(e.fleeUntil).toBe(Number.POSITIVE_INFINITY);
    const dt = 1 / 60;
    const { enemy: moved, action } = updateEnemy(e, arena, feet, eye, dt, 5, createRng(1));
    expect(action).toBeNull();
    expect(moved.position.z).toBeCloseTo(
      -10 - ENEMY_STATS.skimmer.speed * FLEE_EXIT_SPEED_FACTOR * dt,
    );
    // Facing -Z (away from the player) is yaw 0.
    expect(moved.yaw).toBeCloseTo(0);
    let runner = e;
    for (let i = 0; i < 180; i += 1) {
      runner = updateEnemy(runner, arena, feet, eye, dt, 5 + i * dt, createRng(1)).enemy;
    }
    expect(Math.abs(runner.position.z)).toBeGreaterThan(arena.halfSize);
    expect(Math.abs(runner.position.z)).toBeLessThanOrEqual(arena.halfSize + FLEE_EXIT_MARGIN);
    expect(hasFled(runner, arena)).toBe(true);
    expect(hasFled(e, arena)).toBe(false);
    expect(hasFled({ ...runner, state: 'chase' }, arena)).toBe(false);
  });

  it('exiting enemies slide around cover, striders and spawning enemies exit too, the dead do not', () => {
    const blocked: Arena = {
      halfSize: 30,
      obstacles: [{ min: vec3(-2, 0, -14), max: vec3(2, 3, -12) }],
    };
    let e = startExit({ ...createEnemy(7, 'skimmer', vec3(0, 0, -10), 0), state: 'chase' });
    for (let i = 0; i < 60; i += 1) {
      e = updateEnemy(e, blocked, feet, eye, 1 / 60, 5 + i / 60, createRng(1)).enemy;
    }
    expect(e.position.z).toBeGreaterThan(-12);
    const dead = damageEnemy(createEnemy(8, 'skimmer', vec3(0, 0, -5), 0), 100, 1).enemy;
    expect(startExit(dead)).toBe(dead);
    const strider: Enemy = { ...createEnemy(10, 'strider', vec3(0, 0, -5), 0), state: 'attack' };
    expect(startExit(strider).state).toBe('flee');
    expect(startExit(createEnemy(11, 'skimmer', vec3(0, 0, -5), 0)).state).toBe('flee');
    // A rout refreshed on an exiting enemy keeps it leaving.
    expect(startFlee(startExit(strider), 1)).toEqual(startExit(strider));
  });

  it('stands on the player and still finds a way out', () => {
    const e = startExit({ ...createEnemy(9, 'skimmer', vec3(0, 0, 0), 0), state: 'attack' });
    const { enemy } = updateEnemy(e, arena, feet, eye, 1 / 60, 5, createRng(1));
    expect(enemy.position.z).toBeGreaterThan(0);
  });

  it('routs a chasing or attacking skimmer and nobody else', () => {
    const chasing: Enemy = { ...createEnemy(1, 'skimmer', vec3(0, 0, -10), 0), state: 'chase' };
    const fled = startFlee(chasing, 5);
    expect(fled.state).toBe('flee');
    expect(fled.fleeUntil).toBe(5 + FLEE_DURATION);
    expect(startFlee({ ...chasing, state: 'attack' }, 5).state).toBe('flee');
    // A second rout refreshes the timer rather than stacking.
    expect(startFlee(fled, 7).fleeUntil).toBe(7 + FLEE_DURATION);
    const spawning = createEnemy(2, 'skimmer', vec3(0, 0, -10), 0);
    expect(startFlee(spawning, 5)).toBe(spawning);
    const dead = damageEnemy(chasing, 1000, 1).enemy;
    expect(startFlee(dead, 5)).toBe(dead);
    const strider: Enemy = { ...createEnemy(3, 'strider', vec3(0, 0, -10), 0), state: 'attack' };
    expect(startFlee(strider, 5)).toBe(strider);
  });

  it('runs straight away from the player at flee speed without attacking', () => {
    const rng = createRng(1);
    // Starts in melee range, so a chasing skimmer would zap; a fleeing one must not.
    const inRange: Enemy = { ...createEnemy(1, 'skimmer', vec3(0, 0, -1.5), 0), state: 'attack' };
    let e = startFlee(inRange, 10);
    const before = distanceXZ(e.position, feet);
    const { enemy, action } = updateEnemy(e, arena, feet, eye, 1 / 60, 10, rng);
    expect(action).toBeNull();
    expect(enemy.state).toBe('flee');
    expect(enemy.position.x).toBeCloseTo(0);
    expect(enemy.position.z).toBeLessThan(-1.5);
    const expected = (ENEMY_STATS.skimmer.speed * FLEE_SPEED_FACTOR) / 60;
    expect(distanceXZ(enemy.position, feet) - before).toBeCloseTo(expected, 5);
    // Faces the way it runs: -Z is yaw 0 in the renderer's convention.
    expect(enemy.yaw).toBeCloseTo(0);
    e = enemy;
    let actions = 0;
    for (let i = 1; i < 60; i += 1) {
      const step = updateEnemy(e, arena, feet, eye, 1 / 60, 10 + i / 60, rng);
      e = step.enemy;
      if (step.action) actions += 1;
    }
    expect(actions).toBe(0);
    expect(distanceXZ(e.position, feet)).toBeCloseTo(1.5 + expected * 60, 3);
  });

  it('returns to chase when the rout ends, then fights again', () => {
    const rng = createRng(2);
    let e = startFlee({ ...createEnemy(1, 'skimmer', vec3(0, 0, -4), 0), state: 'chase' }, 0);
    const stillFleeing = updateEnemy(e, arena, feet, eye, 1 / 60, FLEE_DURATION - 0.01, rng).enemy;
    expect(stillFleeing.state).toBe('flee');
    e = updateEnemy(stillFleeing, arena, feet, eye, 1 / 60, FLEE_DURATION, rng).enemy;
    expect(e.state).toBe('chase');
    expect(e.fleeUntil).toBeNull();
    let hits = 0;
    for (let i = 0; i < 240; i += 1) {
      const step = updateEnemy(e, arena, feet, eye, 1 / 60, FLEE_DURATION + 1 + i / 60, rng);
      e = step.enemy;
      if (step.action?.type === 'melee') hits += 1;
    }
    expect(e.state).toBe('attack');
    expect(hits).toBeGreaterThan(0);
  });

  it('runs along +Z when it has nowhere to run from, and stops at the arena edge', () => {
    const rng = createRng(1);
    const onTop = startFlee({ ...createEnemy(1, 'skimmer', feet, 0), state: 'attack' }, 0);
    expect(updateEnemy(onTop, arena, feet, eye, 1 / 60, 0, rng).enemy.position.z).toBeGreaterThan(
      0,
    );
    const cornered = startFlee(
      { ...createEnemy(2, 'skimmer', vec3(0, 0, -29.5), 0), state: 'chase' },
      0,
    );
    const { enemy } = updateEnemy(cornered, arena, feet, eye, 1, 0, rng);
    expect(enemy.position.z).toBeGreaterThanOrEqual(-arena.halfSize);
    expect(enemy.state).toBe('flee');
  });

  it('barks the first line first and any line after', () => {
    expect(pickBark(createRng(1), true)).toBe(BARK_LINES[0]);
    const rng = createRng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) seen.add(pickBark(rng));
    expect(seen.size).toBe(BARK_LINES.length);
    for (const line of seen) expect(BARK_LINES).toContain(line);
  });
});
