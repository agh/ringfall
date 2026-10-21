import { rayAabb } from './raycast';
import type { Rng } from './rng';
import { add, distanceXZ, dot, normalize, scale, sub, type Vec3, vec3, ZERO } from './vec3';
import { updateWatcher, WATCHER_STATS, type WatcherAction } from './watcher';
import { type Arena, circleHitsBoxXZ, moveWithCollision, pointInsideAabbXZ } from './world';

export type EnemyKind = 'skimmer' | 'strider' | 'watcher';
export type EnemyState = 'spawning' | 'chase' | 'attack' | 'flee' | 'dead';

/** Skimmers this close (XZ metres) to a strider when it dies break and run. */
export const FLEE_RADIUS = 25;
/** How long a rout lasts before the skimmer returns to `chase`. */
export const FLEE_DURATION = 4;
/** Fleeing speed as a multiple of the skimmer's chase speed. */
export const FLEE_SPEED_FACTOR = 1.3;
/** Speed multiple of an enemy leaving the arena for good after the final leader falls. */
export const FLEE_EXIT_SPEED_FACTOR = 2;
/** How far past the arena edge an exiting enemy may travel; the game removes it there. */
export const FLEE_EXIT_MARGIN = 6;
/**
 * Seconds a moving enemy may go without headway toward its goal before it sidesteps round
 * whatever is blocking it. Sliding along cover at a shallow angle still counts as headway; a
 * corner that blocks both axes, or a face the player stands straight behind, does not.
 */
export const STUCK_AFTER = 1;
/** Longest a sidestep lasts before the enemy tries the straight line again. */
export const DETOUR_MAX = 3;
/** A step is headway when it covers this fraction of the intended distance along the heading. */
export const HEADWAY_FRACTION = 0.25;
/** The straight line is open again when a probe along it covers this fraction unobstructed. */
export const OPEN_FRACTION = 0.9;
/**
 * How far the probe looks, in body radii. One step is not enough: the slide frees a single
 * step on the diagonal of a corner and blocks the next, which would end a detour every second.
 */
export const OPEN_LOOKAHEAD = 2;
/** A sidestep is given up when it covers less than this fraction (a slide along cover counts). */
export const SIDESTEP_FRACTION = 0.1;
/** What a routed skimmer shouts. Original lines; the first rout of a pack always calls the first. */
export const BARK_LINES = ['LEADER DOWN', 'FALL BACK', 'REGROUP'] as const;
export type BarkLine = (typeof BARK_LINES)[number];

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
  watcher: WATCHER_STATS,
};

export interface Enemy {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly position: Vec3;
  readonly health: number;
  /** Full health at spawn; the archetype's value times the wave's health scale. */
  readonly maxHealth: number;
  /** The wave's leader, whose death can end the wave (see `WaveBeat.ending`). */
  readonly leader: boolean;
  readonly state: EnemyState;
  readonly yaw: number;
  /** Simulation time the enemy becomes active. */
  readonly activeAt: number;
  readonly nextAttackAt: number;
  /** Simulation time of death, used by the renderer for a short fade. */
  readonly diedAt: number | null;
  /**
   * Simulation time a `flee` ends: finite for a rout, `Number.POSITIVE_INFINITY` for an enemy
   * leaving the arena for good, null in every other state.
   */
  readonly fleeUntil: number | null;
  /** Movement policy; only skimmers read it, striders carry the default. */
  readonly temperament: Temperament;
  /** Simulation time of the last step that made headway toward the goal (see `STUCK_AFTER`). */
  readonly headwayAt: number;
  /** The sidestep in progress round a blocker, or null while the straight line works. */
  readonly detour: Detour | null;
}

/** A sidestep: a horizontal unit direction held until `until` or until the straight line opens. */
export interface Detour {
  readonly direction: Vec3;
  readonly until: number;
  /** True once the sidestep has reversed; a second block then backs out instead of reversing. */
  readonly flipped: boolean;
}

export const SPAWN_DELAY = 1;

export interface SpawnOptions {
  /** Seconds the enemy spends `spawning` (invulnerable) before it acts; `SPAWN_DELAY` by default. */
  readonly spawnDelay?: number;
  /** Multiplier on the archetype's health; 1 by default. */
  readonly healthScale?: number;
  readonly leader?: boolean;
  /** Movement policy for skimmers; `chaser` by default. */
  readonly temperament?: Temperament;
}

