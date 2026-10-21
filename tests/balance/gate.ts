import type { GateThreshold } from '../../src/core/playtest';

/**
 * The playtest gate: twenty seeded games per bot profile, 480 s cap, and the bounds a tuning
 * change must stay within. `REPORT_DIR` is under `test-results/`, which git, Biome and
 * markdownlint already ignore; CI uploads it as the `balance-report` artifact.
 *
 * The thresholds are derived from the baseline run on `main`, not from whatever the current
 * tree prints. Baseline (seeds 100..119, 480 s cap, `docs/test-plan.md`):
 *
 *   steady    win=15% waves=5.35 seconds=245 accuracy=39% breaks=1.15 clear=[4,15,16,25,21,20,23]
 *   reckless  win=0%  waves=4.20 seconds=254 accuracy=42% breaks=0.75 clear=[5,13,18,18,16,18,24]
 *
 * Each limit is the baseline moved by a stated margin in the lenient direction. The margins are
 * sized against the reference breaking change in issue #12, halving rifle damage, which moves
 * steady wins from 15% to 5%, steady waves from 5.35 to 4.35 and reckless wins from 0% to 25%:
 * each margin is about half of that shift, so the reference change fails with room and a drift
 * of one game or a fraction of a wave does not.
 */
export const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 100 + i);
export const MAX_SECONDS = 480;
export const REPORT_DIR = 'test-results/balance';

export const GATE_THRESHOLDS: readonly GateThreshold[] = [
  {
    profile: 'steady',
    metric: 'winRate',
    bound: 'min',
    limit: 0.1,
    baseline: 0.15,
    margin: 'one game of twenty (5 points); halving rifle damage costs two',
  },
  {
    profile: 'steady',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 4.85,
    baseline: 5.35,
    margin: 'half a wave; halving rifle damage costs one',
  },
  {
    profile: 'steady',
    metric: 'accuracy',
    bound: 'min',
    limit: 0.29,
    baseline: 0.39,
    margin: '10 points',
  },
  {
    profile: 'steady',
    metric: 'slowestWaveClear',
    bound: 'max',
    limit: 50,
    baseline: 25,
    margin: 'twice the slowest baseline wave',
  },
  {
    profile: 'reckless',
    metric: 'winRate',
    bound: 'max',
    limit: 0.25,
    baseline: 0.15,
    margin:
      'two games of twenty above the 15% measured at 84a835b; the temperaments stagger pack ' +
      'arrival and a never-retreating bot kills staggered skimmers one at a time (sweeps over ' +
      'flanker ratio and skittish hold all land 15 to 30%)',
  },
  {
    profile: 'reckless',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 3.7,
    baseline: 4.2,
    margin: 'half a wave',
  },
];
