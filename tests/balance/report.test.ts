import { describe, expect, it } from 'vitest';
import { RECKLESS_BOT, STEADY_BOT } from '../../src/core/bot';
import { runPlaytest, summarize } from '../../src/core/playtest';

/**
 * `pnpm balance`: plays twenty seeded games per bot profile headlessly and prints the summary
 * a designer tunes against. The assertions are floors, not targets; the printed numbers are the
 * evidence to quote.
 */
describe('balance report', () => {
  it('prints the summary for both profiles', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 100 + i);
    const steady = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: STEADY_BOT, maxSeconds: 480 })),
    );
    const reckless = summarize(
      seeds.map((seed) => runPlaytest({ seed, profile: RECKLESS_BOT, maxSeconds: 480 })),
    );
    const row = (name: string, s: typeof steady): string =>
      `${name.padEnd(9)} games=${s.games} win=${(s.winRate * 100).toFixed(0)}% waves=${s.meanWavesCleared.toFixed(2)} ` +
      `seconds=${s.meanSeconds.toFixed(0)} accuracy=${(s.accuracy * 100).toFixed(0)}% breaks=${s.meanShieldBreaks.toFixed(2)} ` +
      `clear=[${s.meanWaveClearTimes.map((t) => t.toFixed(0)).join(',')}]`;
    console.log(`\n${row('steady', steady)}\n${row('reckless', reckless)}\n`);
    expect(steady.games).toBe(20);
    expect(steady.meanWavesCleared).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
