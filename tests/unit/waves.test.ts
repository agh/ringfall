import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARMOURED_HEALTH_SCALE,
  ATMOSPHERE_TABLE,
  createWaveState,
  DROP_POD_LEAD,
  FINAL_WAVE,
  LEADER_STRIDER_DELAY,
  tickWave,
  WATCHERS_IN_ROSTER,
  WAVE_BEATS,
  WAVE_CLEAR_PAUSE,
  WAVE_COUNTDOWN,
  type WaveBeat,
  watcherCount,
  waveAtmosphere,
  waveBeat,
  waveComposition,
  waveName,
} from '../../src/core/waves';

const count = (beat: WaveBeat, kind: 'skimmer' | 'strider'): number =>
  beat.spawns.filter((s) => s.kind === kind).length;

describe('wave beats', () => {
  it('has one beat per wave and ends on the final one', () => {
    expect(WAVE_BEATS).toHaveLength(FINAL_WAVE);
    expect(FINAL_WAVE).toBe(5);
    expect(DROP_POD_LEAD).toBe(1.5);
  });

  it('fields the watcher column only when the roster flag is on', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(watcherCount)).toEqual([0, 0, 0, 0, 1, 1, 2, 2]);
    const inRoster = (wave: number) => waveComposition(wave).filter((k) => k === 'watcher').length;
    const waves = Array.from({ length: FINAL_WAVE }, (_, i) => i + 1);
    expect(waves.map(inRoster)).toEqual(
      WATCHERS_IN_ROSTER ? waves.map(watcherCount) : waves.map(() => 0),
    );
  });

  it('Scouts: three skimmers, nothing else', () => {
    const beat = waveBeat(1);
    expect(beat.name).toBe('Scouts');
    expect(count(beat, 'skimmer')).toBe(3);
    expect(count(beat, 'strider')).toBe(0);
    expect(beat.ending).toBe('cleared');
    expect(beat.spawns.every((s) => s.delay === 0 && s.healthScale === 1 && !s.leader)).toBe(true);
  });

  it('The Leader: four skimmers and one strider that lands late', () => {
    const beat = waveBeat(2);
    expect(beat.name).toBe('The Leader');
    expect(count(beat, 'skimmer')).toBe(4);
    expect(count(beat, 'strider')).toBe(1);
    const strider = beat.spawns.find((s) => s.kind === 'strider');
    expect(strider?.delay).toBe(LEADER_STRIDER_DELAY);
    expect(LEADER_STRIDER_DELAY).toBe(4);
    expect(beat.spawns.filter((s) => s.kind === 'skimmer').every((s) => s.delay === 0)).toBe(true);
    expect(beat.ending).toBe('cleared');
  });

  it('Fallback: five skimmers and two striders', () => {
    const beat = waveBeat(3);
    expect(beat.name).toBe('Fallback');
    expect(count(beat, 'skimmer')).toBe(5);
    expect(count(beat, 'strider')).toBe(2);
    expect(beat.ending).toBe('cleared');
  });

  it('The Push: six skimmers and three striders', () => {
    const beat = waveBeat(4);
    expect(beat.name).toBe('The Push');
    expect(count(beat, 'skimmer')).toBe(6);
    expect(count(beat, 'strider')).toBe(3);
    expect(beat.ending).toBe('cleared');
  });

  it('Last Stand: an armoured leader at triple health plus two striders and six skimmers', () => {
    const beat = waveBeat(5);
    expect(beat.name).toBe('Last Stand');
    expect(count(beat, 'skimmer')).toBe(6);
    expect(count(beat, 'strider')).toBe(3);
    const leaders = beat.spawns.filter((s) => s.leader);
    expect(leaders).toHaveLength(1);
    expect(leaders[0]?.kind).toBe('strider');
    expect(leaders[0]?.healthScale).toBe(ARMOURED_HEALTH_SCALE);
    expect(ARMOURED_HEALTH_SCALE).toBe(3);
    expect(beat.spawns.filter((s) => !s.leader).every((s) => s.healthScale === 1)).toBe(true);
    expect(beat.ending).toBe('leaderDown');
  });

  it('only the final beat ends on the leader', () => {
    expect(WAVE_BEATS.filter((b) => b.ending === 'leaderDown')).toEqual([waveBeat(FINAL_WAVE)]);
    expect(WAVE_BEATS.filter((b) => b.spawns.some((s) => s.leader))).toEqual([
      waveBeat(FINAL_WAVE),
    ]);
  });

  it('names and compositions follow the beat', () => {
    expect(WAVE_BEATS.map((b) => b.name)).toEqual([
      'Scouts',
      'The Leader',
      'Fallback',
      'The Push',
      'Last Stand',
    ]);
    expect(waveName(2)).toBe('The Leader');
    expect(waveComposition(1)).toEqual(['skimmer', 'skimmer', 'skimmer']);
    expect(waveComposition(5).filter((k) => k === 'strider')).toHaveLength(3);
  });

  it('holds on the first and final beats for numbers outside the table', () => {
    expect(waveBeat(0)).toBe(waveBeat(1));
    expect(waveBeat(-2)).toBe(waveBeat(1));
    expect(waveBeat(2.9)).toBe(waveBeat(2));
    expect(waveBeat(FINAL_WAVE + 1)).toBe(waveBeat(FINAL_WAVE));
    expect(waveBeat(1000)).toBe(waveBeat(FINAL_WAVE));
  });

  it('matches the table in the design doc, which is generated from the same constants', () => {
    const doc = readFileSync(resolve(__dirname, '../../docs/design-doc.md'), 'utf8');
    const block = doc.slice(
      doc.indexOf('<!-- wave-table:start -->'),
      doc.indexOf('<!-- wave-table:end -->'),
    );
    const rows = block
      .split('\n')
      .filter((line) => /^\| \d+ /.test(line))
      .map((line) => line.split('|').map((cell) => cell.trim()));
    expect(rows).toHaveLength(WAVE_BEATS.length);
    WAVE_BEATS.forEach((beat, i) => {
      const row = rows[i];
      expect(row?.[1]).toBe(String(i + 1));
      expect(row?.[2]).toBe(beat.name);
      expect(row?.[3]).toBe(String(count(beat, 'skimmer')));
      expect(row?.[4]).toBe(String(count(beat, 'strider')));
    });
    expect(block).toContain(`${LEADER_STRIDER_DELAY} s late`);
    expect(block).toContain(`${ARMOURED_HEALTH_SCALE}x health`);
  });
});

