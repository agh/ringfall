import { ENEMY_STATS, type Enemy, enemyCenter } from './enemy';
import { type GameState, IDLE_INPUT, type InputFrame, playerEye } from './game';
import { ROUND_BLAST_RADIUS } from './grenade';
import type { Pickup } from './pickups';
import { hitscan } from './raycast';
import type { Rng } from './rng';
import { directionFromAngles, distanceXZ, normalize, sub, type Vec3 } from './vec3';
import { totalAmmo, type Weapon, weaponSpec } from './weapon';
import type { Aabb } from './world';

/**
 * A scripted player. It reads the same immutable state a human sees on the HUD (enemy positions,
 * bolts, shield, ammo) and emits the same InputFrame a keyboard and mouse would. Because the
 * simulation is deterministic, a bot run with a fixed seed is a reproducible playtest: the same
 * run drives balance measurement in Node, smoke tests in Playwright, and the demo recording.
 */
/** Matches the HUD tracker range in src/hud/hud.ts. */
const TRACKER_RANGE = 28;
/** The bot walks to a pickup it can see within this many metres when nothing is shooting at it. */
const PICKUP_SEEK_RANGE = 14;
/** Seconds between weapon swaps, so an empty pair of guns does not flip every step. */
const SWAP_COOLDOWN = 0.5;
/** The scatter gun is only worth firing inside this range. */
const SCATTER_RANGE = 10;
/** Launcher rounds are fired at striders and clusters inside this band; closer risks self-damage. */
const LAUNCHER_MIN = 8;
const LAUNCHER_MAX = 20;
/**
 * A launcher round bursts on the first cover it touches. Cover on the aim ray closer than this
 * puts the bot inside its own blast, whatever the distance to the target (issue #24).
 */
const LAUNCHER_COVER_CLEARANCE = ROUND_BLAST_RADIUS + 1;
const MINIGUN_TOLERANCE = 0.08;
/** Target-score multiplier for a charging watcher in sight: it beats anything inside 40 m. */
const WATCHER_CHARGE_URGENCY = 0.15;
/** Striders and watchers are the big, slow targets the heavy weapons and grenades are for. */
const isHeavyTarget = (e: Enemy | null): boolean => e?.kind === 'strider' || e?.kind === 'watcher';
/** Guns that can hit a thin target at 24 to 32 m: the rest are out of range or too wide. */
const reachesWatcher = (w: Weapon): boolean =>
  w.kind === 'rifle' || w.kind === 'laser' || w.kind === 'beam';

export interface BotProfile {
  /** Degrees per second the bot can turn; low values feel human. */
  readonly turnRate: number;
  /** Aim error in radians, scaled down as the bot settles on a target. */
  readonly jitter: number;
  /** Shield fraction below which the bot breaks contact and retreats. */
  readonly retreatShield: number;
  /** Fire when the aim error is below this many radians. */
  readonly fireTolerance: number;
  /** Minimum enemies clustered within 5 m of the target to spend a grenade. */
  readonly grenadeCluster: number;
}

export const STEADY_BOT: BotProfile = {
  turnRate: 260,
  jitter: 0.02,
  retreatShield: 0.3,
  fireTolerance: 0.05,
  grenadeCluster: 2,
};

export const RECKLESS_BOT: BotProfile = {
  turnRate: 320,
  jitter: 0.035,
  retreatShield: 0,
  fireTolerance: 0.08,
  grenadeCluster: 1,
};

export interface BotMemory {
  readonly yaw: number;
  readonly pitch: number;
  readonly strafeSign: number;
  readonly strafeUntil: number;
  readonly lastGrenadeAt: number;
  readonly lastSwapAt: number;
}

export const createBotMemory = (): BotMemory => ({
  yaw: 0,
  pitch: 0,
  strafeSign: 1,
  strafeUntil: 0,
  lastGrenadeAt: -10,
  lastSwapAt: -10,
});

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

const anglesTo = (from: Vec3, to: Vec3): { yaw: number; pitch: number } => {
  const d = sub(to, from);
  const flat = Math.hypot(d.x, d.z);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, flat) };
};

