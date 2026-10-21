import { describe, expect, it } from 'vitest';
import {
  describeComparison,
  EMPTY_BESTS,
  loadBests,
  MAX_RECORD_BYTES,
  MAX_STAT,
  mergeRound,
  RECORDS_KEY,
  type RecordStore,
  recordRound,
  sanitizeBests,
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

  it('reports a first run and keeps nothing when there is no storage at all', () => {
    const c = recordRound(null, round(300, 1));
    expect(c.firstRun).toBe(true);
    expect(c.before).toEqual(EMPTY_BESTS);
    expect(c.after.runs).toBe(1);
    expect(c.newBestScore).toBe(false);
    expect(describeComparison(round(300, 1), c)).toContain('First run');
    // Nothing persisted: the next round on the same null store is a first run again.
    expect(recordRound(null, round(900, 2)).firstRun).toBe(true);
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

  describe('hostile storage', () => {
    const valid = {
      bestScore: 1200,
      bestWave: 3,
      bestKills: 9,
      runs: 2,
      wins: 1,
      bestScoreAt: '2026-10-21T15:00:00.000Z',
    };

    it('drops a 10 MB value without parsing it', () => {
      const huge = `{"bestScore":1,"pad":"${'x'.repeat(10 * 1024 * 1024)}"}`;
      const store = memoryStore({ [RECORDS_KEY]: huge });
      const started = performance.now();
      expect(loadBests(store)).toEqual(EMPTY_BESTS);
      expect(performance.now() - started).toBeLessThan(200);
    });

    it('drops anything over the byte budget even when it is otherwise valid', () => {
      const padded = JSON.stringify({ ...valid, pad: 'x'.repeat(MAX_RECORD_BYTES) });
      expect(loadBests(memoryStore({ [RECORDS_KEY]: padded }))).toEqual(EMPTY_BESTS);
      expect(loadBests(memoryStore({ [RECORDS_KEY]: JSON.stringify(valid) }))).toEqual(valid);
    });

    it.each([
      ['an array', '[1,2,3]'],
      ['a string', '"bestScore"'],
      ['a number', '42'],
      ['null', 'null'],
      ['a negative score', JSON.stringify({ ...valid, bestScore: -1 })],
      ['a fractional wave', JSON.stringify({ ...valid, bestWave: 2.5 })],
      ['an out-of-range value', JSON.stringify({ ...valid, bestKills: MAX_STAT + 1 })],
      [
        'infinity written by hand',
        '{"bestScore":1e400,"bestWave":1,"bestKills":1,"runs":1,"wins":1}',
      ],
      ['a numeric string', JSON.stringify({ ...valid, runs: '2' })],
      ['a boolean', JSON.stringify({ ...valid, wins: true })],
      ['a missing counter', JSON.stringify({ bestScore: 1, bestWave: 1, bestKills: 1, runs: 1 })],
    ])('starts clean when storage holds %s', (_label, raw) => {
      expect(loadBests(memoryStore({ [RECORDS_KEY]: raw }))).toEqual(EMPTY_BESTS);
    });

    it('does not pollute prototypes or copy unknown keys', () => {
      const raw = JSON.stringify({
        ...valid,
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
        extra: '<img src=x onerror=alert(1)>',
      });
      const bests = loadBests(memoryStore({ [RECORDS_KEY]: raw }));
      expect(bests).toEqual(valid);
      expect(Object.keys(bests)).toEqual(Object.keys(EMPTY_BESTS));
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
      expect(Object.hasOwn(bests, '__proto__')).toBe(false);
    });

    it.each([
      ['a non-string', 123],
      ['markup', '<b>2026</b>'],
      ['a long string', '2'.repeat(200)],
      ['a date without the Z', '2026-10-21T15:00:00'],
      ['an object', { toString: 'x' }],
    ])('drops a bestScoreAt that is %s', (_label, at) => {
      const bests = loadBests(
        memoryStore({ [RECORDS_KEY]: JSON.stringify({ ...valid, bestScoreAt: at }) }),
      );
      expect(bests).toEqual({ ...valid, bestScoreAt: null });
    });

    it('clamps the counters it writes so a bad round cannot poison storage', () => {
      const merged = mergeRound(EMPTY_BESTS, {
        score: Number.POSITIVE_INFINITY,
        wave: -4,
        kills: 2.9,
        won: true,
        at: '2026-10-21T15:00:00.000Z',
      });
      expect(merged.bestScore).toBe(MAX_STAT);
      expect(merged.bestWave).toBe(0);
      expect(merged.bestKills).toBe(2);
      expect(merged.runs).toBe(1);
      expect(sanitizeBests(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
    });

    it('rewrites a tampered record with a clean one after the next round', () => {
      const store = memoryStore({ [RECORDS_KEY]: JSON.stringify({ ...valid, bestScore: -5 }) });
      recordRound(store, round(300, 1));
      const written = store.data[RECORDS_KEY] ?? '';
      expect(written.length).toBeLessThan(MAX_RECORD_BYTES);
      expect(JSON.parse(written)).toEqual({
        bestScore: 300,
        bestWave: 1,
        bestKills: 5,
        runs: 1,
        wins: 0,
        bestScoreAt: '2026-10-21T15:00:00Z',
      });
    });
  });
});
