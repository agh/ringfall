import type { BalanceReport, GateCheck, GateProfile } from '../../src/core/playtest';

/** Markdown rendering of a {@link BalanceReport}; the file CI uploads as an artifact. */

const BARS = '▁▂▃▄▅▆▇█';

/** Eight-level block sparkline, scaled so the largest sample is the tallest bar. */
export const sparkline = (samples: readonly number[]): string => {
  const peak = Math.max(0, ...samples);
  if (peak <= 0) return samples.map(() => BARS[0]).join('');
  return samples
    .map((v) => BARS[Math.min(BARS.length - 1, Math.round((v / peak) * (BARS.length - 1)))])
    .join('');
};

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

const formatMetric = (check: Pick<GateCheck, 'metric'>, value: number): string => {
  switch (check.metric) {
    case 'winRate':
    case 'accuracy':
      return pct(value);
    case 'meanWavesCleared':
      return value.toFixed(2);
    case 'slowestWaveClear':
      return `${value.toFixed(0)} s`;
  }
};

const METRIC_LABEL: Record<GateCheck['metric'], string> = {
  winRate: 'win rate',
  meanWavesCleared: 'mean waves cleared',
  accuracy: 'accuracy',
  slowestWaveClear: 'slowest mean wave clear',
};

const PROFILES: readonly GateProfile[] = ['steady', 'reckless'];

export const renderMarkdownReport = (report: BalanceReport, meta: { commit: string }): string => {
  const lines: string[] = [];
  lines.push('# Balance report');
  lines.push('');
  lines.push(
    `Commit \`${meta.commit}\`, ${report.seeds.length} seeds per profile ` +
      `(${report.seeds[0]}..${report.seeds[report.seeds.length - 1]}), ${report.maxSeconds} s cap. ` +
      `Gate: **${report.passed ? 'PASS' : 'FAIL'}**.`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    '| Profile | Win rate | Mean waves cleared | Mean seconds | Accuracy | Shield breaks | Wave clear (s) |',
  );
  lines.push(
    '| ------- | -------- | ------------------ | ------------ | -------- | ------------- | -------------- |',
  );
  for (const profile of PROFILES) {
    const s = report.summaries[profile];
    lines.push(
      `| ${profile} | ${pct(s.winRate)} | ${s.meanWavesCleared.toFixed(2)} | ${s.meanSeconds.toFixed(0)} ` +
        `| ${pct(s.accuracy)} | ${s.meanShieldBreaks.toFixed(2)} ` +
        `| \`${sparkline(s.meanWaveClearTimes)}\` ${s.meanWaveClearTimes.map((t) => t.toFixed(0)).join(' ')} |`,
    );
  }
  lines.push('');
  lines.push('## Gate');
  lines.push('');
  lines.push('| Profile | Metric | Bound | Limit | Actual | Baseline | Margin | Result |');
  lines.push('| ------- | ------ | ----- | ----- | ------ | -------- | ------ | ------ |');
  for (const c of report.checks) {
    lines.push(
      `| ${c.profile} | ${METRIC_LABEL[c.metric]} | ${c.bound} | ${formatMetric(c, c.limit)} ` +
        `| ${formatMetric(c, c.actual)} | ${formatMetric(c, c.baseline)} | ${c.margin} ` +
        `| ${c.passed ? 'pass' : 'FAIL'} |`,
    );
  }
  lines.push('');
  lines.push('## Games');
  lines.push('');
  lines.push('| Profile | Seed | Outcome | Waves | Seconds | Kills | Accuracy | Shield breaks |');
  lines.push('| ------- | ---- | ------- | ----- | ------- | ----- | -------- | ------------- |');
  for (const profile of PROFILES) {
    for (const g of report.games[profile]) {
      const accuracy = g.shotsFired ? g.shotsHit / g.shotsFired : 0;
      lines.push(
        `| ${profile} | ${g.seed} | ${g.outcome} | ${g.wavesCleared} | ${g.seconds.toFixed(0)} ` +
          `| ${g.kills} | ${pct(accuracy)} | ${g.shieldBreaks} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
};
