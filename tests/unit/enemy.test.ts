import { describe, expect, it } from 'vitest';
import {
  createEnemy,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  enemyCenter,
  SPAWN_DELAY,
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
});
