import { describe, expect, it } from 'vitest';
import { accumulateWheel, WHEEL_NOTCH, wheelPixels } from '../../src/input/wheel';

describe('wheel swap notches', () => {
  it('turns one mouse notch into one swap', () => {
    expect(accumulateWheel(0, 100)).toEqual({ debt: 0, notches: 1 });
    expect(accumulateWheel(0, -120)).toEqual({ debt: 0, notches: -1 });
    // A single huge step is still one swap, not a run of them.
    expect(accumulateWheel(0, 900)).toEqual({ debt: 0, notches: 1 });
  });

  it('folds a trackpad run of small events into a single swap', () => {
    let debt = 0;
    let swaps = 0;
    for (const delta of [25, 25, 25, 25]) {
      const next = accumulateWheel(debt, delta);
      debt = next.debt;
      swaps += Math.abs(next.notches);
    }
    expect(swaps).toBe(1);
    expect(debt).toBe(0);
  });

  it('drops the carried travel when the direction flips', () => {
    const forward = accumulateWheel(0, 40);
    expect(forward).toEqual({ debt: 40, notches: 0 });
    const back = accumulateWheel(forward.debt, -40);
    expect(back).toEqual({ debt: -40, notches: 0 });
  });

  it('ignores an event with no vertical travel', () => {
    expect(accumulateWheel(30, 0)).toEqual({ debt: 30, notches: 0 });
  });

  it('scales line and page deltas to pixels', () => {
    expect(wheelPixels(3, 1)).toBe(102);
    expect(wheelPixels(1, 2)).toBe(400);
    expect(wheelPixels(7, 0)).toBe(7);
    // Firefox reports a wheel click as three lines: one swap, like Chrome's hundred pixels.
    expect(accumulateWheel(0, 3, 1).notches).toBe(1);
    expect(accumulateWheel(0, 2, 1).notches).toBe(0);
    expect(WHEEL_NOTCH).toBeGreaterThan(0);
  });
});
