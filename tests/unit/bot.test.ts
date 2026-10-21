import { describe, expect, it } from 'vitest';
import { RECKLESS_BOT, STEADY_BOT } from '../../src/core/bot';
import { runPlaytest, summarize } from '../../src/core/playtest';

/**
 * These are floors that prove the bot is a working, deterministic player, not balance targets.
 * The balance numbers themselves come from `pnpm balance` (tests/balance/report.test.ts).
 */
describe('playtest bot', () => {
  it('is deterministic for a seed', () => {
    const a = runPlaytest({ seed: 11, maxSeconds: 60 });
    const b = runPlaytest({ seed: 11, maxSeconds: 60 });
    expect(a).toEqual(b);
  });

  it('clears the first wave on most seeds and lands at least a quarter of its shots overall', () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      runPlaytest({ seed: 200 + i, maxSeconds: 150 }),
    );
    const cleared = results.filter((r) => r.waveClearTimes.length >= 1).length;
    const summary = summarize(results);
    expect(cleared).toBeGreaterThanOrEqual(5);
    expect(summary.accuracy).toBeGreaterThan(0.25);
    expect(results.reduce((a, r) => a + r.kills, 0)).toBeGreaterThanOrEqual(8 * 3);
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

  it('runs both profiles to completion on the same seeds and reports them separately', () => {
    const seeds = [21, 22, 23, 24];
    const steady = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: STEADY_BOT, maxSeconds: 300 })),
    );
    const reckless = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: RECKLESS_BOT, maxSeconds: 300 })),
    );
    expect(steady.games).toBe(4);
    expect(reckless.games).toBe(4);
    // The profiles differ in at least one measured dimension; which one is a balance question
    // for the report, not a correctness assertion.
    expect(
      steady.meanShieldBreaks !== reckless.meanShieldBreaks ||
        steady.meanSeconds !== reckless.meanSeconds ||
        steady.accuracy !== reckless.accuracy,
    ).toBe(true);
  });
});
