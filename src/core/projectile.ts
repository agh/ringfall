import { rayAabb } from './raycast';
import { add, distance, scale, type Vec3 } from './vec3';
import type { Arena } from './world';

/** Slow-moving energy bolt fired by ranged enemies. Dodgeable by design. */
export interface Bolt {
  readonly id: number;
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly speed: number;
  readonly damage: number;
  readonly expiresAt: number;
}

export const BOLT_SPEED = 22;
export const BOLT_LIFETIME = 3;

export const createBolt = (
  id: number,
  origin: Vec3,
  direction: Vec3,
  damage: number,
  now: number,
): Bolt => ({
  id,
  position: origin,
  direction,
  speed: BOLT_SPEED,
  damage,
  expiresAt: now + BOLT_LIFETIME,
});

export type BoltStep =
  | { readonly kind: 'flying'; readonly bolt: Bolt }
  | { readonly kind: 'hitPlayer' }
  | { readonly kind: 'hitWorld' }
  | { readonly kind: 'expired' };

export const stepBolt = (
  bolt: Bolt,
  arena: Arena,
  playerCenter: Vec3,
  playerRadius: number,
  dt: number,
  now: number,
): BoltStep => {
  if (now >= bolt.expiresAt) return { kind: 'expired' };
  const travel = bolt.speed * dt;
  for (const box of arena.obstacles) {
    if (rayAabb(bolt.position, bolt.direction, box, travel) !== null) return { kind: 'hitWorld' };
  }
  const next = add(bolt.position, scale(bolt.direction, travel));
  if (next.y <= 0 || Math.abs(next.x) > arena.halfSize || Math.abs(next.z) > arena.halfSize) {
    return { kind: 'hitWorld' };
  }
  // Swept test approximated by checking the midpoint and the endpoint against the player sphere.
  const mid = add(bolt.position, scale(bolt.direction, travel / 2));
  if (distance(next, playerCenter) <= playerRadius || distance(mid, playerCenter) <= playerRadius) {
    return { kind: 'hitPlayer' };
  }
  return { kind: 'flying', bolt: { ...bolt, position: next } };
};
