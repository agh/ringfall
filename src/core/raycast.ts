import type { Vec3 } from './vec3';
import { dot, sub } from './vec3';
import type { Aabb } from './world';

/** Distance along a unit ray to the nearest AABB entry, or null when it misses. */
export const rayAabb = (origin: Vec3, dir: Vec3, box: Aabb, maxDist: number): number | null => {
  let tmin = 0;
  let tmax = maxDist;
  const axes: ReadonlyArray<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
};

/** Distance along a unit ray to a sphere surface, or null when it misses. */
export const raySphere = (
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
  maxDist: number,
): number | null => {
  const oc = sub(origin, center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxDist) return null;
  return t;
};

export interface SphereTarget {
  readonly id: number;
  readonly center: Vec3;
  readonly radius: number;
}

export interface HitscanResult {
  readonly distance: number;
  readonly targetId: number | null;
}

/** Nearest thing a bullet reaches: an enemy sphere, a cover block, or nothing (`maxDist`). */
export const hitscan = (
  origin: Vec3,
  dir: Vec3,
  targets: readonly SphereTarget[],
  obstacles: readonly Aabb[],
  maxDist: number,
): HitscanResult => {
  let best: HitscanResult = { distance: maxDist, targetId: null };
  for (const box of obstacles) {
    const t = rayAabb(origin, dir, box, best.distance);
    if (t !== null && t < best.distance) best = { distance: t, targetId: null };
  }
  for (const target of targets) {
    const t = raySphere(origin, dir, target.center, target.radius, best.distance);
    if (t !== null && t < best.distance) best = { distance: t, targetId: target.id };
  }
  return best;
};
