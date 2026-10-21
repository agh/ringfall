import { type BotMemory, type BotProfile, createBotMemory, decideBot, STEADY_BOT } from './bot';
import { createGame, type GameEvent, type GameState, stepGame } from './game';
import { createRng } from './rng';

/**
 * Headless playtest: runs the bot against the simulation at 60 Hz with no renderer and
 * returns the numbers a designer reads to judge balance. Thousands of games per minute.
 */
export interface PlaytestResult {
  readonly seed: number;
  readonly outcome: 'won' | 'dead' | 'timeout';
  readonly wavesCleared: number;
  readonly seconds: number;
  readonly kills: number;
  readonly score: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly shieldBreaks: number;
  readonly grenadesThrown: number;
  readonly damageTaken: number;
  /** Simulation seconds spent with the shield fully down. */
  readonly secondsShieldDown: number;
  readonly waveClearTimes: readonly number[];
}

export interface PlaytestOptions {
  readonly seed: number;
  readonly profile?: BotProfile;
  readonly maxSeconds?: number;
  /** Receives every step's state and events; used by recorders. */
  readonly onStep?: (state: GameState, input: ReturnType<typeof decideBot>['input']) => void;
}

const DT = 1 / 60;

export const runPlaytest = (options: PlaytestOptions): PlaytestResult => {
  const profile = options.profile ?? STEADY_BOT;
  const maxSeconds = options.maxSeconds ?? 600;
  let state = createGame({ seed: options.seed });
  const simRng = createRng(options.seed ^ 0x9e3779b9);
  const botRng = createRng(options.seed ^ 0x7f4a7c15);
  let memory: BotMemory = createBotMemory();
  let shotsFired = 0;
  let shotsHit = 0;
  let shieldBreaks = 0;
  let grenadesThrown = 0;
  let damageTaken = 0;
  let secondsShieldDown = 0;
  const waveClearTimes: number[] = [];
  let waveStartedAt = 0;

  const tally = (events: readonly GameEvent[], time: number): void => {
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          shotsFired += 1;
          if (e.hitEnemy) shotsHit += 1;
          break;
        case 'shieldBroken':
          shieldBreaks += 1;
          break;
        case 'grenadeThrown':
          grenadesThrown += 1;
          break;
        case 'playerDamaged':
          damageTaken += e.amount;
          break;
        case 'waveStarted':
          waveStartedAt = time;
          break;
        case 'waveCleared':
          waveClearTimes.push(time - waveStartedAt);
          break;
      }
    }
  };

  while (state.status === 'playing' && state.time < maxSeconds) {
    const decision = decideBot(state, memory, profile, DT, botRng);
    memory = decision.memory;
    state = stepGame(state, decision.input, DT, simRng);
    tally(state.events, state.time);
    if (state.player.vitality.shield <= 0) secondsShieldDown += DT;
    options.onStep?.(state, decision.input);
  }

  return {
    seed: options.seed,
    outcome: state.status === 'playing' ? 'timeout' : state.status,
    wavesCleared: state.status === 'won' ? state.wave.number : state.wave.number - 1,
    seconds: state.time,
    kills: state.kills,
    score: state.score,
    shotsFired,
    shotsHit,
    shieldBreaks,
    grenadesThrown,
    damageTaken,
    secondsShieldDown,
    waveClearTimes,
  };
};

export interface BalanceSummary {
  readonly games: number;
  readonly winRate: number;
  readonly meanWavesCleared: number;
  readonly meanSeconds: number;
  readonly accuracy: number;
  readonly meanShieldBreaks: number;
  readonly meanWaveClearTimes: readonly number[];
}

export const summarize = (results: readonly PlaytestResult[]): BalanceSummary => {
  const n = results.length || 1;
  const mean = (f: (r: PlaytestResult) => number): number =>
    results.reduce((a, r) => a + f(r), 0) / n;
  const waves = Math.max(0, ...results.map((r) => r.waveClearTimes.length));
  const meanWaveClearTimes = Array.from({ length: waves }, (_, i) => {
    const samples = results
      .map((r) => r.waveClearTimes[i])
      .filter((t): t is number => t !== undefined);
    return samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  });
  const fired = results.reduce((a, r) => a + r.shotsFired, 0);
  const hit = results.reduce((a, r) => a + r.shotsHit, 0);
  return {
    games: results.length,
    winRate: results.filter((r) => r.outcome === 'won').length / n,
    meanWavesCleared: mean((r) => r.wavesCleared),
    meanSeconds: mean((r) => r.seconds),
    accuracy: fired ? hit / fired : 0,
    meanShieldBreaks: mean((r) => r.shieldBreaks),
    meanWaveClearTimes,
  };
};

/** A bot profile the gate measures; the names are the keys of a {@link BalanceReport}. */
export type GateProfile = 'steady' | 'reckless';

/** A metric of a {@link BalanceSummary} the gate can bound. */
export type GateMetric = 'winRate' | 'meanWavesCleared' | 'accuracy' | 'slowestWaveClear';

/**
 * One bound of the balance gate. `limit` is the baseline moved by `margin` in the lenient
 * direction, so a tuning change fails the gate only when it moves the number further than the
 * margin from the run the thresholds were derived from.
 */
export interface GateThreshold {
  readonly profile: GateProfile;
  readonly metric: GateMetric;
  /** `min`: the actual value must be at least `limit`; `max`: at most `limit`. */
  readonly bound: 'min' | 'max';
  readonly limit: number;
  /** The value the baseline run printed for this metric. */
  readonly baseline: number;
  /** How `limit` was derived from `baseline`, in words. */
  readonly margin: string;
}

export interface GateCheck extends GateThreshold {
  readonly actual: number;
  readonly passed: boolean;
}

export const readGateMetric = (summary: BalanceSummary, metric: GateMetric): number => {
  switch (metric) {
    case 'winRate':
      return summary.winRate;
    case 'meanWavesCleared':
      return summary.meanWavesCleared;
    case 'accuracy':
      return summary.accuracy;
    case 'slowestWaveClear':
      return Math.max(0, ...summary.meanWaveClearTimes);
  }
};

export const evaluateGate = (
  summaries: Readonly<Record<GateProfile, BalanceSummary>>,
  thresholds: readonly GateThreshold[],
): GateCheck[] =>
  thresholds.map((t) => {
    const actual = readGateMetric(summaries[t.profile], t.metric);
    const passed = t.bound === 'min' ? actual >= t.limit : actual <= t.limit;
    return { ...t, actual, passed };
  });

/** What `pnpm balance` writes: the summaries, every game, and the gate verdict. */
export interface BalanceReport {
  readonly seeds: readonly number[];
  readonly maxSeconds: number;
  readonly summaries: Readonly<Record<GateProfile, BalanceSummary>>;
  readonly games: Readonly<Record<GateProfile, readonly PlaytestResult[]>>;
  readonly checks: readonly GateCheck[];
  readonly passed: boolean;
}

export const buildBalanceReport = (
  games: Readonly<Record<GateProfile, readonly PlaytestResult[]>>,
  thresholds: readonly GateThreshold[],
  options: { readonly seeds: readonly number[]; readonly maxSeconds: number },
): BalanceReport => {
  const summaries = { steady: summarize(games.steady), reckless: summarize(games.reckless) };
  const checks = evaluateGate(summaries, thresholds);
  return {
    seeds: options.seeds,
    maxSeconds: options.maxSeconds,
    summaries,
    games,
    checks,
    passed: checks.every((c) => c.passed),
  };
};
