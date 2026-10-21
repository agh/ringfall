import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  createVitality,
  isDead,
  SHIELD_RECHARGE_DELAY,
  tickVitality,
} from '../../src/core/vitality';

describe('vitality', () => {
  it('absorbs damage with the shield before health', () => {
    const v = createVitality(100, 100);
    const hit = applyDamage(v, 30, 1);
    expect(hit.vitality.shield).toBe(70);
    expect(hit.vitality.health).toBe(100);
    expect(hit.shieldBroken).toBe(false);
  });

  it('spills excess damage into health and reports a broken shield', () => {
    const v = createVitality(20, 100);
    const hit = applyDamage(v, 50, 1);
    expect(hit.vitality.shield).toBe(0);
    expect(hit.vitality.health).toBe(70);
    expect(hit.shieldBroken).toBe(true);
    expect(hit.died).toBe(false);
    const again = applyDamage(hit.vitality, 10, 2);
    expect(again.shieldBroken).toBe(false);
  });

  it('kills at zero health and ignores further damage', () => {
    const v = createVitality(0, 10);
    const dead = applyDamage(v, 10, 1);
    expect(dead.died).toBe(true);
    expect(isDead(dead.vitality)).toBe(true);
    expect(applyDamage(dead.vitality, 10, 2).vitality).toBe(dead.vitality);
    expect(applyDamage(v, 0, 2).vitality).toBe(v);
  });

  it('recharges the shield only after the delay', () => {
    const hit = applyDamage(createVitality(), 60, 10).vitality;
    expect(tickVitality(hit, 1, 12).shield).toBe(40);
    const later = tickVitality(hit, 1, 10 + SHIELD_RECHARGE_DELAY + 0.5);
    expect(later.shield).toBeGreaterThan(40);
    const full = tickVitality(hit, 100, 100);
    expect(full.shield).toBe(100);
    expect(tickVitality(full, 1, 200)).toBe(full);
  });
});