export const createEnemy = (
  id: number,
  kind: EnemyKind,
  position: Vec3,
  now: number,
  options: SpawnOptions = {},
): Enemy => {
  const spawnDelay = options.spawnDelay ?? SPAWN_DELAY;
  const maxHealth = ENEMY_STATS[kind].maxHealth * (options.healthScale ?? 1);
  return {
    id,
    kind,
    position,
    health: maxHealth,
    maxHealth,
    leader: options.leader ?? false,
    state: 'spawning',
    yaw: 0,
    activeAt: now + spawnDelay,
    nextAttackAt: now + spawnDelay + 0.5,
    diedAt: null,
    fleeUntil: null,
    temperament: options.temperament ?? 'chaser',
    headwayAt: now + spawnDelay,
    detour: null,
  };
};

/**
 * Sends a live enemy off the arena for good: `flee` with no end, used when the final leader
 * falls. Any kind and any live state, spawning included; the dead stay where they fell.
 */
export const startExit = (e: Enemy): Enemy =>
  e.state === 'dead'
    ? e
    : { ...e, state: 'flee', fleeUntil: Number.POSITIVE_INFINITY, detour: null };

/** True for an enemy leaving the arena for good (as opposed to a timed rout). */
export const isExiting = (e: Enemy): boolean =>
  e.state === 'flee' && e.fleeUntil === Number.POSITIVE_INFINITY;

/** True once an exiting enemy is far enough past the arena edge to be removed. */
export const hasFled = (e: Enemy, arena: Arena): boolean =>
  isExiting(e) &&
  Math.max(Math.abs(e.position.x), Math.abs(e.position.z)) >=
    arena.halfSize + FLEE_EXIT_MARGIN - ENEMY_STATS[e.kind].radius;

/**
 * Routs a skimmer: it enters `flee` until `now + FLEE_DURATION`. A skimmer already routed has
 * its timer refreshed; one leaving for good (`startExit`) keeps leaving. Striders never flee,
 * and a spawning or dead enemy is returned unchanged.
 */
export const startFlee = (e: Enemy, now: number): Enemy => {
  if (e.kind !== 'skimmer' || e.state === 'spawning' || e.state === 'dead') return e;
  if (isExiting(e)) return e;
  return { ...e, state: 'flee', fleeUntil: now + FLEE_DURATION, detour: null };
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
    }
  | WatcherAction;

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
  // A rout stops at the arena edge; an exit runs faster and out past it, where the game removes it.
  const exiting = isExiting(e);
  const factor = exiting ? FLEE_EXIT_SPEED_FACTOR : FLEE_SPEED_FACTOR;
  const bounds: Arena = exiting ? { ...arena, halfSize: arena.halfSize + FLEE_EXIT_MARGIN } : arena;
  const step = scale(dir, stats.speed * factor * dt);
  const position = moveWithCollision(bounds, e.position, stats.radius, stats.height, step);
  return { ...e, position, yaw: Math.atan2(-dir.x, -dir.z) };
};

/** Where a ranged enemy's bolts leave it: three quarters of the way up the body. */
export const boltOrigin = (e: Enemy, position = e.position): Vec3 =>
  add(position, vec3(0, ENEMY_STATS[e.kind].height * 0.75, 0));

/** True when nothing but air lies between a ranged enemy's muzzle and the player's eye. */
export const hasClearShot = (e: Enemy, arena: Arena, playerEye: Vec3): boolean => {
  const origin = boltOrigin(e);
  const line = sub(playerEye, origin);
  const reach = Math.hypot(line.x, line.y, line.z);
  if (reach < 1e-6) return true;
  const dir = scale(line, 1 / reach);
  return arena.obstacles.every((box) => rayAabb(origin, dir, box, reach) === null);
};

/**
 * Where this enemy wants to go this step, and whether it is closing (+1) or backing off (-1).
 * `sees` is whether a ranged enemy has a clear shot; one that does not closes whatever the range,
 * since holding the band behind cover is standing still and firing into a block.
 */