const pickTarget = (state: GameState): Enemy | null => {
  const eye = playerEye(state.player);
  let best: Enemy | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const enemy of state.enemies) {
    if (enemy.state === 'dead' || enemy.state === 'spawning') continue;
    const center = enemyCenter(enemy);
    const dist = distanceXZ(eye, center);
    const toward = normalize(sub(center, eye));
    const hit = hitscan(
      eye,
      toward,
      [{ id: enemy.id, center, radius: ENEMY_STATS[enemy.kind].radius }],
      state.arena.obstacles,
      150,
    );
    const visible = hit.targetId === enemy.id;
    // A player knows about enemies they can see or that show on the 28 m tracker; nothing else.
    if (!visible && dist > TRACKER_RANGE) continue;
    // Prefer visible and close enemies; skimmers in melee range are urgent, and a charging
    // watcher in sight is a static target about to land 35 damage, so it comes first. Once a
    // watcher has taken damage the bot finishes it rather than drifting back to nearer targets
    // between charges: a 160-health sentinel left at half health keeps firing.
    const engagedWatcher =
      enemy.kind === 'watcher' &&
      visible &&
      (enemy.state === 'attack' || enemy.health < ENEMY_STATS.watcher.maxHealth);
    const urgency = engagedWatcher
      ? WATCHER_CHARGE_URGENCY
      : enemy.kind === 'skimmer' && dist < 6
        ? 0.3
        : 1;
    const score = (visible ? dist : dist * 4) * urgency;
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
};

/**
 * Distance from the eye to the first cover block on the aim ray, when that block is nearer than
 * the target and within the self-blast clearance. Null means the round reaches the target, open
 * air, or cover far enough away to burst harmlessly.
 */
const coverOnAimRay = (
  eye: Vec3,
  yaw: number,
  pitch: number,
  target: Enemy,
  obstacles: readonly Aabb[],
): number | null => {
  const hit = hitscan(
    eye,
    directionFromAngles(yaw, pitch),
    [{ id: target.id, center: enemyCenter(target), radius: ENEMY_STATS[target.kind].radius }],
    obstacles,
    LAUNCHER_COVER_CLEARANCE,
  );
  return hit.targetId === null && hit.distance < LAUNCHER_COVER_CLEARANCE ? hit.distance : null;
};

/**
 * Trigger logic per weapon kind. The beam is held until charged and released when the aim
 * settles; the scatter gun waits for close range; the launcher wants striders or clusters at a
 * safe distance with no cover in the way of the round; the minigun is forgiving of aim because
 * its spread is wide anyway.
 */
const decideFire = (
  weapon: Weapon,
  target: Enemy | null,
  aimError: number,
  dist: number,
  cluster: number,
  profile: BotProfile,
  coverDist: number | null,
): boolean => {
  if (!target || weapon.magazine === 0) return false;
  const spec = weaponSpec(weapon);
  if (spec.chargeTime > 0) return weapon.charge < 1 || aimError >= profile.fireTolerance;
  if (spec.projectile) {
    const worth = isHeavyTarget(target) || cluster >= 2;
    if (coverDist !== null && coverDist < LAUNCHER_COVER_CLEARANCE) return false;
    return (
      worth && dist >= LAUNCHER_MIN && dist <= LAUNCHER_MAX && aimError < profile.fireTolerance
    );
  }
  if (spec.pellets > 1) return dist <= SCATTER_RANGE && aimError < profile.fireTolerance * 2;
  if (spec.spinUp > 0) return aimError < MINIGUN_TOLERANCE;
  // A watcher at 24 to 32 m subtends less than the usual tolerance: wait for the reticle to
  // settle on it rather than spending the magazine around it.
  if (target.kind === 'watcher')
    return aimError < Math.min(profile.fireTolerance, ENEMY_STATS.watcher.radius / dist);
  return aimError < profile.fireTolerance;
};

/**
 * Swap when the active weapon is dry and the other has ammo, when a strider shows up and the
 * holster holds something heavy, or when a heavy weapon faces a skimmer too close to use it.
 */
const decideSwap = (
  player: GameState['player'],
  target: Enemy | null,
  dist: number,
  sinceSwap: number,
): boolean => {
  const weapon = player.weapon;
  const offHand = player.weapons[player.activeSlot === 0 ? 1 : 0];
  if (!offHand || totalAmmo(offHand) === 0 || sinceSwap <= SWAP_COOLDOWN) return false;
  const isHeavy = (w: Weapon): boolean => w.kind === 'beam' || w.kind === 'launcher';
  const striderInSight = target?.kind === 'strider';
  if (totalAmmo(weapon) === 0) return true;
  // A watcher sits beyond the launcher, scatter and minigun; only a precise gun reaches it.
  if (target?.kind === 'watcher') return !reachesWatcher(weapon) && reachesWatcher(offHand);
  if (weapon.kind === 'rifle' && striderInSight && isHeavy(offHand)) return true;
  return isHeavy(weapon) && target?.kind === 'skimmer' && dist < LAUNCHER_MIN;
};

