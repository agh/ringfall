import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('stays within requested ranges', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const r = rng.range(-2, 2);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(2);
      const n = rng.int(3);
      expect([0, 1, 2]).toContain(n);
    }
  });
});