const moveIntent = (
  e: Enemy,
  playerFeet: Vec3,
  dist: number,
  tracking: Tracking,
  sees: boolean,
): { readonly goal: Vec3; readonly sign: number } | null => {
  const stats = ENEMY_STATS[e.kind];
  const inRange = dist <= stats.attackRange;
  if (stats.ranged) {
    // Close in, or back off when a ranged unit gets crowded.
    if (!inRange || !sees) return { goal: playerFeet, sign: 1 };
    return dist < stats.attackRange * 0.5 ? { goal: playerFeet, sign: -1 } : null;
  }
  if (inRange) return null;
  const goal = chaseGoal(e.temperament, e.position, playerFeet, tracking);
  return goal === null ? null : { goal, sign: 1 };
};

/**
 * Which way to sidestep round whatever blocks a step along `heading`: along the blocking box's
 * face toward its nearer end, so the detour is the short way round. A coin flip from the seeded
 * `rng` when the blocker is the arena edge, or when a detour has already lapsed (`retry`), so
 * the same dead end is not walked twice.
 */
export const sidestepDirection = (
  arena: Arena,
  position: Vec3,
  radius: number,
  heading: Vec3,
  rng: Rng,
  retry = false,
): Vec3 => {
  const strafe = vec3(-heading.z, 0, heading.x);
  const ahead = add(position, scale(heading, radius));
  const blocker = retry
    ? undefined
    : arena.obstacles.find((box) => circleHitsBoxXZ(ahead.x, ahead.z, radius, box));
  if (blocker === undefined) return rng.next() < 0.5 ? strafe : scale(strafe, -1);
  const corners = [
    vec3(blocker.min.x, 0, blocker.min.z),
    vec3(blocker.min.x, 0, blocker.max.z),
    vec3(blocker.max.x, 0, blocker.min.z),
    vec3(blocker.max.x, 0, blocker.max.z),
  ].map((c) => dot(c, strafe));
  const here = dot(position, strafe);
  const plus = Math.max(...corners) - here;
  const minus = here - Math.min(...corners);
  return plus <= minus ? strafe : scale(strafe, -1);
};

/** Where a pursuit step left the enemy, and the headway bookkeeping that goes with it. */
interface Pursuit {
  readonly position: Vec3;
  readonly headwayAt: number;
  readonly detour: Detour | null;
}

/**
 * One step of a detour: the straight line when it has opened, else the sidestep, its reverse
 * when that is blocked, or a step backward once both ends have been tried. Boxed in on every
 * side, the detour is dropped so the detector picks again after `STUCK_AFTER`.
 */
const detourStep = (
  e: Enemy,
  detour: Detour,
  heading: Vec3,
  reach: number,
  lookahead: number,
  now: number,
  move: (step: Vec3) => Vec3,
): Pursuit => {
  const headway = (to: Vec3, along: Vec3): number => dot(sub(to, e.position), along);
  const probe = move(scale(heading, lookahead));
  if (headway(probe, heading) >= OPEN_FRACTION * lookahead) {
    return { position: move(scale(heading, reach)), headwayAt: now, detour: null };
  }
  const reverse = detour.flipped ? [] : [scale(detour.direction, -1)];
  for (const direction of [detour.direction, ...reverse, scale(heading, -1)]) {
    const to = move(scale(direction, reach));
    if (headway(to, direction) < SIDESTEP_FRACTION * reach) continue;
    const next =
      direction === detour.direction
        ? detour
        : { direction, until: now + DETOUR_MAX, flipped: true };
    return { position: to, headwayAt: e.headwayAt, detour: next };
  }
  return { position: e.position, headwayAt: e.headwayAt, detour: null };
};

/**
 * Steps toward the temperament's goal (or away from a crowding player, for a ranged unit). A
 * little lateral jitter keeps groups from stacking into a single line. Returns the position
 * unchanged when holding range or holding position.
 *
 * Collision slides along cover, which fails in two places: a convex corner blocks both axes at
 * once, and a face the goal sits straight behind leaves only the jitter, a random walk that
 * never reaches a corner. After `STUCK_AFTER` without headway the enemy sidesteps along the
 * blocker (`sidestepDirection`) until the straight line opens or `DETOUR_MAX` lapses; a
 * sidestep that is itself blocked flips, and one blocked both ways backs out.
 */
