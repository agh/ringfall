import { describe, expect, it } from 'vitest';
import { createRng, MAX_SEED, parseSeed } from '../../src/core/rng';

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

  describe('parseSeed (untrusted ?seed= input)', () => {
    const FALLBACK = 12345;

    it('accepts a plain decimal integer in [1, MAX_SEED]', () => {
      expect(parseSeed('7', FALLBACK)).toBe(7);
      expect(parseSeed('1', FALLBACK)).toBe(1);
      expect(parseSeed(String(MAX_SEED), FALLBACK)).toBe(MAX_SEED);
    });

    it.each([
      ['abc'],
      [''],
      ['0'],
      ['-1'],
      ['1.5'],
      ['1e400'],
      ['NaN'],
      ['Infinity'],
      ['0x10'],
      [' 7'],
      ['7 '],
      ['+7'],
      ['9007199254740993'],
      [String(MAX_SEED + 1)],
      ['1'.repeat(10_000)],
      ['<script>alert(1)</script>'],
      ['__proto__'],
    ])('falls back on hostile or malformed input %j', (raw) => {
      expect(parseSeed(raw, FALLBACK)).toBe(FALLBACK);
    });

    it('falls back on a missing parameter', () => {
      expect(parseSeed(null, FALLBACK)).toBe(FALLBACK);
      expect(parseSeed(undefined, FALLBACK)).toBe(FALLBACK);
    });

    it('never yields a degenerate generator for any accepted seed', () => {
      for (const raw of ['1', '4294967295', '2147483648', '65536']) {
        const rng = createRng(parseSeed(raw, FALLBACK));
        const values = Array.from({ length: 8 }, () => rng.next());
        expect(new Set(values).size).toBeGreaterThan(1);
        for (const v of values) expect(Number.isFinite(v)).toBe(true);
      }
    });
  });
});