describe('wave clock', () => {
  it('walks countdown -> active -> cleared -> next', () => {
    let w = createWaveState(0);
    expect(tickWave(w, 0, 1).transition).toBeNull();
    const spawn = tickWave(w, 0, WAVE_COUNTDOWN);
    expect(spawn.transition).toBe('spawn');
    w = spawn.wave;
    expect(w.phase).toBe('active');
    expect(tickWave(w, 3, 4).transition).toBeNull();
    const cleared = tickWave(w, 0, 5);
    expect(cleared.wave.phase).toBe('cleared');
    expect(tickWave(cleared.wave, 0, 5.1).transition).toBeNull();
    const next = tickWave(cleared.wave, 0, 5 + WAVE_CLEAR_PAUSE);
    expect(next.transition).toBe('next');
    expect(next.wave.number).toBe(2);
    expect(next.wave.phase).toBe('countdown');
  });

  it('moves to the final wave, not to victory, when the one before it clears', () => {
    // Nothing else pins FINAL_WAVE: a `>= FINAL_WAVE - 1` slip passed every other test.
    const w = { number: FINAL_WAVE - 1, phase: 'active' as const, phaseEndsAt: 0 };
    const cleared = tickWave(w, 0, 100);
    expect(cleared.wave.phase).toBe('cleared');
    const next = tickWave(cleared.wave, 0, cleared.wave.phaseEndsAt);
    expect(next.transition).toBe('next');
    expect(next.wave.number).toBe(FINAL_WAVE);
    expect(next.wave.phase).not.toBe('won');
  });

  it('declares victory when the final wave has no holdouts left', () => {
    const w = { number: FINAL_WAVE, phase: 'active' as const, phaseEndsAt: 0 };
    expect(tickWave(w, 1, 99).transition).toBeNull();
    const won = tickWave(w, 0, 100);
    expect(won.transition).toBe('won');
    expect(won.wave.phase).toBe('won');
    expect(tickWave(won.wave, 0, 101).transition).toBeNull();
  });
});

describe('waveAtmosphere', () => {
  const times = ['dawn', 'day', 'dusk', 'night'];
  const weathers = ['clear', 'rain', 'fog'];

  it('opens in daylight and brings the night for wave two', () => {
    expect(waveAtmosphere(1)).toEqual({ timeOfDay: 'day', weather: 'clear' });
    expect(waveAtmosphere(2)).toEqual({ timeOfDay: 'night', weather: 'clear' });
  });

  it('returns a valid pair for every wave, including odd inputs', () => {
    for (const wave of [0, -3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 2.7, 1000]) {
      const atmosphere = waveAtmosphere(wave);
      expect(times).toContain(atmosphere.timeOfDay);
      expect(weathers).toContain(atmosphere.weather);
    }
  });

  it('cycles through the table beyond the final wave', () => {
    const length = ATMOSPHERE_TABLE.length;
    expect(waveAtmosphere(length + 1)).toEqual(waveAtmosphere(1));
    expect(waveAtmosphere(length + 2)).toEqual(waveAtmosphere(2));
    expect(waveAtmosphere(2 * length)).toEqual(waveAtmosphere(length));
    expect(waveAtmosphere(FINAL_WAVE)).toEqual(ATMOSPHERE_TABLE[FINAL_WAVE - 1]);
  });
});
