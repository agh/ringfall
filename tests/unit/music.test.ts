import { describe, expect, it } from 'vitest';
import { beatsDue, LOOKAHEAD, TICK } from '../../src/audio/music';
import { LIMITER } from '../../src/audio/sounds';

describe('music beat scheduling', () => {
  it('places beats at exact tick multiples on the audio clock, however the timer drifts', () => {
    let cursor = 0;
    const placed: number[] = [];
    // A timer that is late by a different amount every tick.
    const jitter = [0, 0.03, 0.01, 0.06, 0.0, 0.04, 0.02, 0.05];
    let now = 10;
    for (const late of jitter) {
      now += TICK + late;
      const due = beatsDue(cursor, now);
      cursor = due.cursor;
      placed.push(...due.times);
    }
    for (let i = 1; i < placed.length; i += 1) {
      expect((placed[i] ?? 0) - (placed[i - 1] ?? 0)).toBeCloseTo(TICK, 9);
    }
    expect(placed.length).toBeGreaterThanOrEqual(jitter.length);
  });

  it('keeps the grid through a timer tick a whole tick late', () => {
    // A hitch on the main thread (a shader compile, a GC pause) delays setInterval by up to a
    // tick; the beat already placed must still be followed by one exactly a tick later.
    let cursor = 0;
    const placed: number[] = [];
    let now = 10;
    for (const late of [0, 0, TICK, 0, TICK, TICK, 0]) {
      now += TICK + late;
      const due = beatsDue(cursor, now);
      cursor = due.cursor;
      placed.push(...due.times);
    }
    for (let i = 1; i < placed.length; i += 1) {
      expect((placed[i] ?? 0) - (placed[i - 1] ?? 0)).toBeCloseTo(TICK, 9);
    }
  });

  it('never fills a stall: after a 10 s gap only the lookahead window is placed, in the future', () => {
    const before = beatsDue(0, 5);
    const after = beatsDue(before.cursor, 15);
    expect(after.times.length).toBeLessThanOrEqual(Math.ceil(LOOKAHEAD / TICK) + 1);
    for (const t of after.times) expect(t).toBeGreaterThan(15);
  });

  it('places nothing new while the clock is frozen', () => {
    const first = beatsDue(0, 20);
    expect(first.times.length).toBeGreaterThan(0);
    const frozen = beatsDue(first.cursor, 20);
    expect(frozen.times).toEqual([]);
    expect(frozen.cursor).toBe(first.cursor);
  });
});

describe('master limiter', () => {
  it('is a brick wall within the DynamicsCompressor ranges', () => {
    expect(LIMITER.threshold).toBeLessThan(0);
    expect(LIMITER.threshold).toBeGreaterThanOrEqual(-100);
    expect(LIMITER.knee).toBeGreaterThanOrEqual(0);
    expect(LIMITER.ratio).toBeGreaterThanOrEqual(10);
    expect(LIMITER.ratio).toBeLessThanOrEqual(20);
    expect(LIMITER.attack).toBeLessThan(0.01);
    expect(LIMITER.release).toBeGreaterThan(LIMITER.attack);
  });
});
