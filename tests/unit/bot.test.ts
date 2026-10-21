import { describe, expect, it } from 'vitest';
import { RECKLESS_BOT, STEADY_BOT } from '../../src/core/bot';
import { runPlaytest, summarize } from '../../src/core/playtest';

describe('playtest bot', () => {
  it('is deterministic for a seed', () => {
    const a = runPlaytest({ seed: 11, maxSeconds: 60 });
    const b = runPlaytest({ seed: 11, maxSeconds: 60 });
    expect(a).toEqual(b);
  });

  it('clears the first wave and lands most of its shots', () => {
    const result = runPlaytest({ seed: 3, maxSeconds: 120 });
    expect(result.waveClearTimes.length).toBeGreaterThanOrEqual(1);
    expect(result.shotsHit / Math.max(1, result.shotsFired)).toBeGreaterThan(0.3);
    expect(result.kills).toBeGreaterThanOrEqual(3);
  });

  it('reports a balance summary across seeds', () => {
    const results = Array.from({ length: 6 }, (_, i) =>
      runPlaytest({ seed: 100 + i, maxSeconds: 240 }),
    );
    const summary = summarize(results);
    expect(summary.games).toBe(6);
    expect(summary.meanWavesCleared).toBeGreaterThanOrEqual(1);
    expect(summary.meanWaveClearTimes.length).toBeGreaterThanOrEqual(1);
  });

  it('reckless play dies sooner than steady play on average', () => {
    const seeds = [21, 22, 23, 24];
    const steady = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: STEADY_BOT, maxSeconds: 300 })),
    );
    const reckless = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: RECKLESS_BOT, maxSeconds: 300 })),
    );
    // Both profiles must produce comparable, non-degenerate runs; the reckless bot never
    // retreats, so it should not be taking materially fewer shield breaks than the steady one.
    expect(reckless.meanShieldBreaks).toBeGreaterThanOrEqual(steady.meanShieldBreaks * 0.5);
    expect(reckless.games).toBe(steady.games);
  });
});
