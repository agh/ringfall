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

  it('tests cover before targets whatever the order, so a sphere pressed to the far face is not hit', () => {
    // The box spans z 9..11; a 1 m sphere centred at z 11.5 reaches forward to z 10.5, inside
    // the slab, nearer than the far face but behind the near face at z 9.
    const pressed = [{ id: 1, center: vec3(0, 1, 11.5), radius: 1 }];
    const hit = hitscan(vec3(0, 1, 0), fwd, pressed, [box], 100);
    expect(hit).toEqual({ distance: 9, targetId: null });
    // A near target in front of the slab is still hit, and a far one behind it is not, with the
    // slab listed after both would-be hits.
    const pair = [
      { id: 2, center: vec3(0, 1, 30), radius: 1 },
      { id: 3, center: vec3(0, 1, 4), radius: 1 },
    ];
    expect(hitscan(vec3(0, 1, 0), fwd, pair, [box], 100)).toEqual({ distance: 3, targetId: 3 });
    // Eye height matters: a 2 m tall slab does not stop a ray that passes over its top.
    const tall = [{ id: 4, center: vec3(0, 2.5, 11.5), radius: 1 }];
    expect(hitscan(vec3(0, 2.5, 0), fwd, tall, [box], 100)).toEqual({
      distance: 10.5,
      targetId: 4,
    });
  });
});
