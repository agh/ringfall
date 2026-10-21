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

/**
 * A well-formed record is well under 200 bytes. Anything larger is not ours (another page on the
 * same origin, a browser extension, or a tampered profile) and is dropped before `JSON.parse`
 * so a multi-megabyte value cannot stall the end card.
 */
export const MAX_RECORD_BYTES = 1024;

/** Upper bound on any stored counter; keeps `Infinity` and absurd values off the end card. */
export const MAX_STAT = 1_000_000_000;

/** `bestScoreAt` must look like the ISO timestamp we wrote; anything else is dropped. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const EMPTY_BESTS: PersonalBests = {
  bestScore: 0,
  bestWave: 0,
  bestKills: 0,
  runs: 0,
  wins: 0,
  bestScoreAt: null,
};

const STAT_KEYS = ['bestScore', 'bestWave', 'bestKills', 'runs', 'wins'] as const;

/** A finite, non-negative integer no larger than `MAX_STAT`; everything else is rejected. */
const isStat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STAT;

/**
 * Rebuilds a record from parsed JSON, copying only the known keys with valid values. Unknown
 * keys (including `__proto__`), wrong types, negative, fractional, or oversized numbers, and a
 * malformed timestamp all mean the stored value is not trusted; the caller starts clean.
 */
export const sanitizeBests = (value: unknown): PersonalBests | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const stats: Record<string, number> = {};
  for (const key of STAT_KEYS) {
    const stat = record[key];
    if (!isStat(stat)) return null;
    stats[key] = stat;
  }
  const at = record.bestScoreAt;
  const bestScoreAt = typeof at === 'string' && ISO_TIMESTAMP.test(at) ? at : null;
  return {
    bestScore: stats.bestScore ?? 0,
    bestWave: stats.bestWave ?? 0,
    bestKills: stats.bestKills ?? 0,
    runs: stats.runs ?? 0,
    wins: stats.wins ?? 0,
    bestScoreAt,
  };
};

/** Reads bests; any missing, blocked, oversized, or corrupt storage yields a clean slate rather than a throw. */
export const loadBests = (store: RecordStore | null): PersonalBests => {
  if (!store) return EMPTY_BESTS;
  try {
    const raw = store.getItem(RECORDS_KEY);
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RECORD_BYTES) {
      return EMPTY_BESTS;
    }
    return sanitizeBests(JSON.parse(raw)) ?? EMPTY_BESTS;
  } catch {
    return EMPTY_BESTS;
  }
};

const clampStat = (value: number): number =>
  Number.isNaN(value) ? 0 : Math.min(MAX_STAT, Math.max(0, Math.floor(value)));

export const mergeRound = (bests: PersonalBests, round: RoundResult): PersonalBests => ({
  bestScore: clampStat(Math.max(bests.bestScore, round.score)),
  bestWave: clampStat(Math.max(bests.bestWave, round.wave)),
  bestKills: clampStat(Math.max(bests.bestKills, round.kills)),
  runs: clampStat(bests.runs + 1),
  wins: clampStat(bests.wins + (round.won ? 1 : 0)),
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
