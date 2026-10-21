import { ENEMY_STATS, type Enemy, enemyCenter } from './enemy';
import { type GameState, IDLE_INPUT, type InputFrame, playerEye } from './game';
import { hitscan } from './raycast';
import type { Rng } from './rng';
import { distanceXZ, normalize, sub, type Vec3 } from './vec3';

/**
 * A scripted player. It reads the same immutable state a human sees on the HUD (enemy positions,
 * bolts, shield, ammo) and emits the same InputFrame a keyboard and mouse would. Because the
 * simulation is deterministic, a bot run with a fixed seed is a reproducible playtest: the same
 * run drives balance measurement in Node, smoke tests in Playwright, and the demo recording.
 */
/** Matches the HUD tracker range in src/hud/hud.ts. */
const TRACKER_RANGE = 28;

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
}

export const createBotMemory = (): BotMemory => ({
  yaw: 0,
  pitch: 0,
  strafeSign: 1,
  strafeUntil: 0,
  lastGrenadeAt: -10,
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
    // Prefer visible and close enemies; skimmers in melee range are urgent.
    const urgency = enemy.kind === 'skimmer' && dist < 6 ? 0.3 : 1;
    const score = (visible ? dist : dist * 4) * urgency;
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
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
    else if (dist > 22) forward = 1;
    else if (dist < 4 && target.kind === 'skimmer') forward = -1;
    if (retreating) strafe = strafeSign;
  }

  // Grenade: lob at a cluster or a strider at a comfortable range.
  let throwGrenade = false;
  let lastGrenadeAt = memory.lastGrenadeAt;
  if (target && player.grenades > 0 && state.time - lastGrenadeAt > 3) {
    const dist = distanceXZ(eye, target.position);
    const cluster = state.enemies.filter(
      (e) => e.state !== 'dead' && distanceXZ(e.position, target.position) < 5,
    ).length;
    if (dist > 8 && dist < 22 && (cluster >= profile.grenadeCluster || target.kind === 'strider')) {
      throwGrenade = true;
      lastGrenadeAt = state.time;
    }
  }

  const magazine = player.weapon.magazine;
  const reload = magazine === 0 || (magazine < 8 && !target);
  const fire = target !== null && aimError < profile.fireTolerance && magazine > 0;

  return {
    input: {
      ...IDLE_INPUT,
      forward,
      strafe,
      sprint: forward === 1 && !target,
      fire,
      reload,
      throwGrenade,
      jump: false,
      yaw,
      pitch: throwGrenade ? pitch + 0.18 : pitch,
    },
    memory: { yaw, pitch, strafeSign, strafeUntil, lastGrenadeAt },
  };
};
