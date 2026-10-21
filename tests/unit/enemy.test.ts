import { describe, expect, it } from 'vitest';
import {
  AMBUSH_LEAD,
  BARK_LINES,
  chaseGoal,
  createEnemy,
  DETOUR_MAX,
  damageEnemy,
  ENEMY_STATS,
  type Enemy,
  enemyCenter,
  FLANK_MAX_OFFSET,
  FLEE_DURATION,
  FLEE_EXIT_MARGIN,
  FLEE_EXIT_SPEED_FACTOR,
  FLEE_SPEED_FACTOR,
  hasClearShot,
  hasFled,
  offHandSide,
  pickBark,
  SKITTISH_HOLD_RANGE,
  SKITTISH_PACK_RANGE,
  SPAWN_DELAY,
  STILL_TRACKING,
  STUCK_AFTER,
  sidestepDirection,
  startExit,
  startFlee,
  TEMPERAMENTS,
  type Tracking,
  temperamentFor,
  updateEnemy,
} from '../../src/core/enemy';

import { createRng, type Rng } from '../../src/core/rng';
import { distanceXZ, normalize, vec3 } from '../../src/core/vec3';
import { type Arena, aabbFromCenter } from '../../src/core/world';

const arena: Arena = { halfSize: 30, obstacles: [], secret: null };
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
      secret: null,
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

  describe('temperaments', () => {
    /** Heading from `from` to `to` in the XZ plane, radians, in the yaw convention (0 = -Z). */
    const headingTo = (from: ReturnType<typeof vec3>, to: ReturnType<typeof vec3>): number =>
      Math.atan2(-(to.x - from.x), -(to.z - from.z));
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    /**
     * The policy's heading relative to the straight line at the player. Positive is a turn to
     * the enemy's own left; for an enemy south of the player facing +Z, that is world +X.
     */
    const relativeHeading = (
      temperament: (typeof TEMPERAMENTS)[number],
      tracking: Tracking,
      from = vec3(0, 0, -10),
    ): number | null => {
      const goal = chaseGoal(temperament, from, feet, tracking);
      return goal === null ? null : wrap(headingTo(from, goal) - headingTo(from, feet));
    };

    it('hands the four temperaments out round-robin', () => {
      expect(TEMPERAMENTS).toEqual(['chaser', 'ambusher', 'flanker', 'skittish']);
      expect([0, 1, 2, 3, 4, 5, 9].map(temperamentFor)).toEqual([
        'chaser',
        'ambusher',
        'flanker',
        'skittish',
        'chaser',
        'ambusher',
        'ambusher',
      ]);
      expect(createEnemy(1, 'skimmer', feet, 0).temperament).toBe('chaser');
      expect(createEnemy(1, 'skimmer', feet, 0, { temperament: 'flanker' }).temperament).toBe(
        'flanker',
      );
    });

    it('a chaser heads straight at the player', () => {
      expect(relativeHeading('chaser', STILL_TRACKING)).toBeCloseTo(0);
      const running: Tracking = { ...STILL_TRACKING, velocity: vec3(6, 0, 0) };
      expect(relativeHeading('chaser', running)).toBeCloseTo(0);
    });

    it('an ambusher leads a moving player by four metres and not a still one', () => {
      // Player running +X: the goal is 4 m along +X, to the approaching enemy's left.
      const running: Tracking = { ...STILL_TRACKING, velocity: vec3(6, 0, 0) };
      const goal = chaseGoal('ambusher', vec3(0, 0, -10), feet, running);
      expect(goal).toEqual(vec3(AMBUSH_LEAD, 0, 0));
      expect(relativeHeading('ambusher', running)).toBeCloseTo(Math.atan2(AMBUSH_LEAD, 10));
      const creeping: Tracking = { ...STILL_TRACKING, velocity: vec3(0.2, 0, 0) };
      expect(relativeHeading('ambusher', creeping)).toBeCloseTo(0);
      expect(relativeHeading('ambusher', STILL_TRACKING)).toBeCloseTo(0);
    });

    it("a flanker swings to the player's off-hand side, wider when further out", () => {
      // Player facing -Z (yaw 0): the off-hand side is world -X, which is to the right of an
      // enemy approaching from the south, so the relative heading is negative.
      expect(offHandSide(0)).toEqual(vec3(-1, 0, 0));
      expect(offHandSide(Math.PI / 2).z).toBeCloseTo(1);
      const near = relativeHeading('flanker', STILL_TRACKING, vec3(0, 0, -4));
      const far = relativeHeading('flanker', STILL_TRACKING, vec3(0, 0, -20));
      expect(near).not.toBeNull();
      expect(far).not.toBeNull();
      expect(near ?? 0).toBeLessThan(0);
      expect(far ?? 0).toBeLessThan(0);
      // The offset grows with distance (0.6 of it, 1.5 to 6 m); the angle shrinks.
      expect(chaseGoal('flanker', vec3(0, 0, -4), feet, STILL_TRACKING)?.x).toBeCloseTo(-2.4);
      expect(Math.abs(far ?? 0)).toBeLessThan(Math.abs(near ?? 0));
      // The offset caps at FLANK_MAX_OFFSET, so from 20 m the goal is 6 m to the player's left.
      expect(chaseGoal('flanker', vec3(0, 0, -20), feet, STILL_TRACKING)).toEqual(
        vec3(-FLANK_MAX_OFFSET, 0, 0),
      );
      // Facing +X (yaw -pi/2) the off-hand side is -Z: the goal follows the player's yaw.
      const facingX: Tracking = { ...STILL_TRACKING, yaw: -Math.PI / 2 };
      const goal = chaseGoal('flanker', vec3(0, 0, -20), feet, facingX);
      expect(goal?.z ?? 0).toBeCloseTo(-FLANK_MAX_OFFSET);
      expect(goal?.x ?? 1).toBeCloseTo(0);
    });

    it('a skittish skimmer waits inside ten metres until a packmate is on the player', () => {
      const alone: Tracking = { ...STILL_TRACKING, pack: [vec3(0, 0, 20)] };
      expect(relativeHeading('skittish', alone, vec3(0, 0, -SKITTISH_HOLD_RANGE - 1))).toBeCloseTo(
        0,
      );
      expect(relativeHeading('skittish', alone, vec3(0, 0, -SKITTISH_HOLD_RANGE + 1))).toBeNull();
      const company: Tracking = { ...STILL_TRACKING, pack: [vec3(SKITTISH_PACK_RANGE - 1, 0, 0)] };
      expect(relativeHeading('skittish', company, vec3(0, 0, -5))).toBeCloseTo(0);
      // The last skimmer standing has nothing to wait for.
      expect(relativeHeading('skittish', STILL_TRACKING, vec3(0, 0, -5))).toBeCloseTo(0);
    });

    it('a stepped flanker arrives on the off-hand side; a skittish one holds', () => {
      const rng = createRng(3);
      let flanker: Enemy = {
        ...createEnemy(1, 'skimmer', vec3(0, 0, -12), 0, { temperament: 'flanker' }),
        state: 'chase',
      };
      let leftmost = 0;
      for (let i = 0; i < 180; i += 1) {
        flanker = updateEnemy(flanker, arena, feet, eye, 1 / 60, 2 + i / 60, rng).enemy;
        leftmost = Math.min(leftmost, flanker.position.x);
      }
      expect(leftmost).toBeLessThan(-1.5);
      expect(flanker.state).toBe('attack');

      const pack: Tracking = { ...STILL_TRACKING, pack: [vec3(0, 0, 25)] };
      let skittish: Enemy = {
        ...createEnemy(2, 'skimmer', vec3(0, 0, -6), 0, { temperament: 'skittish' }),
        state: 'chase',
      };
      for (let i = 0; i < 60; i += 1) {
        skittish = updateEnemy(skittish, arena, feet, eye, 1 / 60, 2 + i / 60, rng, pack).enemy;
      }
      expect(skittish.position).toEqual(vec3(0, 0, -6));
      expect(skittish.state).toBe('chase');
      // Striders ignore temperaments entirely.
      const strider: Enemy = {
        ...createEnemy(3, 'strider', vec3(0, 0, -30), 0, { temperament: 'skittish' }),
        state: 'chase',
      };
      const stepped = updateEnemy(strider, arena, feet, eye, 1 / 60, 5, rng, pack).enemy;
      expect(distanceXZ(stepped.position, feet)).toBeLessThan(30);
    });
  });

  describe('pathing', () => {
    const DT = 1 / 60;
    /** An `Rng` whose every draw is `value`, so a coin flip in the code under test is chosen. */
    const fixed = (value: number): Rng => ({
      next: () => value,
      range: (lo, hi) => lo + (hi - lo) * value,
      int: (n) => Math.floor(value * n),
    });
    const chasing = (kind: 'skimmer' | 'strider', at: ReturnType<typeof vec3>, now = 0): Enemy => ({
      ...createEnemy(1, kind, at, now),
      state: 'chase',
      headwayAt: now,
    });
    /** Steps `e` for `seconds` and returns the enemy after each step. */
    const run = (
      e: Enemy,
      world: Arena,
      player: ReturnType<typeof vec3>,
      seconds: number,
      rng: Rng,
      start = 0,
    ): Enemy[] => {
      const trail: Enemy[] = [];
      let current = e;
      for (let i = 0; i < seconds * 60; i += 1) {
        const now = start + i * DT;
        current = updateEnemy(
          current,
          world,
          player,
          vec3(player.x, 1.7, player.z),
          DT,
          now,
          rng,
        ).enemy;
        trail.push(current);
      }
      return trail;
    };
    const moved = (a: Enemy, b: Enemy): number => distanceXZ(a.position, b.position);

    it('escapes a convex corner it is wedged against diagonally', () => {
      // Seed 102 of the balance gate: the skimmer sat on the north-west corner of this block
      // from t = 20 s to the cap, with the player south-east of it. Each axis alone is blocked
      // by the corner, so the slide is zero-length every step.
      const world: Arena = {
        halfSize: 30,
        obstacles: [{ min: vec3(0, 0, 7.5), max: vec3(3.3, 3, 13.1) }],
        secret: null,
      };
      const player = vec3(17.9, 0, 4);
      const e = chasing('skimmer', vec3(-0.34, 0, 13.54));
      const rng = createRng(102);
      const first = updateEnemy(e, world, player, vec3(17.9, 1.7, 4), DT, 0, rng).enemy;
      expect(moved(first, e)).toBeLessThan(0.04);
      expect(first.detour).toBeNull();
      const trail = run(e, world, player, 6, rng);
      // Stuck for STUCK_AFTER, then a detour, then on the player.
      const stillAt = trail[Math.round(STUCK_AFTER * 60) - 2];
      expect(stillAt).toBeDefined();
      expect(moved(stillAt as Enemy, e)).toBeLessThan(0.1);
      expect(trail.some((t) => t.detour !== null)).toBe(true);
      const last = trail[trail.length - 1] as Enemy;
      expect(last.state).toBe('attack');
      expect(last.detour).toBeNull();
      expect(distanceXZ(last.position, player)).toBeLessThanOrEqual(
        ENEMY_STATS.skimmer.attackRange,
      );
    });

    it('escapes a concave corner between two blocks with the player behind them', () => {
      // Two blocks meeting at (2, 2): one east of the enemy, one north. The player is beyond
      // the corner to the north-east, so the straight line is blocked on both axes.
      const world: Arena = {
        halfSize: 30,
        obstacles: [
          { min: vec3(2, 0, -2), max: vec3(6, 3, 2) },
          { min: vec3(-2, 0, 2), max: vec3(2, 3, 6) },
        ],
        secret: null,
      };
      const player = vec3(10, 0, 10);
      const e = chasing('skimmer', vec3(1.4, 0, 1.4));
      const rng = createRng(7);
      const first = updateEnemy(e, world, player, vec3(10, 1.7, 10), DT, 0, rng).enemy;
      expect(moved(first, e)).toBeLessThan(0.04);
      const trail = run(e, world, player, 8, rng);
      const last = trail[trail.length - 1] as Enemy;
      expect(last.state).toBe('attack');
      expect(distanceXZ(last.position, player)).toBeLessThanOrEqual(
        ENEMY_STATS.skimmer.attackRange,
      );
    });

    it('walks off a face the player stands straight behind instead of jittering on it', () => {
      // Seed 107: a strider against the east face of a block with the player due west. The
      // straight line is blocked, and the lateral jitter alone is a random walk along the face
      // that never reaches a corner.
      const world: Arena = {
        halfSize: 30,
        obstacles: [aabbFromCenter(16, 7.8, 6, 3, 6)],
        secret: null,
      };
      const player = vec3(-10, 0, 7.8);
      const e = chasing('strider', vec3(19.8, 0, 7.8));
      const rng = createRng(107);
      const trail = run(e, world, player, 6, rng);
      const atOneSecond = trail[60] as Enemy;
      // A second of jitter moves it along the face by less than its own radius.
      expect(Math.abs(atOneSecond.position.x - 19.8)).toBeLessThan(0.1);
      expect(Math.abs(atOneSecond.position.z - 7.8)).toBeLessThan(ENEMY_STATS.strider.radius);
      const last = trail[trail.length - 1] as Enemy;
      expect(last.position.x).toBeLessThan(13);
      expect(distanceXZ(last.position, player)).toBeLessThan(distanceXZ(e.position, player) - 8);
      expect(last.detour).toBeNull();
    });

    it('a free chase never detours and holding position is not a dead end', () => {
      const rng = createRng(3);
      const trail = run(chasing('skimmer', vec3(0, 0, -20)), arena, feet, 2, rng);
      expect(trail.every((t) => t.detour === null)).toBe(true);
      expect(trail.every((t, i) => t.headwayAt === i * DT || t.state === 'attack')).toBe(true);
      // A skittish skimmer waiting for company stands still by choice: its clock keeps up.
      const pack: Tracking = { ...STILL_TRACKING, pack: [vec3(0, 0, 25)] };
      let skittish: Enemy = {
        ...chasing('skimmer', vec3(0, 0, -6)),
        temperament: 'skittish',
        headwayAt: -10,
      };
      for (let i = 0; i < 120; i += 1) {
        skittish = updateEnemy(skittish, arena, feet, eye, DT, i * DT, rng, pack).enemy;
      }
      expect(skittish.position).toEqual(vec3(0, 0, -6));
      expect(skittish.detour).toBeNull();
      expect(skittish.headwayAt).toBeCloseTo(119 * DT);
      // So does a strider holding its range band.
      let strider: Enemy = { ...chasing('strider', vec3(0, 0, -12)), headwayAt: -10 };
      for (let i = 0; i < 120; i += 1) {
        strider = updateEnemy(strider, arena, feet, eye, DT, i * DT, rng).enemy;
      }
      expect(strider.position).toEqual(vec3(0, 0, -12));
      expect(strider.detour).toBeNull();
    });

    it('picks the short way round the blocker, and flips a coin at the arena edge or on a retry', () => {
      const box = { min: vec3(0, 0, 7.5), max: vec3(3.3, 3, 13.1) };
      const world: Arena = { halfSize: 30, obstacles: [box], secret: null };
      const r = ENEMY_STATS.skimmer.radius;
      // On the north-west corner heading south-east: north then east is 1.8 m to open ground,
      // west then south is 5.7 m.
      const corner = sidestepDirection(
        world,
        vec3(-0.34, 0, 13.54),
        r,
        normalize(vec3(0.88, 0, -0.46)),
        fixed(0.9),
      );
      expect(corner.x).toBeGreaterThan(0);
      expect(corner.z).toBeGreaterThan(0);
      // Against the west face near its south end, heading east: south is the short way.
      const face = sidestepDirection(world, vec3(-0.5, 0, 8), r, vec3(1, 0, 0), fixed(0.1));
      expect(face.x).toBeCloseTo(0);
      expect(face.z).toBeCloseTo(-1);
      // The coin decides at the arena edge (no block ahead) and on a retry: heads is the
      // strafe to the enemy's left of its heading, tails the right.
      const edge = (coin: number): number =>
        sidestepDirection(world, vec3(29, 0, 0), r, vec3(1, 0, 0), fixed(coin)).z;
      expect(edge(0.1)).toBeCloseTo(1);
      expect(edge(0.9)).toBeCloseTo(-1);
      const retry = sidestepDirection(world, vec3(-0.5, 0, 8), r, vec3(1, 0, 0), fixed(0.1), true);
      expect(retry.z).toBeCloseTo(1);
    });

    it('a sidestep blocked both ways backs out, and one boxed in on every side is dropped', () => {
      // A pocket 1.6 m wide open to the south, the player beyond its north wall. West is
      // blocked after two steps, east after four, and the third block backs out south.
      const pocket: Arena = {
        halfSize: 30,
        obstacles: [
          { min: vec3(-3, 0, 2), max: vec3(3, 3, 4) },
          { min: vec3(-3, 0, -2), max: vec3(-0.8, 3, 2) },
          { min: vec3(0.8, 0, -2), max: vec3(3, 3, 2) },
        ],
        secret: null,
      };
      const player = vec3(0, 0, 10);
      const e = chasing('skimmer', vec3(0, 0, 1.4));
      const trail = run(e, pocket, player, STUCK_AFTER + 1, fixed(0.5));
      const detours = trail
        .map((t) => t.detour)
        .filter((d): d is NonNullable<typeof d> => d !== null);
      expect(detours.some((d) => d.direction.x < -0.9 && !d.flipped)).toBe(true);
      expect(detours.some((d) => d.direction.x > 0.9 && d.flipped)).toBe(true);
      expect(detours.some((d) => d.direction.z < -0.9 && d.flipped)).toBe(true);
      expect(Math.min(...trail.map((t) => t.position.z))).toBeLessThan(1);
      // Walled in on all four sides there is nothing to do; the detour is dropped, not held.
      const cell: Arena = {
        halfSize: 30,
        obstacles: [
          { min: vec3(-2, 0, 0.6), max: vec3(2, 3, 2) },
          { min: vec3(-2, 0, -2), max: vec3(2, 3, -0.6) },
          { min: vec3(0.6, 0, -0.5), max: vec3(2, 3, 0.5) },
          { min: vec3(-2, 0, -0.5), max: vec3(-0.6, 3, 0.5) },
        ],
        secret: null,
      };
      const walled = run(chasing('skimmer', vec3(0, 0, 0)), cell, player, 3, createRng(1));
      const last = walled[walled.length - 1] as Enemy;
      expect(distanceXZ(last.position, vec3(0, 0, 0))).toBeLessThan(0.1);
      expect(last.detour).toBeNull();
      expect(walled.some((t) => t.detour !== null)).toBe(true);
    });

    it('a strider closes while cover hides the player and holds its band once it sees', () => {
      // A 4 m block between a strider at 12 m (inside its 16 m band) and the player. Holding
      // the band here is standing still and firing into the block.
      const world: Arena = {
        halfSize: 30,
        obstacles: [aabbFromCenter(0, -6, 4, 3, 2)],
        secret: null,
      };
      const e = chasing('strider', vec3(0, 0, -12));
      expect(hasClearShot(e, world, eye)).toBe(false);
      expect(hasClearShot(e, arena, eye)).toBe(true);
      const first = updateEnemy(e, world, feet, eye, DT, 0, createRng(1)).enemy;
      expect(first.state).toBe('attack');
      expect(first.position.z).toBeGreaterThan(-12);
      const trail = run(e, world, feet, 10, createRng(1));
      const seen = trail.findIndex((t) => hasClearShot(t, world, eye));
      expect(seen).toBeGreaterThan(0);
      const last = trail[trail.length - 1] as Enemy;
      expect(hasClearShot(last, world, eye)).toBe(true);
      const dist = distanceXZ(last.position, feet);
      expect(dist).toBeGreaterThanOrEqual(ENEMY_STATS.strider.attackRange * 0.5 - 0.1);
      expect(dist).toBeLessThanOrEqual(ENEMY_STATS.strider.attackRange);
      // With a clear shot it holds, as before.
      const holding = updateEnemy(
        chasing('strider', vec3(0, 0, -12)),
        arena,
        feet,
        eye,
        DT,
        0,
        createRng(1),
      ).enemy;
      expect(holding.position).toEqual(vec3(0, 0, -12));
      // The muzzle itself at the eye counts as a clear shot.
      expect(
        hasClearShot(
          { ...e, position: vec3(0, 1.7 - ENEMY_STATS.strider.height * 0.75, 0) },
          world,
          eye,
        ),
      ).toBe(true);
    });

    it('a lapsed detour is retried, and a rout or an exit clears one', () => {
      const world: Arena = {
        halfSize: 30,
        obstacles: [aabbFromCenter(16, 7.8, 6, 3, 6)],
        secret: null,
      };
      const player = vec3(-10, 0, 7.8);
      const stuck: Enemy = {
        ...chasing('strider', vec3(19.8, 0, 7.8), 10),
        headwayAt: 10 - STUCK_AFTER,
        detour: { direction: vec3(0, 0, 1), until: 10, flipped: false },
      };
      const { enemy } = updateEnemy(stuck, world, player, vec3(-10, 1.7, 7.8), DT, 10, fixed(0.9));
      expect(enemy.detour).not.toBeNull();
      expect(enemy.detour?.until).toBeCloseTo(10 + DETOUR_MAX);
      // The retry drew the coin: tails is the strafe to the right of a westward heading, north.
      expect(enemy.detour?.direction.z).toBeGreaterThan(0);
      expect(startExit(enemy).detour).toBeNull();
      const skimmer: Enemy = { ...enemy, kind: 'skimmer' };
      expect(startFlee(skimmer, 10).detour).toBeNull();
      // A rout that ends against cover starts a fresh clock rather than detouring at once.
      const routed: Enemy = { ...enemy, state: 'flee', fleeUntil: 5, headwayAt: 0 };
      const back = updateEnemy(
        routed,
        world,
        player,
        vec3(-10, 1.7, 7.8),
        DT,
        11,
        fixed(0.9),
      ).enemy;
      expect(back.state).toBe('chase');
      expect(back.detour).toBeNull();
      expect(back.headwayAt).toBe(11);
      // Spawning sets the clock to the moment the enemy wakes.
      expect(createEnemy(9, 'skimmer', feet, 4).headwayAt).toBe(4 + SPAWN_DELAY);
      const woken = updateEnemy(
        createEnemy(9, 'skimmer', vec3(0, 0, -10), 4),
        arena,
        feet,
        eye,
        DT,
        6,
        fixed(0.5),
      ).enemy;
      expect(woken.headwayAt).toBe(6);
    });
  });
});
