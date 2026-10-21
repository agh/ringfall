import { describe, expect, it } from 'vitest';
import {
  createEnemy,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  enemyCenter,
  FLEE_EXIT_MARGIN,
  FLEE_SPEED_SCALE,
  hasFled,
  SPAWN_DELAY,
  startFleeing,
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

  it('flees away from the player at double speed and leaves the arena', () => {
    const e = startFleeing({ ...createEnemy(6, 'skimmer', vec3(0, 0, -10), 0), state: 'attack' });
    expect(e.state).toBe('fleeing');
    const dt = 1 / 60;
    const { enemy: moved, action } = updateEnemy(e, arena, feet, eye, dt, 5, createRng(1));
    expect(action).toBeNull();
    expect(moved.position.z).toBeCloseTo(-10 - ENEMY_STATS.skimmer.speed * FLEE_SPEED_SCALE * dt);
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

  it('fleeing enemies slide around cover and the dead do not flee', () => {
    const blocked: Arena = {
      halfSize: 30,
      obstacles: [{ min: vec3(-2, 0, -14), max: vec3(2, 3, -12) }],
    };
    let e = startFleeing({ ...createEnemy(7, 'skimmer', vec3(0, 0, -10), 0), state: 'chase' });
    for (let i = 0; i < 60; i += 1) {
      e = updateEnemy(e, blocked, feet, eye, 1 / 60, 5 + i / 60, createRng(1)).enemy;
    }
    expect(e.position.z).toBeGreaterThan(-12);
    const dead = damageEnemy(createEnemy(8, 'skimmer', vec3(0, 0, -5), 0), 100, 1).enemy;
    expect(startFleeing(dead)).toBe(dead);
  });

  it('stands on the player and still finds a way out', () => {
    const e = startFleeing({ ...createEnemy(9, 'skimmer', vec3(0, 0, 0), 0), state: 'attack' });
    const { enemy } = updateEnemy(e, arena, feet, eye, 1 / 60, 5, createRng(1));
    expect(enemy.position.z).toBeLessThan(0);
  });
});
