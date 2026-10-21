import type { Rng } from './rng';
import { type Vec3, vec3 } from './vec3';

/** Axis-aligned box used for cover, walls, and collision. */
export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Arena {
  /** Half-extent of the square playfield on X and Z. */
  readonly halfSize: number;
  readonly obstacles: readonly Aabb[];
}

export const ARENA_HALF_SIZE = 30;

export const aabbFromCenter = (cx: number, cz: number, w: number, h: number, d: number): Aabb => ({
  min: vec3(cx - w / 2, 0, cz - d / 2),
  max: vec3(cx + w / 2, h, cz + d / 2),
});

/** Procedurally lays out cover blocks, keeping a clear spawn circle around the origin. */
export const generateArena = (rng: Rng, blockCount = 16, halfSize = ARENA_HALF_SIZE): Arena => {
  const obstacles: Aabb[] = [];
  let attempts = 0;
  while (obstacles.length < blockCount && attempts < blockCount * 20) {
    attempts += 1;
    const w = rng.range(2, 6);
    const d = rng.range(2, 6);
    const h = rng.range(1.5, 4);
    const cx = rng.range(-halfSize + 4, halfSize - 4);
    const cz = rng.range(-halfSize + 4, halfSize - 4);
    if (Math.hypot(cx, cz) < 6) continue;
    const box = aabbFromCenter(cx, cz, w, h, d);
    const overlaps = obstacles.some((o) => aabbOverlapsXZ(o, box, 1.5));
    if (!overlaps) obstacles.push(box);
  }
  return { halfSize, obstacles };
};

export const aabbOverlapsXZ = (a: Aabb, b: Aabb, margin = 0): boolean =>
  a.min.x - margin < b.max.x &&
  a.max.x + margin > b.min.x &&
  a.min.z - margin < b.max.z &&
  a.max.z + margin > b.min.z;

export const pointInsideAabbXZ = (p: Vec3, box: Aabb, margin = 0): boolean =>
  p.x > box.min.x - margin &&
  p.x < box.max.x + margin &&
  p.z > box.min.z - margin &&
  p.z < box.max.z + margin;

const circleHitsBoxXZ = (p: Vec3, radius: number, box: Aabb): boolean => {
  const nx = Math.max(box.min.x, Math.min(p.x, box.max.x));
  const nz = Math.max(box.min.z, Math.min(p.z, box.max.z));
  return (p.x - nx) ** 2 + (p.z - nz) ** 2 < radius * radius;
};

/**
 * Moves a vertical cylinder (feet at `pos.y`) by `delta`, sliding along obstacles and the
 * arena boundary. Each axis is resolved separately, which gives the classic FPS wall-slide.
 */
export const moveWithCollision = (
  arena: Arena,
  pos: Vec3,
  radius: number,
  height: number,
  delta: Vec3,
): Vec3 => {
  const limit = arena.halfSize - radius;
  const blockedAt = (x: number, y: number, z: number): boolean => {
    const p = vec3(x, y, z);
    return arena.obstacles.some(
      (box) => y < box.max.y && y + height > box.min.y && circleHitsBoxXZ(p, radius, box),
    );
  };
  let x = Math.max(-limit, Math.min(limit, pos.x + delta.x));
  if (blockedAt(x, pos.y, pos.z)) x = pos.x;
  let z = Math.max(-limit, Math.min(limit, pos.z + delta.z));
  if (blockedAt(x, pos.y, z)) z = pos.z;
  let y = pos.y + delta.y;
  if (y < 0) y = 0;
  if (delta.y !== 0 && blockedAt(x, y, z)) y = pos.y;
  return vec3(x, y, z);
};

/** True when the cylinder at `pos` is resting on the floor or on top of an obstacle. */
export const groundHeightAt = (arena: Arena, pos: Vec3, radius: number): number => {
  let ground = 0;
  for (const box of arena.obstacles) {
    if (circleHitsBoxXZ(pos, radius, box) && pos.y >= box.max.y - 0.05) {
      ground = Math.max(ground, box.max.y);
    }
  }
  return ground;
};

/** Picks a point on the spawn ring that is not inside an obstacle. */
export const findSpawnPoint = (arena: Arena, rng: Rng, ringRadius: number): Vec3 => {
  for (let i = 0; i < 32; i += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const r = Math.min(ringRadius, arena.halfSize - 2);
    const p = vec3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    if (!arena.obstacles.some((box) => pointInsideAabbXZ(p, box, 1))) return p;
  }
  return vec3(0, 0, -ringRadius);
};