const pursueStep = (
  e: Enemy,
  arena: Arena,
  playerFeet: Vec3,
  dist: number,
  dt: number,
  now: number,
  rng: Rng,
  tracking: Tracking,
  sees: boolean,
): Pursuit => {
  const intent = moveIntent(e, playerFeet, dist, tracking, sees);
  // Holding range or holding position is a choice, not a dead end.
  if (intent === null) return { position: e.position, headwayAt: now, detour: null };
  const stats = ENEMY_STATS[e.kind];
  // A goal inside cover would pin the enemy against the block; the player's feet never are.
  const blocked = arena.obstacles.some((box) => pointInsideAabbXZ(intent.goal, box, stats.radius));
  const toGoal = sub(blocked ? playerFeet : intent.goal, e.position);
  const heading = scale(normalize(vec3(toGoal.x, 0, toGoal.z)), intent.sign);
  const reach = stats.speed * dt;
  const move = (step: Vec3): Vec3 =>
    moveWithCollision(arena, e.position, stats.radius, stats.height, step);
  const headway = (to: Vec3, along: Vec3): number => dot(sub(to, e.position), along);

  const detour = e.detour !== null && now < e.detour.until ? e.detour : null;
  if (detour !== null) {
    const lookahead = OPEN_LOOKAHEAD * stats.radius;
    return detourStep(e, detour, heading, reach, lookahead, now, move);
  }

  const strafe = vec3(-heading.z, 0, heading.x);
  const wobble = (rng.next() - 0.5) * 0.6;
  const position = move(add(scale(heading, reach), scale(strafe, wobble * reach)));
  if (headway(position, heading) >= HEADWAY_FRACTION * reach) {
    return { position, headwayAt: now, detour: null };
  }
  if (now - e.headwayAt < STUCK_AFTER) return { position, headwayAt: e.headwayAt, detour: null };
  const direction = sidestepDirection(
    arena,
    position,
    stats.radius,
    heading,
    rng,
    e.detour !== null,
  );
  const fresh: Detour = { direction, until: now + DETOUR_MAX, flipped: false };
  return { position, headwayAt: now, detour: fresh };
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
  const origin = boltOrigin(e, position);
  const spread = 0.04;
  const aim = add(
    sub(playerEye, origin),
    vec3(rng.range(-spread, spread) * dist, rng.range(-spread, spread) * dist, 0),
  );
  return { type: 'bolt', origin, direction: normalize(aim), damage: stats.damage };
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
    const woken: Enemy = { ...e, state: 'chase', headwayAt: now, detour: null };
    return { enemy: now >= e.activeAt ? woken : e, action: null };
  }
  if (e.state === 'flee' && e.fleeUntil !== null && now < e.fleeUntil) {
    return { enemy: fleeStep(e, arena, playerFeet, dt), action: null };
  }
  // The dead, the spawning and the fleeing are handled above for every kind, the exit after the
  // final leader included; the watcher has its own chase and attack.
  if (e.kind === 'watcher') return updateWatcher(e, arena, playerFeet, playerEye, dt, now, rng);
  // A rout that has run its course falls through to the chase-or-attack decision below, with
  // the headway clock restarted so the rout itself never reads as a dead end.
  const toPlayer = sub(playerFeet, e.position);
  const dist = distanceXZ(playerFeet, e.position);
  const yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
  const inRange = dist <= ENEMY_STATS[e.kind].attackRange;
  const mover: Enemy = e.state === 'flee' ? { ...e, headwayAt: now, detour: null } : e;
  const sees = ENEMY_STATS[e.kind].ranged ? hasClearShot(e, arena, playerEye) : true;
  const { position, headwayAt, detour } = pursueStep(
    mover,
    arena,
    playerFeet,
    dist,
    dt,
    now,
    rng,
    tracking,
    sees,
  );
  const state: EnemyState = inRange ? 'attack' : 'chase';
  const attacking = inRange && now >= e.nextAttackAt;
  const nextAttackAt = attacking ? now + ENEMY_STATS[e.kind].attackInterval : e.nextAttackAt;
  const action = attacking ? attackAction(e, position, playerEye, dist, rng) : null;
  return {
    enemy: { ...e, position, yaw, state, nextAttackAt, fleeUntil: null, headwayAt, detour },
    action,
  };
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
