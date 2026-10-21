import type { Enemy, EnemyStats, EnemyUpdate } from './enemy';
import { hitscan } from './raycast';
import type { Rng } from './rng';
import { add, distanceXZ, normalize, scale, sub, type Vec3, vec3 } from './vec3';
import { type Arena, moveWithCollision } from './world';

/**
 * The watcher: a tall perimeter sentinel. It never closes; it holds a band of distance from the
 * player, strafes slowly around them, and fires a slow hitscan beam after a long telegraph. The
 * beam stops at cover, so the counter is to break line of sight or kill it while it charges.
 *
 * State mapping onto `EnemyState`: 'chase' is holding the perimeter (moving or cooling down),
 * 'attack' is charging and standing still with `nextAttackAt` as the moment the beam fires.
 */
export const WATCHER_MIN_RANGE = 24;
export const WATCHER_MAX_RANGE = 32;
/** The watcher still fires at a player who closes inside the band, up to this distance. */
export const WATCHER_FIRE_RANGE = 36;
/** Telegraph: the lens brightens from Rose to white and an aiming line is drawn to the player. */
export const WATCHER_CHARGE = 1.2;
/** How long the renderer shows the beam; the damage lands at the instant it fires. */
export const WATCHER_BEAM_DURATION = 0.15;
/** Pause between the end of one beam and the start of the next charge. */
export const WATCHER_COOLDOWN = 3.5;
export const WATCHER_BEAM_RANGE = 200;
/** Fraction of full speed used while orbiting the player inside the band. */
export const WATCHER_STRAFE_FRACTION = 0.5;
/** The beam aims at the eye; this sphere around it is what the beam has to reach. */
export const WATCHER_PLAYER_HIT_RADIUS = 0.5;
const PLAYER_TARGET_ID = -1;

export const WATCHER_STATS: EnemyStats = {
  maxHealth: 160,
  speed: 2,
  radius: 0.8,
  height: 3.5,
  attackRange: WATCHER_FIRE_RANGE,
  attackInterval: WATCHER_CHARGE + WATCHER_COOLDOWN,
  damage: 35,
  score: 400,
  ranged: true,
};

/** Height of the lens above the feet; the beam and the aiming line start here. */
export const WATCHER_LENS_HEIGHT = WATCHER_STATS.height * 0.9;

export type WatcherAction =
  | { readonly type: 'watcherCharge'; readonly at: Vec3 }
  | {
      readonly type: 'watcherBeam';
      readonly from: Vec3;
      readonly to: Vec3;
      readonly hit: boolean;
      readonly damage: number;
    };

export const watcherLens = (position: Vec3): Vec3 => add(position, vec3(0, WATCHER_LENS_HEIGHT, 0));

/** 0 outside a charge, rising to 1 at the moment the beam fires. */
export const watcherChargeProgress = (e: Enemy, now: number): number => {
  if (e.kind !== 'watcher' || e.state !== 'attack') return 0;
  return Math.min(1, Math.max(0, 1 - (e.nextAttackAt - now) / WATCHER_CHARGE));
};

/** True when nothing but air lies between the lens and the player's eye. */
export const watcherHasLineOfSight = (lens: Vec3, playerEye: Vec3, arena: Arena): boolean => {
  const offset = sub(playerEye, lens);
  const dist = Math.hypot(offset.x, offset.y, offset.z);
  if (dist < 1e-6) return true;
  const hit = hitscan(lens, scale(offset, 1 / dist), [], arena.obstacles, dist);
  return hit.distance >= dist - 1e-6;
};

const fireBeam = (lens: Vec3, playerEye: Vec3, arena: Arena): WatcherAction => {
  const dir = normalize(sub(playerEye, lens));
  const hit = hitscan(
    lens,
    dir,
    [{ id: PLAYER_TARGET_ID, center: playerEye, radius: WATCHER_PLAYER_HIT_RADIUS }],
    arena.obstacles,
    WATCHER_BEAM_RANGE,
  );
  return {
    type: 'watcherBeam',
    from: lens,
    to: add(lens, scale(dir, hit.distance)),
    hit: hit.targetId === PLAYER_TARGET_ID,
    damage: WATCHER_STATS.damage,
  };
};

/** One step of perimeter holding: close to the band, back off from it, or orbit inside it. */
const holdPerimeter = (
  e: Enemy,
  arena: Arena,
  toPlayer: Vec3,
  dist: number,
  dt: number,
  rng: Rng,
): Vec3 => {
  const dir = normalize(vec3(toPlayer.x, 0, toPlayer.z));
  const tangent = vec3(-dir.z, 0, dir.x);
  const orbit = e.id % 2 === 0 ? 1 : -1;
  const speed = WATCHER_STATS.speed * dt;
  let step: Vec3;
  if (dist > WATCHER_MAX_RANGE) step = scale(dir, speed);
  else if (dist < WATCHER_MIN_RANGE) step = scale(dir, -speed);
  else step = scale(tangent, orbit * WATCHER_STRAFE_FRACTION * speed * (0.8 + rng.next() * 0.4));
  return moveWithCollision(arena, e.position, WATCHER_STATS.radius, WATCHER_STATS.height, step);
};

/** Advances one watcher by `dt`. Same contract as `updateEnemy`, which dispatches here. */
export const updateWatcher = (
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
  const toPlayer = sub(playerFeet, e.position);
  const yaw = Math.atan2(-toPlayer.x, -toPlayer.z);

  if (e.state === 'attack') {
    // Charging: a static target until the beam fires at the eye's position at that instant.
    if (now < e.nextAttackAt) return { enemy: { ...e, yaw }, action: null };
    const action = fireBeam(watcherLens(e.position), playerEye, arena);
    const nextAttackAt = now + WATCHER_COOLDOWN;
    return { enemy: { ...e, yaw, state: 'chase', nextAttackAt }, action };
  }

  const dist = distanceXZ(playerFeet, e.position);
  const position = holdPerimeter(e, arena, toPlayer, dist, dt, rng);
  const lens = watcherLens(position);
  const canFire =
    now >= e.nextAttackAt &&
    dist <= WATCHER_FIRE_RANGE &&
    watcherHasLineOfSight(lens, playerEye, arena);
  if (!canFire) return { enemy: { ...e, position, yaw, state: 'chase' }, action: null };
  return {
    enemy: { ...e, position, yaw, state: 'attack', nextAttackAt: now + WATCHER_CHARGE },
    action: { type: 'watcherCharge', at: lens },
  };
};
