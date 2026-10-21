import type { Rng } from './rng';
import { add, distanceXZ, normalize, scale, sub, type Vec3, vec3, ZERO } from './vec3';
import { type Arena, moveWithCollision } from './world';

export type EnemyKind = 'skimmer' | 'strider';
export type EnemyState = 'spawning' | 'chase' | 'attack' | 'dead';

/**
 * How a skimmer closes on the player. A wave hands these out round-robin, so a pack of four
 * arrives from four directions: one straight at you, one where you are going, one at your
 * off-hand side, and one that hangs back until a packmate has your attention.
 */
export type Temperament = 'chaser' | 'ambusher' | 'flanker' | 'skittish';

export const TEMPERAMENTS: readonly Temperament[] = ['chaser', 'ambusher', 'flanker', 'skittish'];

/** Metres ahead of the player's velocity an ambusher aims for. */
export const AMBUSH_LEAD = 4;
/** Below this player speed (m/s) an ambusher treats the player as standing still. */
export const AMBUSH_MIN_SPEED = 0.5;
/** A flanker aims this fraction of its distance to the player's off-hand side, within bounds. */
export const FLANK_RATIO = 0.6;
export const FLANK_MIN_OFFSET = 1.5;
export const FLANK_MAX_OFFSET = 6;
/** A skittish skimmer closes only while another skimmer is within this distance of the player. */
export const SKITTISH_PACK_RANGE = 6;
/** Outside this distance a skittish skimmer still approaches; inside it, it waits for company. */
export const SKITTISH_HOLD_RANGE = 10;

/** The i-th skimmer spawned in a wave gets the i-th temperament, wrapping round. */
export const temperamentFor = (index: number): Temperament =>
  TEMPERAMENTS[((index % TEMPERAMENTS.length) + TEMPERAMENTS.length) % TEMPERAMENTS.length] ??
  'chaser';

/** What the temperaments read about the player beyond their position. */
export interface Tracking {
  /** Player velocity in m/s, horizontal. */
  readonly velocity: Vec3;
  /** Player yaw, for the off-hand side. */
  readonly yaw: number;
  /** Positions of the other live skimmers. */
  readonly pack: readonly Vec3[];
}

export const STILL_TRACKING: Tracking = { velocity: ZERO, yaw: 0, pack: [] };

/** The player's off-hand (left) side for a yaw; the rifle is carried on the right. */
export const offHandSide = (yaw: number): Vec3 => vec3(-Math.cos(yaw), 0, Math.sin(yaw));

/**
 * The point a skimmer of this temperament heads for, or null when it holds position.
 * Pure geometry so the relative headings are unit-testable without stepping the simulation.
 */
export const chaseGoal = (
  temperament: Temperament,
  position: Vec3,
  playerFeet: Vec3,
  tracking: Tracking,
): Vec3 | null => {
  switch (temperament) {
    case 'chaser':
      return playerFeet;
    case 'ambusher': {
      const flat = vec3(tracking.velocity.x, 0, tracking.velocity.z);
      if (Math.hypot(flat.x, flat.z) < AMBUSH_MIN_SPEED) return playerFeet;
      return add(playerFeet, scale(normalize(flat), AMBUSH_LEAD));
    }
    case 'flanker': {
      const dist = distanceXZ(position, playerFeet);
      const offset = Math.min(FLANK_MAX_OFFSET, Math.max(FLANK_MIN_OFFSET, dist * FLANK_RATIO));
      return add(playerFeet, scale(offHandSide(tracking.yaw), offset));
    }
    case 'skittish': {
      if (distanceXZ(position, playerFeet) > SKITTISH_HOLD_RANGE) return playerFeet;
      if (tracking.pack.length === 0) return playerFeet;
      const company = tracking.pack.some((p) => distanceXZ(p, playerFeet) <= SKITTISH_PACK_RANGE);
      return company ? playerFeet : null;
    }
  }
};

export interface EnemyStats {
  readonly maxHealth: number;
  readonly speed: number;
  readonly radius: number;
  readonly height: number;
  /** Distance at which the enemy stops closing and starts attacking. */
  readonly attackRange: number;
  readonly attackInterval: number;
  readonly damage: number;
  readonly score: number;
  /** Striders shoot bolts; skimmers zap on contact. */
  readonly ranged: boolean;
}

export const ENEMY_STATS: Readonly<Record<EnemyKind, EnemyStats>> = {
  skimmer: {
    maxHealth: 40,
    speed: 7,
    radius: 0.55,
    height: 1.2,
    attackRange: 2,
    attackInterval: 0.9,
    damage: 12,
    score: 100,
    ranged: false,
  },
  strider: {
    maxHealth: 120,
    speed: 3,
    radius: 0.8,
    height: 2.6,
    attackRange: 16,
    attackInterval: 1.4,
    damage: 18,
    score: 300,
    ranged: true,
  },
};

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly position: Vec3;
  readonly health: number;
  readonly state: EnemyState;
  readonly yaw: number;
  /** Simulation time the enemy becomes active. */
  readonly activeAt: number;
  readonly nextAttackAt: number;
  /** Simulation time of death, used by the renderer for a short fade. */
  readonly diedAt: number | null;
  /** Movement policy; only skimmers read it, striders carry the default. */
  readonly temperament: Temperament;
}

