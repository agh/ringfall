import { describe, expect, it } from 'vitest';
import { hitscan, rayAabb, raySphere } from '../../src/core/raycast';
import { vec3 } from '../../src/core/vec3';
import { aabbFromCenter } from '../../src/core/world';

describe('raycast', () => {
  const box = aabbFromCenter(0, 10, 2, 2, 2);
  const fwd = vec3(0, 0, 1);

  it('hits an AABB in front and misses one behind or aside', () => {
    expect(rayAabb(vec3(0, 1, 0), fwd, box, 50)).toBeCloseTo(9);
    expect(rayAabb(vec3(0, 1, 0), vec3(0, 0, -1), box, 50)).toBeNull();
    expect(rayAabb(vec3(5, 1, 0), fwd, box, 50)).toBeNull();
    expect(rayAabb(vec3(0, 1, 0), fwd, box, 5)).toBeNull();
    expect(rayAabb(vec3(0, 5, 0), vec3(1, 0, 0), box, 50)).toBeNull();
  });

  it('hits a sphere and reports the entry distance', () => {
    expect(raySphere(vec3(0, 0, 0), fwd, vec3(0, 0, 10), 1, 50)).toBeCloseTo(9);
    expect(raySphere(vec3(0, 0, 0), fwd, vec3(0, 5, 10), 1, 50)).toBeNull();
    expect(raySphere(vec3(0, 0, 0), fwd, vec3(0, 0, -10), 1, 50)).toBeNull();
  });

  it('prefers the nearest surface, so cover blocks shots', () => {
    const targets = [{ id: 7, center: vec3(0, 1, 20), radius: 1 }];
    const open = hitscan(vec3(0, 1, 0), fwd, targets, [], 100);
    expect(open.targetId).toBe(7);
    expect(open.distance).toBeCloseTo(19);
    const blocked = hitscan(vec3(0, 1, 0), fwd, targets, [box], 100);
    expect(blocked.targetId).toBeNull();
    expect(blocked.distance).toBeCloseTo(9);
    const miss = hitscan(vec3(0, 1, 0), vec3(1, 0, 0), targets, [box], 100);
    expect(miss).toEqual({ distance: 100, targetId: null });
  });
});
