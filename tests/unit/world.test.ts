import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { vec3 } from '../../src/core/vec3';
import {
  ARENA_SECTOR,
  type Arena,
  aabbFromCenter,
  aabbOverlapsXZ,
  findSpawnPoint,
  generateArena,
  groundHeightAt,
  moveWithCollision,
  placeSecret,
  pointInsideAabbXZ,
  SECRET_HEIGHT,
} from '../../src/core/world';

const arena: Arena = {
  halfSize: 20,
  obstacles: [aabbFromCenter(5, 0, 2, 2, 2)],
  secret: null,
};

describe('world', () => {
  it('generates non-overlapping cover with a clear centre', () => {
    const a = generateArena(createRng(3), 12);
    expect(a.obstacles.length).toBeGreaterThan(0);
    for (const box of a.obstacles) {
      expect(pointInsideAabbXZ(vec3(0, 0, 0), box, 1)).toBe(false);
      for (const other of a.obstacles) {
        if (other !== box) expect(aabbOverlapsXZ(box, other)).toBe(false);
      }
    }
  });

  it('slides along a wall instead of passing through', () => {
    const start = vec3(2, 0, 0.3);
    const moved = moveWithCollision(arena, start, 0.4, 1.8, vec3(3, 0, 0.5));
    expect(moved.x).toBe(2);
    expect(moved.z).toBeCloseTo(0.8);
  });

  it('clamps to the arena boundary', () => {
    const moved = moveWithCollision(arena, vec3(19, 0, 0), 0.4, 1.8, vec3(10, 0, -40));
    expect(moved.x).toBeCloseTo(19.6);
    expect(moved.z).toBeCloseTo(-19.6);
  });

  it('never goes below the floor and steps up onto cover tops', () => {
    const moved = moveWithCollision(arena, vec3(0, 0.5, 0), 0.4, 1.8, vec3(0, -3, 0));
    expect(moved.y).toBe(0);
    expect(groundHeightAt(arena, vec3(5, 2, 0), 0.4)).toBe(2);
    expect(groundHeightAt(arena, vec3(5, 0.5, 0), 0.4)).toBe(0);
    expect(groundHeightAt(arena, vec3(0, 0, 0), 0.4)).toBe(0);
  });

  it('lands on the top of a block it falls onto, so the step can ground there', () => {
    // Over the 2 m block, falling 1 m from 2.5 m: the cylinder stops on the top, not at 2.5 m.
    const landed = moveWithCollision(arena, vec3(5, 2.5, 0), 0.4, 1.8, vec3(0, -1, 0));
    expect(landed.y).toBe(2);
    expect(groundHeightAt(arena, landed, 0.4)).toBe(2);
    // Rising into the block from below still stops at the old height.
    const bumped = moveWithCollision(arena, vec3(5, 0, 0), 0.4, 1.8, vec3(0, 0.5, 0));
    expect(bumped.y).toBe(0);
  });

  it('finds spawn points on the ring outside cover', () => {
    const rng = createRng(11);
    for (let i = 0; i < 20; i += 1) {
      const p = findSpawnPoint(arena, rng, 15);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(15);
      expect(arena.obstacles.some((box) => pointInsideAabbXZ(p, box, 1))).toBe(false);
    }
  });

  it('is Sector 117', () => {
    expect(ARENA_SECTOR).toBe(117);
  });

  it('hides one switch on the face of a cover block that looks away from the centre', () => {
    const a = generateArena(createRng(11));
    expect(a.secret).not.toBeNull();
    const secret = a.secret;
    if (!secret) return;
    const box = a.obstacles.find(
      (b) =>
        secret.at.x >= b.min.x - 1e-9 &&
        secret.at.x <= b.max.x + 1e-9 &&
        secret.at.z >= b.min.z - 1e-9 &&
        secret.at.z <= b.max.z + 1e-9,
    );
    expect(box).toBeDefined();
    if (!box) return;
    // On a face, not inside the block, and the face points away from the arena centre.
    const onFace =
      (secret.normal.x !== 0 && secret.at.x === (secret.normal.x > 0 ? box.max.x : box.min.x)) ||
      (secret.normal.z !== 0 && secret.at.z === (secret.normal.z > 0 ? box.max.z : box.min.z));
    expect(onFace).toBe(true);
    expect(secret.normal.x * secret.at.x + secret.normal.z * secret.at.z).toBeGreaterThan(0);
    expect(secret.at.y).toBeLessThanOrEqual(SECRET_HEIGHT);
    expect(secret.at.y).toBeGreaterThan(0);
    // Deterministic per seed, different across seeds.
    expect(generateArena(createRng(11)).secret).toEqual(secret);
    expect(generateArena(createRng(12)).secret).not.toEqual(secret);
  });

  it('places the glyph on the outward face in each quadrant and nowhere without cover', () => {
    expect(placeSecret([], createRng(1))).toBeNull();
    const east = placeSecret([aabbFromCenter(10, 2, 2, 3, 2)], createRng(1));
    expect(east).toEqual({ at: vec3(11, 1, 2), normal: vec3(1, 0, 0) });
    const west = placeSecret([aabbFromCenter(-10, 2, 2, 3, 2)], createRng(1));
    expect(west).toEqual({ at: vec3(-11, 1, 2), normal: vec3(-1, 0, 0) });
    const south = placeSecret([aabbFromCenter(2, 10, 2, 3, 2)], createRng(1));
    expect(south).toEqual({ at: vec3(2, 1, 11), normal: vec3(0, 0, 1) });
    const north = placeSecret([aabbFromCenter(2, -10, 2, 1.5, 2)], createRng(1));
    expect(north).toEqual({ at: vec3(2, 0.75, -11), normal: vec3(0, 0, -1) });
  });
});
