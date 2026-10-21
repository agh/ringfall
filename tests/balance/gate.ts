import type { GateThreshold } from '../../src/core/playtest';

/**
 * The playtest gate: twenty seeded games per bot profile, 480 s cap, and the bounds a tuning
 * change must stay within. `REPORT_DIR` is under `test-results/`, which git, Biome and
 * markdownlint already ignore; CI uploads it as the `balance-report` artifact.
 *
 * The thresholds are derived from a baseline run, not from whatever the current tree prints.
 * The first baseline was the eight-wave formula on `main` (seeds 100..119, 480 s cap):
 *
 *   steady    win=15% waves=5.35 seconds=245 accuracy=39% breaks=1.15 clear=[4,15,16,25,21,20,23]
 *   reckless  win=0%  waves=4.20 seconds=254 accuracy=42% breaks=0.75 clear=[5,13,18,18,16,18,24]
 *
 * The skimmer temperaments (#47) moved the reckless win rate to 15% at 84a835b and re-derived
 * that one bound. Issue #8 then cut Chapter 1 to five named beats (`WAVE_BEATS`), so
 * `meanWavesCleared` is out of 5 and the eight-wave bounds could not hold. The baseline below is
 * the five beats merged onto the rout (#40) and the temperaments (#47), same seeds and cap:
 *
 *   steady    win=75% waves=4.35 seconds=152 accuracy=52% breaks=0.10 clear=[4,13,14,20]
 *   reckless  win=70% waves=4.55 seconds=127 accuracy=43% breaks=0.45 clear=[4,14,19,23]
 *
 * Each limit is the baseline moved by the same margin as before in the lenient direction: one
 * game of twenty on the steady win rate, half a wave on waves cleared, ten points of accuracy,
 * twice the slowest wave, two games on the reckless win rate. The margins were sized against the
 * reference breaking change in issue #12 (halving rifle damage) under the eight-wave formula and
 * have not been re-measured under the five beats. One intent is lost: the reckless bound used to
 * say "never retreating must not become the way to win", and under the beats as specified in #8
 * the reckless profile wins 70% of its games, so that bound now only catches drift. Issue #63
 * holds that question.
 */
export const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 100 + i);
export const MAX_SECONDS = 480;
export const REPORT_DIR = 'test-results/balance';

export const GATE_THRESHOLDS: readonly GateThreshold[] = [
  {
    profile: 'steady',
    metric: 'winRate',
    bound: 'min',
    limit: 0.7,
    baseline: 0.75,
    margin: 'one game of twenty (5 points)',
  },
  {
    profile: 'steady',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 3.85,
    baseline: 4.35,
    margin: 'half a wave of five',
  },
  {
    profile: 'steady',
    metric: 'accuracy',
    bound: 'min',
    limit: 0.42,
    baseline: 0.52,
    margin: '10 points',
  },
  {
    profile: 'steady',
    metric: 'slowestWaveClear',
    bound: 'max',
    limit: 40,
    baseline: 20,
    margin: 'twice the slowest baseline wave',
  },
  {
    profile: 'reckless',
    metric: 'winRate',
    bound: 'max',
    limit: 0.8,
    baseline: 0.7,
    margin: 'two games of twenty (10 points); drift only, see the note above and #63',
  },
  {
    profile: 'reckless',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 4.05,
    baseline: 4.55,
    margin: 'half a wave of five',
  },
];