const nearestPickup = (state: GameState): Pickup | null => {
  const feet = state.player.position;
  let best: Pickup | null = null;
  let bestDist = PICKUP_SEEK_RANGE;
  for (const p of state.pickups) {
    const d = distanceXZ(p.position, feet);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
};

export interface BotDecision {
  readonly input: InputFrame;
  readonly memory: BotMemory;
}

/** One decision per simulation step. Pure: same state, memory, and rng give the same input. */
export const decideBot = (
  state: GameState,
  memory: BotMemory,
  profile: BotProfile,
  dt: number,
  rng: Rng,
): BotDecision => {
  const { player } = state;
  const eye = playerEye(player);
  const target = pickTarget(state);
  const shieldFrac = player.vitality.shield / player.vitality.maxShield;
  const maxTurn = ((profile.turnRate * Math.PI) / 180) * dt;

  let yaw = memory.yaw;
  let pitch = memory.pitch;
  let aimError = Math.PI;
  if (target) {
    const center = enemyCenter(target);
    const want = anglesTo(eye, center);
    const jitter = profile.jitter * (0.3 + rng.next() * 0.7);
    const dy = wrapAngle(want.yaw + jitter * (rng.next() - 0.5) - yaw);
    const dp = want.pitch + jitter * (rng.next() - 0.5) - pitch;
    yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    pitch += Math.max(-maxTurn, Math.min(maxTurn, dp));
    aimError = Math.hypot(wrapAngle(want.yaw - yaw), want.pitch - pitch);
  } else {
    // Scan for the next wave by sweeping slowly.
    yaw = wrapAngle(yaw + 0.4 * dt);
    pitch = pitch * 0.9;
  }

  // Movement: strafe in bursts to dodge bolts, retreat on low shield, close on far targets.
  let strafeSign = memory.strafeSign;
  let strafeUntil = memory.strafeUntil;
  if (state.time >= strafeUntil) {
    strafeSign = rng.next() < 0.5 ? -1 : 1;
    strafeUntil = state.time + 0.6 + rng.next() * 0.9;
  }
  const incomingBolt = state.bolts.some((b) => distanceXZ(b.position, eye) < 6);
  let forward = 0;
  let strafe = incomingBolt || target ? strafeSign : 0;
  if (target) {
    const dist = distanceXZ(eye, target.position);
    const retreating = shieldFrac < profile.retreatShield;
    if (retreating) forward = -1;
    // A watcher backs off as fast as it is approached; closing on it only leaves cover behind.
    else if (dist > 22 && target.kind !== 'watcher') forward = 1;
    else if (dist < 4 && target.kind === 'skimmer') forward = -1;
    if (retreating) strafe = strafeSign;
  }

  const dist = target ? distanceXZ(eye, target.position) : Number.POSITIVE_INFINITY;
  const cluster = target
    ? state.enemies.filter((e) => e.state !== 'dead' && distanceXZ(e.position, target.position) < 5)
        .length
    : 0;

  // Grenade: lob at a cluster or a strider at a comfortable range.
  let throwGrenade = false;
  let lastGrenadeAt = memory.lastGrenadeAt;
  if (target && player.grenades > 0 && state.time - lastGrenadeAt > 3) {
    if (dist > 8 && dist < 22 && (cluster >= profile.grenadeCluster || isHeavyTarget(target))) {
      throwGrenade = true;
      lastGrenadeAt = state.time;
    }
  }

  const weapon = player.weapon;
  const magazine = weapon.magazine;
  const reload = magazine === 0 || (magazine < weapon.magazineSize / 4 && !target);
  if (target && weapon.kind === 'scatter' && dist > SCATTER_RANGE && forward === 0) forward = 1;
  const coverDist =
    target && weaponSpec(weapon).projectile
      ? coverOnAimRay(eye, yaw, pitch, target, state.arena.obstacles)
      : null;
  const fire = decideFire(weapon, target, aimError, dist, cluster, profile, coverDist);

  const swapWeapon = decideSwap(player, target, dist, state.time - memory.lastSwapAt);
  const lastSwapAt = swapWeapon ? state.time : memory.lastSwapAt;

  // With nothing to shoot, walk to a nearby pickup; a new gun is worth more than a sweep.
  const pickup = target ? null : nearestPickup(state);
  if (pickup) {
    const want = anglesTo(player.position, pickup.position);
    yaw += Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(want.yaw - yaw)));
    forward = 1;
    strafe = 0;
  }

  return {
    input: {
      ...IDLE_INPUT,
      forward,
      strafe,
      sprint: forward === 1 && !target,
      fire,
      reload,
      throwGrenade,
      swapWeapon,
      jump: false,
      yaw,
      pitch: throwGrenade ? pitch + 0.18 : pitch,
    },
    memory: { yaw, pitch, strafeSign, strafeUntil, lastGrenadeAt, lastSwapAt },
  };
};
