/**
 * Personal bests kept on the player's own machine. The module is pure over a tiny storage
 * interface so it is unit-tested in Node; the browser hands it `localStorage`. Nothing leaves
 * the device: there is no network after load and no identity attached to a record.
 */
export interface RecordStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersonalBests {
  readonly bestScore: number;
  readonly bestWave: number;
  readonly bestKills: number;
  readonly runs: number;
  readonly wins: number;
  /** ISO timestamp of the best-score run, for the end card. */
  readonly bestScoreAt: string | null;
}

export interface RoundResult {
  readonly score: number;
  readonly wave: number;
  readonly kills: number;
  readonly won: boolean;
  readonly at: string;
}

export interface RoundComparison {
  readonly before: PersonalBests;
  readonly after: PersonalBests;
  readonly newBestScore: boolean;
  readonly newBestWave: boolean;
  readonly newBestKills: boolean;
  readonly firstRun: boolean;
}

export const RECORDS_KEY = 'ringfall.records.v1';

export const EMPTY_BESTS: PersonalBests = {
  bestScore: 0,
  bestWave: 0,
  bestKills: 0,
  runs: 0,
  wins: 0,
  bestScoreAt: null,
};

const isBests = (value: unknown): value is PersonalBests =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PersonalBests).bestScore === 'number' &&
  typeof (value as PersonalBests).bestWave === 'number' &&
  typeof (value as PersonalBests).bestKills === 'number' &&
  typeof (value as PersonalBests).runs === 'number' &&
  typeof (value as PersonalBests).wins === 'number';

/** Reads bests; any missing, blocked, or corrupt storage yields a clean slate rather than a throw. */
export const loadBests = (store: RecordStore | null): PersonalBests => {
  if (!store) return EMPTY_BESTS;
  try {
    const raw = store.getItem(RECORDS_KEY);
    if (!raw) return EMPTY_BESTS;
    const parsed: unknown = JSON.parse(raw);
    return isBests(parsed) ? { ...EMPTY_BESTS, ...parsed } : EMPTY_BESTS;
  } catch {
    return EMPTY_BESTS;
  }
};

export const mergeRound = (bests: PersonalBests, round: RoundResult): PersonalBests => ({
  bestScore: Math.max(bests.bestScore, round.score),
  bestWave: Math.max(bests.bestWave, round.wave),
  bestKills: Math.max(bests.bestKills, round.kills),
  runs: bests.runs + 1,
  wins: bests.wins + (round.won ? 1 : 0),
  bestScoreAt: round.score > bests.bestScore ? round.at : bests.bestScoreAt,
});

/** Records a finished round and reports what, if anything, it beat. Storage failures are swallowed. */
export const recordRound = (store: RecordStore | null, round: RoundResult): RoundComparison => {
  const before = loadBests(store);
  const after = mergeRound(before, round);
  if (store) {
    try {
      store.setItem(RECORDS_KEY, JSON.stringify(after));
    } catch {
      // Private mode or a full quota: the comparison is still correct for this session.
    }
  }
  return {
    before,
    after,
    newBestScore: before.runs > 0 && round.score > before.bestScore,
    newBestWave: before.runs > 0 && round.wave > before.bestWave,
    newBestKills: before.runs > 0 && round.kills > before.bestKills,
    firstRun: before.runs === 0,
  };
};

/** One line for the end card: this round against the player's previous bests. */
export const describeComparison = (round: RoundResult, c: RoundComparison): string => {
  if (c.firstRun) return `First run on this machine: ${round.score} points, wave ${round.wave}.`;
  const parts: string[] = [];
  parts.push(
    c.newBestScore
      ? `New best score: ${round.score} (was ${c.before.bestScore}).`
      : `Score ${round.score}; your best is ${c.before.bestScore}.`,
  );
  parts.push(
    c.newBestWave
      ? `Deepest wave yet: ${round.wave} (was ${c.before.bestWave}).`
      : `Reached wave ${round.wave}; your deepest is ${c.before.bestWave}.`,
  );
  parts.push(`${c.after.runs} runs, ${c.after.wins} cleared.`);
  return parts.join(' ');
};
