import { describe, expect, it } from 'vitest';
import { BOLT_LIFETIME, createBolt, stepBolt } from '../../src/core/projectile';
import { vec3 } from '../../src/core/vec3';
import { type Arena, aabbFromCenter } from '../../src/core/world';

const open: Arena = { halfSize: 30, obstacles: [], secret: null };

describe('projectile', () => {
  it('flies forward until it hits the player', () => {
    let bolt = createBolt(1, vec3(0, 1, -10), vec3(0, 0, 1), 18, 0);
    let result = stepBolt(bolt, open, vec3(0, 1, 0), 0.9, 1 / 60, 0.1);
    expect(result.kind).toBe('flying');
    let hit = false;
    for (let i = 0; i < 120 && !hit; i += 1) {
      result = stepBolt(bolt, open, vec3(0, 1, 0), 0.9, 1 / 60, 0.1 + i / 60);
      if (result.kind === 'flying') bolt = result.bolt;
      else hit = result.kind === 'hitPlayer';
    }
    expect(hit).toBe(true);
  });

  it('stops on cover, the floor, the arena edge, and expiry', () => {
    const covered: Arena = {
      halfSize: 30,
      obstacles: [aabbFromCenter(0, -5, 2, 3, 2)],
      secret: null,
    };
    const bolt = createBolt(1, vec3(0, 1, -10), vec3(0, 0, 1), 18, 0);
    expect(stepBolt(bolt, covered, vec3(0, 1, 50), 0.9, 1, 0.1).kind).toBe('hitWorld');
    const down = createBolt(2, vec3(0, 0.1, 0), vec3(0, -1, 0), 18, 0);
    expect(stepBolt(down, open, vec3(50, 1, 0), 0.9, 0.1, 0.1).kind).toBe('hitWorld');
    const out = createBolt(3, vec3(29.9, 1, 0), vec3(1, 0, 0), 18, 0);
    expect(stepBolt(out, open, vec3(-20, 1, 0), 0.9, 0.1, 0.1).kind).toBe('hitWorld');
    expect(stepBolt(bolt, open, vec3(50, 1, 0), 0.9, 0.1, BOLT_LIFETIME + 1).kind).toBe('expired');
  });
});
