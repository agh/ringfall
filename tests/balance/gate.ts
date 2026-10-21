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
 * Issue #93 then stopped the bot firing hitscan weapons without line of sight and made it walk
 * at a target behind cover instead of waiting. Holding fire alone left the gate on its limits
 * (steady 70% wins, 231 s mean, reckless 4.05 waves: the bot stood still while a target sat
 * behind a slab); with the walk it beats the run above on every steady metric, and the reckless
 * win rate (85%) passes the old drift cap. The baseline below is that branch on `main` at
 * cd16454, same seeds and cap, and the limits are re-derived from it with the margins unchanged:
 *
 *   steady    win=85% waves=4.50 seconds=154 accuracy=83% breaks=0.10 clear=[4,11,16,20]
 *   reckless  win=85% waves=4.70 seconds=138 accuracy=83% breaks=0.20 clear=[4,16,15,18]
 *
 * Accuracy jumps because shots into cover were counted as misses; it is now a line-of-sight
 * signal as much as an aim one.
 *
 * The enemy dead ends seen in the #93 traces came next: a chasing enemy wedged on the corner of
 * a cover block, or pressed against a face the player stood straight behind, never moved again,
 * and a strider inside its range band with cover between it and the player held still, firing
 * into the block. Five of the forty games above ran to the cap that way, and three more once
 * only the sidestep was in. With the sidestep (`STUCK_AFTER`) and the clear-shot rule
 * (`hasClearShot`) both profiles win every game. The baseline below is that branch on `main` at
 * 8c840b2, same seeds and cap, and the limits are re-derived from it with the margins unchanged:
 *
 *   steady    win=100% waves=5.00 seconds=93 accuracy=88% breaks=0.10 clear=[4,11,14,17]
 *   reckless  win=100% waves=5.00 seconds=95 accuracy=80% breaks=0.20 clear=[4,11,14,15]
 *
 * The reckless win-rate cap saturates: 100% plus two games of twenty is 100%, so that row holds
 * nothing until #63 gives the gate a cross-profile bound; it stays so the report keeps showing
 * it. Each limit is the baseline moved by the same margin as before in the lenient direction:
 * one game of twenty on the steady win rate, half a wave on waves cleared,
 * ten points of accuracy, twice the slowest wave, two games on the reckless win rate. The margins
 * were sized against the reference breaking change in issue #12 (halving rifle damage) under the
 * eight-wave formula and have not been re-measured under the five beats. One intent is lost: the
 * reckless bound used to say "never retreating must not become the way to win", and under the
 * beats as specified in #8 the reckless profile wins 85% of its games, so that bound now only
 * catches drift, and as of this baseline not even that. Issue #63 holds that question.
 */
export const SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 100 + i);
export const MAX_SECONDS = 480;
export const REPORT_DIR = 'test-results/balance';

export const GATE_THRESHOLDS: readonly GateThreshold[] = [
  {
    profile: 'steady',
    metric: 'winRate',
    bound: 'min',
    limit: 0.95,
    baseline: 1,
    margin: 'one game of twenty (5 points)',
  },
  {
    profile: 'steady',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 4.5,
    baseline: 5,
    margin: 'half a wave of five',
  },
  {
    profile: 'steady',
    metric: 'accuracy',
    bound: 'min',
    limit: 0.78,
    baseline: 0.88,
    margin: '10 points',
  },
  {
    profile: 'steady',
    metric: 'slowestWaveClear',
    bound: 'max',
    limit: 34,
    baseline: 17,
    margin: 'twice the slowest baseline wave',
  },
  {
    profile: 'reckless',
    metric: 'winRate',
    bound: 'max',
    limit: 1,
    baseline: 1,
    margin:
      'two games of twenty (10 points), saturated at 100%: holds nothing, see the note above and #63',
  },
  {
    profile: 'reckless',
    metric: 'meanWavesCleared',
    bound: 'min',
    limit: 4.5,
    baseline: 5,
    margin: 'half a wave of five',
  },
];
