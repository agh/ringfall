import type { Rng } from './rng';
import { add, distanceXZ, normalize, scale, sub, type Vec3, vec3 } from './vec3';
import { updateWatcher, WATCHER_STATS, type WatcherAction } from './watcher';
import { type Arena, moveWithCollision } from './world';

export type EnemyKind = 'skimmer' | 'strider' | 'watcher';
export type EnemyState = 'spawning' | 'chase' | 'attack' | 'dead';

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
  watcher: WATCHER_STATS,
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
});

export type EnemyAction =
  | { readonly type: 'melee'; readonly damage: number }
  | {
      readonly type: 'bolt';
      readonly origin: Vec3;
      readonly direction: Vec3;
      readonly damage: number;
    }
  | WatcherAction;

export interface EnemyUpdate {
  readonly enemy: Enemy;
  readonly action: EnemyAction | null;
}

export const enemyCenter = (e: Enemy): Vec3 =>
  add(e.position, vec3(0, ENEMY_STATS[e.kind].height / 2, 0));

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
  if (e.kind === 'watcher') return updateWatcher(e, arena, playerFeet, playerEye, dt, now, rng);
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
  if (!inRange || (stats.ranged && dist < stats.attackRange * 0.5)) {
    // Close in, or back off when a ranged unit gets crowded. A little lateral jitter keeps
    // groups from stacking into a single line.
    const dir = normalize(vec3(toPlayer.x, 0, toPlayer.z));
    const sign = !inRange ? 1 : -1;
    const strafe = vec3(-dir.z, 0, dir.x);
    const wobble = (rng.next() - 0.5) * 0.6;
    const step = add(scale(dir, sign * stats.speed * dt), scale(strafe, wobble * stats.speed * dt));
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
