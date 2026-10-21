import type { GateThreshold } from '../../src/core/playtest';

/**
 * The playtest gate: twenty seeded games per bot profile, 480 s cap, and the bounds a tuning
 * change must stay within. `REPORT_DIR` is under `test-results/`, which git, Biome and
 * markdownlint already ignore; CI uploads it as the `balance-report` artifact.
 *
 * The thresholds are derived from a baseline run on `main`, not from whatever the current
 * tree prints. The first baseline was the eight-wave formula (seeds 100..119, 480 s cap):
 *
 *   steady    win=15% waves=5.35 seconds=245 accuracy=39% breaks=1.15 clear=[4,15,16,25,21,20,23]
 *   reckless  win=0%  waves=4.20 seconds=254 accuracy=42% breaks=0.75 clear=[5,13,18,18,16,18,24]
 *
 * Issue #8 cut Chapter 1 to five named beats (`WAVE_BEATS`), so `meanWavesCleared` is now out
 * of 5 and the bounds above could not hold. The baseline below is the first run of the five
 * beats on top of the rout (#40), same seeds and cap:
 *
 *   steady    win=65% waves=4.25 seconds=159 accuracy=50% breaks=0.35 clear=[6,12,19,18]
 *   reckless  win=55% waves=4.05 seconds=257 accuracy=43% breaks=0.25 clear=[6,18,18,23]
 *
 * Each limit is the baseline moved by the same margin as before in the lenient direction: one
 * game of twenty on the steady win rate, half a wave on waves cleared, ten points of accuracy,
 * twice the slowest wave, two games on the reckless win rate. The margins were sized against the
 * reference breaking change in issue #12 (halving rifle damage) under the eight-wave formula and
 * have not been re-measured under the five beats. One intent is lost: the reckless bound used to
 * say "never retreating must not become the way to win", and under the beats as specified in #8
 * the reckless profile wins 55% of its games, so that bound now only catches drift. Issue #12
 * decides whether the compositions or the bound should move.
 */
export const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 100 + i);
export const MAX_SECONDS = 480;
export const REPORT_DIR = 'test-results/balance';

export const GATE_THRESHOLDS: readonly GateThreshold[] = [
  {
    profile: 'steady',
    metric: 'winRate',
    bound: 'min',
    limit: 0.6,
    baseline: 0.65,
    margin: 'one game of twenty (5 points); also the floor issue #8 asks for',
  },
  {
    profile: 'steady',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 3.75,
    baseline: 4.25,
    margin: 'half a wave of five',
  },
  {
    profile: 'steady',
    metric: 'accuracy',
    bound: 'min',
    limit: 0.4,
    baseline: 0.5,
    margin: '10 points',
  },
  {
    profile: 'steady',
    metric: 'slowestWaveClear',
    bound: 'max',
    limit: 38,
    baseline: 19,
    margin: 'twice the slowest baseline wave',
  },
  {
    profile: 'reckless',
    metric: 'winRate',
    bound: 'max',
    limit: 0.65,
    baseline: 0.55,
    margin: 'two games of twenty (10 points); drift only, see the note above',
  },
  {
    profile: 'reckless',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 3.55,
    baseline: 4.05,
    margin: 'half a wave of five',
  },
];
