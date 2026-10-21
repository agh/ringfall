import type { Rng } from './rng';
import { type Vec3, vec3 } from './vec3';

/** Axis-aligned box used for cover, walls, and collision. */
export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * The one hidden switch in an arena: a small glyph on the face of a cover block that looks
 * away from the centre, so nobody sees it from the spawn. Shooting it once is worth a secret.
 */
export interface Secret {
  /** Centre of the glyph, on the block's face. */
  readonly at: Vec3;
  /** Outward normal of that face. */
  readonly normal: Vec3;
}

export interface Arena {
  /** Half-extent of the square playfield on X and Z. */
  readonly halfSize: number;
  readonly obstacles: readonly Aabb[];
  /** Null only for an arena with no cover to hide it on. */
  readonly secret: Secret | null;
}

export const ARENA_HALF_SIZE = 30;
/** The arena's designation on the HUD. One well-known number, no explanation. */
export const ARENA_SECTOR = 117;
/** Radius of the hit sphere around the glyph; a rifle shot has to be deliberate. */
export const SECRET_RADIUS = 0.35;
/** Height of the glyph on its face: level with a crouched eye, below a standing one. */
export const SECRET_HEIGHT = 1;

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
  return { halfSize, obstacles, secret: placeSecret(obstacles, rng) };
};

/** Picks one block and puts the glyph on the face that points away from the arena centre. */
export const placeSecret = (obstacles: readonly Aabb[], rng: Rng): Secret | null => {
  if (obstacles.length === 0) return null;
  const box = obstacles[rng.int(obstacles.length)];
  if (!box) return null;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const y = Math.min(SECRET_HEIGHT, box.max.y / 2);
  if (Math.abs(cx) >= Math.abs(cz)) {
    const sign = cx >= 0 ? 1 : -1;
    return { at: vec3(sign > 0 ? box.max.x : box.min.x, y, cz), normal: vec3(sign, 0, 0) };
  }
  const sign = cz >= 0 ? 1 : -1;
  return { at: vec3(cx, y, sign > 0 ? box.max.z : box.min.z), normal: vec3(0, 0, sign) };
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

/** True when a horizontal circle of `radius` at (`px`, `pz`) overlaps the box's footprint. */
export const circleHitsBoxXZ = (px: number, pz: number, radius: number, box: Aabb): boolean => {
  const nx = Math.max(box.min.x, Math.min(px, box.max.x));
  const nz = Math.max(box.min.z, Math.min(pz, box.max.z));
  return (px - nx) ** 2 + (pz - nz) ** 2 < radius * radius;
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
    for (const box of arena.obstacles) {
      if (y < box.max.y && y + height > box.min.y && circleHitsBoxXZ(x, z, radius, box))
        return true;
    }
    return false;
  };
  let x = Math.max(-limit, Math.min(limit, pos.x + delta.x));
  if (blockedAt(x, pos.y, pos.z)) x = pos.x;
  let z = Math.max(-limit, Math.min(limit, pos.z + delta.z));
  if (blockedAt(x, pos.y, z)) z = pos.z;
  let y = pos.y + delta.y;
  if (y < 0) y = 0;
  if (delta.y !== 0 && blockedAt(x, y, z)) {
    // Falling onto a block lands on its top, so `groundHeightAt` reads it as ground on the same
    // step; rising into one, or a sideways clip, stops at the old height.
    y = delta.y < 0 ? (landingHeight(arena, vec3(x, pos.y, z), radius, y) ?? pos.y) : pos.y;
  }
  return vec3(x, y, z);
};

/** Top of the highest block under a cylinder that was at `from.y` and would sink to `to`. */
const landingHeight = (arena: Arena, from: Vec3, radius: number, to: number): number | null => {
  let top: number | null = null;
  for (const box of arena.obstacles) {
    if (box.max.y <= from.y && box.max.y > to && circleHitsBoxXZ(from.x, from.z, radius, box)) {
      top = Math.max(top ?? box.max.y, box.max.y);
    }
  }
  return top;
};

/** True when the cylinder at `pos` is resting on the floor or on top of an obstacle. */
export const groundHeightAt = (arena: Arena, pos: Vec3, radius: number): number => {
  let ground = 0;
  for (const box of arena.obstacles) {
    if (circleHitsBoxXZ(pos.x, pos.z, radius, box) && pos.y >= box.max.y - 0.05) {
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
