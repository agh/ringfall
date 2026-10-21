import { describe, expect, it } from 'vitest';
import {
  describeComparison,
  EMPTY_BESTS,
  loadBests,
  mergeRound,
  RECORDS_KEY,
  type RecordStore,
  recordRound,
} from '../../src/core/records';

const memoryStore = (
  seed: Record<string, string> = {},
): RecordStore & { data: Record<string, string> } => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

const round = (score: number, wave: number, kills = 5, won = false) => ({
  score,
  wave,
  kills,
  won,
  at: '2026-10-21T15:00:00Z',
});

describe('records', () => {
  it('starts clean without storage, with empty storage, and with corrupt storage', () => {
    expect(loadBests(null)).toEqual(EMPTY_BESTS);
    expect(loadBests(memoryStore())).toEqual(EMPTY_BESTS);
    expect(loadBests(memoryStore({ [RECORDS_KEY]: '{not json' }))).toEqual(EMPTY_BESTS);
    expect(loadBests(memoryStore({ [RECORDS_KEY]: '{"bestScore":"x"}' }))).toEqual(EMPTY_BESTS);
  });

  it('keeps the maximum of each stat and counts runs and wins', () => {
    const a = mergeRound(EMPTY_BESTS, round(1200, 3, 9));
    const b = mergeRound(a, round(800, 5, 4, true));
    expect(b.bestScore).toBe(1200);
    expect(b.bestWave).toBe(5);
    expect(b.bestKills).toBe(9);
    expect(b.runs).toBe(2);
    expect(b.wins).toBe(1);
    expect(b.bestScoreAt).toBe('2026-10-21T15:00:00Z');
  });

  it('persists and reports new bests across rounds', () => {
    const store = memoryStore();
    const first = recordRound(store, round(500, 2));
    expect(first.firstRun).toBe(true);
    expect(first.newBestScore).toBe(false);
    expect(JSON.parse(store.data[RECORDS_KEY] ?? '{}').bestScore).toBe(500);
    const second = recordRound(store, round(900, 2));
    expect(second.newBestScore).toBe(true);
    expect(second.newBestWave).toBe(false);
    const third = recordRound(store, round(100, 4));
    expect(third.newBestScore).toBe(false);
    expect(third.newBestWave).toBe(true);
    expect(third.after.runs).toBe(3);
  });

  it('survives a storage that throws on write', () => {
    const store: RecordStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const c = recordRound(store, round(300, 1));
    expect(c.after.runs).toBe(1);
  });

  it('describes the round in one line', () => {
    const store = memoryStore();
    const r1 = round(500, 2);
    expect(describeComparison(r1, recordRound(store, r1))).toContain('First run');
    const r2 = round(900, 3);
    const text = describeComparison(r2, recordRound(store, r2));
    expect(text).toContain('New best score: 900 (was 500)');
    expect(text).toContain('Deepest wave yet: 3 (was 2)');
    expect(text).toContain('2 runs');
  });
});
