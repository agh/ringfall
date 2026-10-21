import { describe, expect, it } from 'vitest';
import { createEnemy, type Enemy, updateEnemy } from '../../src/core/enemy';
import { createRng } from '../../src/core/rng';
import { distanceXZ, vec3 } from '../../src/core/vec3';
import {
  updateWatcher,
  WATCHER_CHARGE,
  WATCHER_COOLDOWN,
  WATCHER_LENS_HEIGHT,
  WATCHER_MAX_RANGE,
  WATCHER_MIN_RANGE,
  WATCHER_STATS,
  watcherChargeProgress,
  watcherHasLineOfSight,
  watcherLens,
} from '../../src/core/watcher';
import { type Arena, aabbFromCenter } from '../../src/core/world';

const DT = 1 / 60;
const open: Arena = { halfSize: 60, obstacles: [] };
const feet = vec3(0, 0, 0);
const eye = vec3(0, 1.7, 0);

/** A watcher already awake and ready to fire, `z` metres down the -Z axis. */
const holding = (z: number, id = 2): Enemy => ({
  ...createEnemy(id, 'watcher', vec3(0, 0, z), 0),
  state: 'chase',
  nextAttackAt: 0,
});

/** Steps a watcher for `seconds` against a stationary player and collects its actions. */
const simulate = (start: Enemy, arena: Arena, seconds: number, from = 10) => {
  const rng = createRng(3);
  const actions: {
    time: number;
    action: NonNullable<ReturnType<typeof updateWatcher>['action']>;
  }[] = [];
  let e = start;
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    const now = from + (i + 1) * DT;
    const step = updateWatcher(e, arena, feet, eye, DT, now, rng);
    e = step.enemy;
    if (step.action) actions.push({ time: now, action: step.action });
  }
  return { enemy: e, actions };
};