export const SPAWN_DELAY = 1;

export const createEnemy = (
  id: number,
  kind: EnemyKind,
  position: Vec3,
  now: number,
  temperament: Temperament = 'chaser',
): Enemy => ({
  id,
  kind,
  position,
  health: ENEMY_STATS[kind].maxHealth,
  state: 'spawning',
  yaw: 0,
  activeAt: now + SPAWN_DELAY,
  nextAttackAt: now + SPAWN_DELAY + 0.5,
  diedAt: null,
  temperament,
});

export type EnemyAction =
  | { readonly type: 'melee'; readonly damage: number }
  | {
      readonly type: 'bolt';
      readonly origin: Vec3;
      readonly direction: Vec3;
      readonly damage: number;
    };

export interface EnemyUpdate {
  readonly enemy: Enemy;
  readonly action: EnemyAction | null;
}

export const enemyCenter = (e: Enemy): Vec3 =>
  add(e.position, vec3(0, ENEMY_STATS[e.kind].height / 2, 0));

/** Where this enemy wants to go this step, and whether it is closing (+1) or backing off (-1). */
const moveIntent = (
  e: Enemy,
  stats: EnemyStats,
  playerFeet: Vec3,
  dist: number,
  tracking: Tracking,
): { readonly goal: Vec3; readonly sign: number } | null => {
  const inRange = dist <= stats.attackRange;
  if (stats.ranged) {
    // Close in, or back off when a ranged unit gets crowded.
    if (!inRange) return { goal: playerFeet, sign: 1 };
    return dist < stats.attackRange * 0.5 ? { goal: playerFeet, sign: -1 } : null;
  }
  if (inRange) return null;
  const goal = chaseGoal(e.temperament, e.position, playerFeet, tracking);
  return goal === null ? null : { goal, sign: 1 };
};

/**
 * Advances one enemy by `dt`. Pure: returns the new enemy plus any attack it performs.
 * `tracking` feeds the skimmer temperaments; callers that only care about striders can omit it.
 */
export const updateEnemy = (
  e: Enemy,
  arena: Arena,
  playerFeet: Vec3,
  playerEye: Vec3,
  dt: number,
  now: number,
  rng: Rng,
  tracking: Tracking = STILL_TRACKING,
): EnemyUpdate => {
  if (e.state === 'dead') return { enemy: e, action: null };
  if (e.state === 'spawning') {
    return { enemy: now >= e.activeAt ? { ...e, state: 'chase' } : e, action: null };
  }
  const stats = ENEMY_STATS[e.kind];
  const toPlayer = sub(playerFeet, e.position);
  const dist = distanceXZ(playerFeet, e.position);
  const yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
  const inRange = dist <= stats.attackRange;

  let position = e.position;
  const intent = moveIntent(e, stats, playerFeet, dist, tracking);
  if (intent !== null) {
    // A little lateral jitter keeps groups from stacking into a single line.
    const toGoal = sub(intent.goal, e.position);
    const dir = normalize(vec3(toGoal.x, 0, toGoal.z));
    const strafe = vec3(-dir.z, 0, dir.x);
    const wobble = (rng.next() - 0.5) * 0.6;
    const step = add(
      scale(dir, intent.sign * stats.speed * dt),
      scale(strafe, wobble * stats.speed * dt),
    );
    position = moveWithCollision(arena, e.position, stats.radius, stats.height, step);
  }

  const state: EnemyState = inRange ? 'attack' : 'chase';
  let action: EnemyAction | null = null;
  let nextAttackAt = e.nextAttackAt;
  if (inRange && now >= e.nextAttackAt) {
    nextAttackAt = now + stats.attackInterval;
    if (stats.ranged) {
      const origin = add(position, vec3(0, stats.height * 0.75, 0));
      const spread = 0.04;
      const aim = add(
        sub(playerEye, origin),
        vec3(rng.range(-spread, spread) * dist, rng.range(-spread, spread) * dist, 0),
      );
      action = { type: 'bolt', origin, direction: normalize(aim), damage: stats.damage };
    } else {
      action = { type: 'melee', damage: stats.damage };
    }
  }
  return { enemy: { ...e, position, yaw, state, nextAttackAt }, action };
};

export interface EnemyDamageOutcome {
  readonly enemy: Enemy;
  readonly killed: boolean;
}

export const damageEnemy = (e: Enemy, amount: number, now: number): EnemyDamageOutcome => {
  if (e.state === 'dead' || amount <= 0) return { enemy: e, killed: false };
  const health = Math.max(0, e.health - amount);
  if (health === 0) return { enemy: { ...e, health, state: 'dead', diedAt: now }, killed: true };
  return { enemy: { ...e, health }, killed: false };
};
