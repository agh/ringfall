import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { vec3 } from '../../src/core/vec3';
import {
  type Arena,
  aabbFromCenter,
  aabbOverlapsXZ,
  findSpawnPoint,
  generateArena,
  groundHeightAt,
  moveWithCollision,
  pointInsideAabbXZ,
} from '../../src/core/world';

const arena: Arena = {
  halfSize: 20,
  obstacles: [aabbFromCenter(5, 0, 2, 2, 2)],
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

  it('finds spawn points on the ring outside cover', () => {
    const rng = createRng(11);
    for (let i = 0; i < 20; i += 1) {
      const p = findSpawnPoint(arena, rng, 15);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(15);
      expect(arena.obstacles.some((box) => pointInsideAabbXZ(p, box, 1))).toBe(false);
    }
  });
});
