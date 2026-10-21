import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_TABLE,
  createWaveState,
  FINAL_WAVE,
  tickWave,
  WATCHERS_IN_ROSTER,
  WAVE_CLEAR_PAUSE,
  WAVE_COUNTDOWN,
  watcherCount,
  waveAtmosphere,
  waveComposition,
} from '../../src/core/waves';

describe('waves', () => {
  it('scales the roster with the wave number', () => {
    expect(waveComposition(1)).toEqual(['skimmer', 'skimmer', 'skimmer']);
    expect(waveComposition(2).filter((k) => k === 'strider')).toHaveLength(1);
    expect(waveComposition(6).length).toBeGreaterThan(waveComposition(3).length);
    const waves = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(waves.map(watcherCount)).toEqual([0, 0, 0, 0, 1, 1, 2, 2]);
    const inRoster = (wave: number) => waveComposition(wave).filter((k) => k === 'watcher').length;
    expect(waves.map(inRoster)).toEqual(
      WATCHERS_IN_ROSTER ? waves.map(watcherCount) : waves.map(() => 0),
    );
  });

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

  it('declares victory after the final wave', () => {
    const w = { number: FINAL_WAVE, phase: 'active' as const, phaseEndsAt: 0 };
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