describe('watcher', () => {
  it('is dispatched from updateEnemy and waits out the spawn delay', () => {
    const e = createEnemy(1, 'watcher', vec3(0, 0, -28), 0);
    const rng = createRng(1);
    expect(updateEnemy(e, open, feet, eye, DT, 0.5, rng).enemy.state).toBe('spawning');
    expect(updateEnemy(e, open, feet, eye, DT, 1, rng).enemy.state).toBe('chase');
    expect(WATCHER_STATS.maxHealth).toBe(160);
    expect(WATCHER_STATS.damage).toBe(35);
    expect(WATCHER_STATS.speed).toBe(2);
  });

  it('keeps its distance: backs away when too close and closes when too far, never past the band', () => {
    const near = simulate({ ...holding(-10), nextAttackAt: Number.POSITIVE_INFINITY }, open, 10);
    const nearDist = distanceXZ(near.enemy.position, feet);
    expect(nearDist).toBeGreaterThanOrEqual(WATCHER_MIN_RANGE - 0.1);
    expect(nearDist).toBeLessThanOrEqual(WATCHER_MAX_RANGE);
    expect(near.actions).toEqual([]);

    const far = simulate({ ...holding(-45), nextAttackAt: Number.POSITIVE_INFINITY }, open, 10);
    const farDist = distanceXZ(far.enemy.position, feet);
    expect(farDist).toBeLessThanOrEqual(WATCHER_MAX_RANGE + 0.1);
    expect(farDist).toBeGreaterThanOrEqual(WATCHER_MIN_RANGE);
    // It walked in at 2 m/s for about 6.5 s and then held, so it never reached the player.
    expect(farDist).toBeGreaterThan(20);
  });

  it('strafes slowly around the perimeter inside the band instead of closing', () => {
    const start = { ...holding(-28), nextAttackAt: Number.POSITIVE_INFINITY };
    const { enemy } = simulate(start, open, 4);
    expect(Math.abs(enemy.position.x)).toBeGreaterThan(1);
    expect(distanceXZ(enemy.position, feet)).toBeCloseTo(28, 0);
    // Faces the player throughout: toward +Z is yaw = pi in the renderer's convention.
    expect(Math.abs(enemy.yaw)).toBeGreaterThan(Math.PI - 0.2);
  });

  it('charges for the telegraph duration, stands still, then fires one beam and cools down', () => {
    const { actions, enemy } = simulate(holding(-28), open, WATCHER_CHARGE + WATCHER_COOLDOWN + 1);
    const charge = actions[0];
    const beam = actions[1];
    expect(charge?.action.type).toBe('watcherCharge');
    expect(beam?.action.type).toBe('watcherBeam');
    if (charge?.action.type !== 'watcherCharge' || beam?.action.type !== 'watcherBeam') return;
    expect(WATCHER_CHARGE).toBeGreaterThanOrEqual(0.6);
    expect(beam.time - charge.time).toBeCloseTo(WATCHER_CHARGE, 1);
    expect(charge.action.at.y).toBeCloseTo(WATCHER_LENS_HEIGHT);
    expect(beam.action.hit).toBe(true);
    expect(beam.action.damage).toBe(35);
    expect(beam.action.from).toEqual(charge.action.at);
    expect(distanceXZ(beam.action.to, eye)).toBeLessThan(1);
    // The next charge begins only after the cooldown.
    const second = actions[2];
    expect(second?.action.type).toBe('watcherCharge');
    expect((second?.time ?? 0) - beam.time).toBeCloseTo(WATCHER_COOLDOWN, 1);
    expect(enemy.state === 'attack' || enemy.state === 'chase').toBe(true);
  });

  it('is a static target while charging', () => {
    const rng = createRng(2);
    let e: Enemy = holding(-28);
    const charged = updateWatcher(e, open, feet, eye, DT, 10, rng);
    expect(charged.enemy.state).toBe('attack');
    e = charged.enemy;
    for (let i = 0; i < 30; i += 1) {
      e = updateWatcher(e, open, feet, eye, DT, 10 + (i + 1) * DT, rng).enemy;
    }
    expect(e.position).toEqual(charged.enemy.position);
    expect(watcherChargeProgress(e, 10 + 0.5)).toBeCloseTo(0.5 / WATCHER_CHARGE, 2);
    expect(watcherChargeProgress(e, 10 + WATCHER_CHARGE)).toBe(1);
    expect(watcherChargeProgress({ ...e, state: 'chase' }, 10.5)).toBe(0);
  });

  it('does not start a charge without line of sight, and a beam fired into cover stops there', () => {
    const wall = aabbFromCenter(0, -6, 4, 4, 1);
    const covered: Arena = { halfSize: 60, obstacles: [wall] };
    expect(watcherHasLineOfSight(watcherLens(vec3(0, 0, -28)), eye, covered)).toBe(false);
    expect(watcherHasLineOfSight(watcherLens(vec3(0, 0, -28)), eye, open)).toBe(true);
    const blind = simulate(holding(-28), covered, 3);
    expect(blind.actions.filter((a) => a.action.type === 'watcherCharge')).toEqual([]);

    // Cover raised mid-charge: the beam still fires but ends at the wall and misses.
    const charging: Enemy = { ...holding(-28), state: 'attack', nextAttackAt: 10 + DT };
    const { action } = updateWatcher(charging, covered, feet, eye, DT, 10 + DT, createRng(1));
    expect(action?.type).toBe('watcherBeam');
    if (action?.type !== 'watcherBeam') return;
    expect(action.hit).toBe(false);
    expect(action.to.z).toBeLessThan(wall.min.z + 0.01);
    expect(action.to.z).toBeGreaterThan(-28);
  });

  it('dead watchers ignore updates', () => {
    const dead: Enemy = { ...holding(-28), state: 'dead', diedAt: 1 };
    const { enemy, action } = updateWatcher(dead, open, feet, eye, DT, 5, createRng(1));
    expect(enemy).toBe(dead);
    expect(action).toBeNull();
  });
});
