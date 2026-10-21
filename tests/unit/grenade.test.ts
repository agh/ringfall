import { describe, expect, it } from 'vitest';
import {
  blastDamage,
  GRENADE_BLAST_RADIUS,
  GRENADE_FUSE,
  GRENADE_MAX_DAMAGE,
  stepGrenade,
  throwGrenade,
} from '../../src/core/grenade';
import { vec3 } from '../../src/core/vec3';
import { type Arena, aabbFromCenter } from '../../src/core/world';

const arena: Arena = { halfSize: 30, obstacles: [aabbFromCenter(0, 6, 2, 3, 2)] };

describe('grenade', () => {
  it('arms with a fuse and inherits the throw direction', () => {
    const g = throwGrenade(1, vec3(0, 1.7, 0), vec3(0, 0, -1), 5);
    expect(g.explodeAt).toBe(5 + GRENADE_FUSE);
    expect(g.velocity.z).toBeLessThan(0);
    expect(g.velocity.y).toBeGreaterThan(0);
  });

  it('falls under gravity, bounces on the floor, and comes to rest', () => {
    let g = throwGrenade(1, vec3(0, 1.7, 0), vec3(0, 0, -1), 0);
    let minY = g.position.y;
    for (let i = 0; i < 300; i += 1) {
      g = stepGrenade(g, arena, 1 / 60);
      minY = Math.min(minY, g.position.y);
    }
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(g.position.y).toBe(0);
    expect(Math.abs(g.velocity.x) + Math.abs(g.velocity.z)).toBeLessThan(0.5);
  });

  it('bounces off cover blocks', () => {
    let g = throwGrenade(1, vec3(0, 1, 0), vec3(0, 0, 1), 0);
    let maxZ = 0;
    for (let i = 0; i < 120; i += 1) {
      g = stepGrenade(g, arena, 1 / 60);
      maxZ = Math.max(maxZ, g.position.z);
    }
    expect(maxZ).toBeLessThan(5.1);
  });

  it('applies linear falloff damage', () => {
    expect(blastDamage(0)).toBe(GRENADE_MAX_DAMAGE);
    expect(blastDamage(GRENADE_BLAST_RADIUS / 2)).toBeCloseTo(GRENADE_MAX_DAMAGE / 2);
    expect(blastDamage(GRENADE_BLAST_RADIUS)).toBe(0);
    expect(blastDamage(100)).toBe(0);
  });
});
