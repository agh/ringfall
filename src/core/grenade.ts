import { add, scale, type Vec3, vec3 } from './vec3';
import { type Arena, moveWithCollision } from './world';

export interface Grenade {
  readonly id: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly explodeAt: number;
}

export const GRENADE_FUSE = 2.5;
export const GRENADE_THROW_SPEED = 14;
export const GRENADE_BLAST_RADIUS = 6;
export const GRENADE_MAX_DAMAGE = 150;
export const GRENADE_GRAVITY = 18;
export const GRENADE_RESTITUTION = 0.35;
export const GRENADE_RADIUS = 0.15;

export const throwGrenade = (id: number, origin: Vec3, dir: Vec3, now: number): Grenade => ({
  id,
  position: origin,
  velocity: add(scale(dir, GRENADE_THROW_SPEED), vec3(0, 2, 0)),
  explodeAt: now + GRENADE_FUSE,
});

/** Integrates one step with gravity, floor bounce, and wall sliding against cover. */
export const stepGrenade = (g: Grenade, arena: Arena, dt: number): Grenade => {
  let velocity = add(g.velocity, vec3(0, -GRENADE_GRAVITY * dt, 0));
  const delta = scale(velocity, dt);
  const next = moveWithCollision(arena, g.position, GRENADE_RADIUS, GRENADE_RADIUS, delta);
  // Any axis the mover refused to change counts as a bounce on that axis.
  const bx = Math.abs(next.x - g.position.x - delta.x) > 1e-6;
  const bz = Math.abs(next.z - g.position.z - delta.z) > 1e-6;
  const by = Math.abs(next.y - g.position.y - delta.y) > 1e-6;
  velocity = vec3(
    bx ? -velocity.x * GRENADE_RESTITUTION : velocity.x,
    by ? -velocity.y * GRENADE_RESTITUTION : velocity.y,
    bz ? -velocity.z * GRENADE_RESTITUTION : velocity.z,
  );
  if (by && next.y <= 0) {
    // Floor contact scrubs off most horizontal speed so a throw lands near where it was aimed.
    velocity = vec3(
      velocity.x * 0.55,
      Math.abs(velocity.y) < 1 ? 0 : velocity.y,
      velocity.z * 0.55,
    );
  }
  return { ...g, position: next, velocity };
};

/** Linear falloff from full damage at the centre to zero at the blast radius. */
export const blastDamage = (
  distance: number,
  radius = GRENADE_BLAST_RADIUS,
  maxDamage = GRENADE_MAX_DAMAGE,
): number => {
  if (distance >= radius) return 0;
  return maxDamage * (1 - distance / radius);
};
