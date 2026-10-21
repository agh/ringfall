import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECKLESS_BOT, STEADY_BOT } from '../../src/core/bot';
import { buildBalanceReport, runPlaytest } from '../../src/core/playtest';
import { GATE_THRESHOLDS, MAX_SECONDS, REPORT_DIR, SEEDS } from './gate';
import { renderMarkdownReport } from './render';

/**
 * `pnpm balance`: the playtest gate. The games run, the report is written (CI uploads it as an
 * artifact), and only then are the thresholds in `gate.ts` asserted, so the report exists
 * whether or not the gate passes.
 */
describe('balance gate', () => {
  it('writes the report and holds the baseline-derived thresholds', () => {
    const games = {
      steady: SEEDS.map((seed) =>
        runPlaytest({ seed, profile: STEADY_BOT, maxSeconds: MAX_SECONDS }),
      ),
      reckless: SEEDS.map((seed) =>
        runPlaytest({ seed, profile: RECKLESS_BOT, maxSeconds: MAX_SECONDS }),
      ),
    };
    const report = buildBalanceReport(games, GATE_THRESHOLDS, {
      seeds: SEEDS,
      maxSeconds: MAX_SECONDS,
    });
    const commit = process.env.GITHUB_SHA ?? 'working tree';
    const markdown = renderMarkdownReport(report, { commit });

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, 'balance-report.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(REPORT_DIR, 'balance-report.md'), markdown);

    const row = (name: 'steady' | 'reckless'): string => {
      const s = report.summaries[name];
      return (
        `${name.padEnd(9)} games=${s.games} win=${(s.winRate * 100).toFixed(0)}% ` +
        `waves=${s.meanWavesCleared.toFixed(2)} seconds=${s.meanSeconds.toFixed(0)} ` +
        `accuracy=${(s.accuracy * 100).toFixed(0)}% breaks=${s.meanShieldBreaks.toFixed(2)} ` +
        `clear=[${s.meanWaveClearTimes.map((t) => t.toFixed(0)).join(',')}]`
      );
    };
    const verdicts = report.checks.map(
      (c) =>
        `${c.passed ? 'pass' : 'FAIL'} ${c.profile} ${c.metric} ${c.bound} ${c.limit} ` +
        `(actual ${c.actual.toFixed(3)}, baseline ${c.baseline}, margin: ${c.margin})`,
    );
    console.log(`\n${row('steady')}\n${row('reckless')}\n\n${verdicts.join('\n')}\n`);

    expect(report.summaries.steady.games).toBe(SEEDS.length);
    expect(report.summaries.reckless.games).toBe(SEEDS.length);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed, `balance gate failed:\n${verdicts.join('\n')}`).toEqual([]);
    expect(report.passed).toBe(true);
  }, 180_000);
});
