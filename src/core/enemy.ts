import type { Rng } from './rng';
import { add, distanceXZ, normalize, scale, sub, type Vec3, vec3 } from './vec3';
import { type Arena, moveWithCollision } from './world';

export type EnemyKind = 'skimmer' | 'strider';
export type EnemyState = 'spawning' | 'chase' | 'attack' | 'flee' | 'dead';

/** Skimmers this close (XZ metres) to a strider when it dies break and run. */
export const FLEE_RADIUS = 25;
/** How long a rout lasts before the skimmer returns to `chase`. */
export const FLEE_DURATION = 4;
/** Fleeing speed as a multiple of the skimmer's chase speed. */
export const FLEE_SPEED_FACTOR = 1.3;
/** What a routed skimmer shouts. Original lines; the first rout of a pack always calls the first. */
export const BARK_LINES = ['LEADER DOWN', 'FALL BACK', 'REGROUP'] as const;
export type BarkLine = (typeof BARK_LINES)[number];

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
  /** Simulation time a `flee` ends; null in every other state. */
  readonly fleeUntil: number | null;
}

export const SPAWN_DELAY = 1;

export const createEnemy = (id: number, kind: EnemyKind, position: Vec3, now: number): Enemy => ({
  id,
  kind,
  position,
  health: ENEMY_STATS[kind].maxHealth,
  state: 'spawning',
  yaw: 0,
  activeAt: now + SPAWN_DELAY,
  nextAttackAt: now + SPAWN_DELAY + 0.5,
  diedAt: null,
  fleeUntil: null,
});

/**
 * Routs a skimmer: it enters `flee` until `now + FLEE_DURATION`. A skimmer already fleeing has
 * its timer refreshed. Striders never flee, and a spawning or dead enemy is returned unchanged.
 */
export const startFlee = (e: Enemy, now: number): Enemy => {
  if (e.kind !== 'skimmer' || e.state === 'spawning' || e.state === 'dead') return e;
  return { ...e, state: 'flee', fleeUntil: now + FLEE_DURATION };
};

/** A random bark line; `first` is what the first skimmer of a rout calls before the rest answer. */
export const pickBark = (rng: Rng, first = false): BarkLine =>
  first ? BARK_LINES[0] : (BARK_LINES[rng.int(BARK_LINES.length)] ?? BARK_LINES[0]);

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

/** One step of a rout: straight away from the player at flee speed, facing the way it runs. */
const fleeStep = (e: Enemy, arena: Arena, playerFeet: Vec3, dt: number): Enemy => {
  const stats = ENEMY_STATS[e.kind];
  const away = sub(e.position, playerFeet);
  const flat = vec3(away.x, 0, away.z);
  // A skimmer standing exactly on the player runs along +Z rather than nowhere.
  const dir = Math.hypot(flat.x, flat.z) > 1e-6 ? normalize(flat) : vec3(0, 0, 1);
  const step = scale(dir, stats.speed * FLEE_SPEED_FACTOR * dt);
  const position = moveWithCollision(arena, e.position, stats.radius, stats.height, step);
  return { ...e, position, yaw: Math.atan2(-dir.x, -dir.z) };
};

/**
 * Closes in, or backs off when a ranged unit gets crowded. A little lateral jitter keeps
 * groups from stacking into a single line. Returns the position unchanged when holding range.
 */
const pursueStep = (
  e: Enemy,
  arena: Arena,
  toPlayer: Vec3,
  dist: number,
  dt: number,
  rng: Rng,
): Vec3 => {
  const stats = ENEMY_STATS[e.kind];
  const inRange = dist <= stats.attackRange;
  if (inRange && !(stats.ranged && dist < stats.attackRange * 0.5)) return e.position;
  const dir = normalize(vec3(toPlayer.x, 0, toPlayer.z));
  const sign = inRange ? -1 : 1;
  const strafe = vec3(-dir.z, 0, dir.x);
  const wobble = (rng.next() - 0.5) * 0.6;
  const step = add(scale(dir, sign * stats.speed * dt), scale(strafe, wobble * stats.speed * dt));
  return moveWithCollision(arena, e.position, stats.radius, stats.height, step);
};

/** The attack an in-range enemy performs now: a bolt at the eye with spread, or a zap. */
const attackAction = (
  e: Enemy,
  position: Vec3,
  playerEye: Vec3,
  dist: number,
  rng: Rng,
): EnemyAction => {
  const stats = ENEMY_STATS[e.kind];
  if (!stats.ranged) return { type: 'melee', damage: stats.damage };
  const origin = add(position, vec3(0, stats.height * 0.75, 0));
  const spread = 0.04;
  const aim = add(
    sub(playerEye, origin),
    vec3(rng.range(-spread, spread) * dist, rng.range(-spread, spread) * dist, 0),
  );
  return { type: 'bolt', origin, direction: normalize(aim), damage: stats.damage };
};

/** Advances one enemy by `dt`. Pure: returns the new enemy plus any attack it performs. */
export const updateEnemy = (
  e: Enemy,
  arena: Arena,
  playerFeet: Vec3,
  playerEye: Vec3,
  dt: number,
  now: number,
  rng: Rng,
): EnemyUpdate => {
  if (e.state === 'dead') return { enemy: e, action: null };
  if (e.state === 'spawning') {
    return { enemy: now >= e.activeAt ? { ...e, state: 'chase' } : e, action: null };
  }
  if (e.state === 'flee' && e.fleeUntil !== null && now < e.fleeUntil) {
    return { enemy: fleeStep(e, arena, playerFeet, dt), action: null };
  }
  // A rout that has run its course falls through to the chase-or-attack decision below.
  const toPlayer = sub(playerFeet, e.position);
  const dist = distanceXZ(playerFeet, e.position);
  const yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
  const inRange = dist <= ENEMY_STATS[e.kind].attackRange;
  const position = pursueStep(e, arena, toPlayer, dist, dt, rng);
  const state: EnemyState = inRange ? 'attack' : 'chase';
  const attacking = inRange && now >= e.nextAttackAt;
  const nextAttackAt = attacking ? now + ENEMY_STATS[e.kind].attackInterval : e.nextAttackAt;
  const action = attacking ? attackAction(e, position, playerEye, dist, rng) : null;
  return { enemy: { ...e, position, yaw, state, nextAttackAt, fleeUntil: null }, action };
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
