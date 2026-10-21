import { describe, expect, it } from 'vitest';
import {
  add,
  clamp,
  directionFromAngles,
  distance,
  distanceXZ,
  dot,
  length,
  lerp,
  normalize,
  scale,
  sub,
  vec3,
} from '../../src/core/vec3';

describe('vec3', () => {
  it('performs basic arithmetic', () => {
    expect(add(vec3(1, 2, 3), vec3(1, 1, 1))).toEqual(vec3(2, 3, 4));
    expect(sub(vec3(1, 2, 3), vec3(1, 1, 1))).toEqual(vec3(0, 1, 2));
    expect(scale(vec3(1, 2, 3), 2)).toEqual(vec3(2, 4, 6));
    expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(distance(vec3(0, 0, 0), vec3(0, 3, 4))).toBe(5);
    expect(distanceXZ(vec3(0, 100, 0), vec3(3, 0, 4))).toBe(5);
    expect(lerp(vec3(0, 0, 0), vec3(10, 10, 10), 0.5)).toEqual(vec3(5, 5, 5));
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it('normalizes safely', () => {
    expect(normalize(vec3(0, 0, 0))).toEqual(vec3(0, 0, 0));
    expect(length(normalize(vec3(3, 4, 12)))).toBeCloseTo(1);
  });

  it('derives a look direction where yaw 0 faces -Z and pitch raises Y', () => {
    const fwd = directionFromAngles(0, 0);
    expect(fwd.z).toBeCloseTo(-1);
    expect(fwd.x).toBeCloseTo(0);
    const left = directionFromAngles(Math.PI / 2, 0);
    expect(left.x).toBeCloseTo(-1);
    const up = directionFromAngles(0, Math.PI / 2);
    expect(up.y).toBeCloseTo(1);
  });
});
