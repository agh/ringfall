import type { EnemyKind } from './enemy';
import type { Rng } from './rng';
import { distanceXZ, type Vec3, vec3 } from './vec3';
import { createWeapon, type Weapon, type WeaponKind } from './weapon';
import { type Arena, pointInsideAabbXZ } from './world';

/**
 * Weapon pickups: dropped by dead enemies and placed as a reward at the start of a wave.
 * Pure helpers over plain data; `game.ts` owns when they are called and the events they raise.
 */
export interface Pickup {
  readonly id: number;
  readonly kind: WeaponKind;
  readonly position: Vec3;
  readonly expiresAt: number;
}

export type WeaponSlots = readonly [Weapon, Weapon | null];
export type SlotIndex = 0 | 1;

/** Seconds a dropped pickup lies on the floor before it vanishes. */
export const PICKUP_LIFETIME = 20;
/** Horizontal distance within which walking over a pickup takes it. */
export const PICKUP_RADIUS = 1.2;
/** Chance that a kill of each enemy kind drops a weapon. */
export const PICKUP_DROP_CHANCE: Readonly<Record<EnemyKind, number>> = {
  skimmer: 0.18,
  strider: 0.6,
  watcher: 0.6,
};
/** Metres ahead of the player the wave-start reward is placed. */
export const WAVE_REWARD_DISTANCE = 6;
/** The first wave that places a reward pickup. */
export const WAVE_REWARD_FROM = 2;
/** Kinds that can be vended; the rifle is the starting weapon and is never dropped. */
export const PICKUP_KINDS: readonly WeaponKind[] = [
  'laser',
  'scatter',
  'beam',
  'launcher',
  'minigun',
];

export const heldKinds = (slots: WeaponSlots): readonly WeaponKind[] =>
  slots.flatMap((w) => (w ? [w.kind] : []));

/** A vendable kind the player does not already hold, or null when they hold them all. */
export const chooseKind = (held: readonly WeaponKind[], rng: Rng): WeaponKind | null => {
  const candidates = PICKUP_KINDS.filter((k) => !held.includes(k));
  if (candidates.length === 0) return null;
  return candidates[rng.int(candidates.length)] ?? null;
};

/** Rolls the drop for a kill. Consumes one rng sample for the roll and one more on a drop. */
export const rollDrop = (
  enemy: EnemyKind,
  held: readonly WeaponKind[],
  rng: Rng,
): WeaponKind | null => {
  if (rng.next() >= PICKUP_DROP_CHANCE[enemy]) return null;
  return chooseKind(held, rng);
};

export const createPickup = (
  id: number,
  kind: WeaponKind,
  position: Vec3,
  now: number,
): Pickup => ({
  id,
  kind,
  position: vec3(position.x, 0, position.z),
  expiresAt: now + PICKUP_LIFETIME,
});

export interface ExpiryResult {
  readonly kept: readonly Pickup[];
  readonly expired: readonly Pickup[];
}

export const expirePickups = (pickups: readonly Pickup[], now: number): ExpiryResult => ({
  kept: pickups.filter((p) => now < p.expiresAt),
  expired: pickups.filter((p) => now >= p.expiresAt),
});

/** The nearest pickup within reach of `feet`, or null. */
export const pickupInReach = (pickups: readonly Pickup[], feet: Vec3): Pickup | null => {
  let best: Pickup | null = null;
  let bestDist = PICKUP_RADIUS;
  for (const p of pickups) {
    const d = distanceXZ(p.position, feet);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
};

export interface TakeResult {
  readonly slots: WeaponSlots;
  readonly activeSlot: SlotIndex;
  /** The slot the new weapon went into. */
  readonly slot: SlotIndex;
}

/** An empty slot takes the weapon; otherwise it replaces the active one. The new weapon is drawn. */
export const takeWeapon = (
  slots: WeaponSlots,
  activeSlot: SlotIndex,
  kind: WeaponKind,
): TakeResult => {
  const weapon = createWeapon(kind);
  const slot: SlotIndex = slots[1] === null ? 1 : activeSlot;
  const next: WeaponSlots = slot === 0 ? [weapon, slots[1]] : [slots[0], weapon];
  return { slots: next, activeSlot: slot, slot };
};

/**
 * Where the wave reward lands: ahead of the player along their yaw, pulled back when that spot
 * is inside cover or outside the arena, and at the player's feet as a last resort.
 */
export const rewardPosition = (arena: Arena, feet: Vec3, yaw: number): Vec3 => {
  const limit = arena.halfSize - 1;
  for (const d of [WAVE_REWARD_DISTANCE, WAVE_REWARD_DISTANCE / 2]) {
    const p = vec3(feet.x - Math.sin(yaw) * d, 0, feet.z - Math.cos(yaw) * d);
    const inside = Math.abs(p.x) <= limit && Math.abs(p.z) <= limit;
    if (inside && !arena.obstacles.some((box) => pointInsideAabbXZ(p, box, PICKUP_RADIUS)))
      return p;
  }
  return vec3(feet.x, 0, feet.z);
};
