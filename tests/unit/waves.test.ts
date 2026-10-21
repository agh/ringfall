import { describe, expect, it } from 'vitest';
import {
  createWaveState,
  FINAL_WAVE,
  tickWave,
  WAVE_CLEAR_PAUSE,
  WAVE_COUNTDOWN,
  waveComposition,
} from '../../src/core/waves';

describe('waves', () => {
  it('scales the roster with the wave number', () => {
    expect(waveComposition(1)).toEqual(['skimmer', 'skimmer', 'skimmer']);
    expect(waveComposition(2).filter((k) => k === 'strider')).toHaveLength(1);
    expect(waveComposition(6).length).toBeGreaterThan(waveComposition(3).length);
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

  it('declares victory after the final wave', () => {
    const w = { number: FINAL_WAVE, phase: 'active' as const, phaseEndsAt: 0 };
    const won = tickWave(w, 0, 100);
    expect(won.transition).toBe('won');
    expect(won.wave.phase).toBe('won');
    expect(tickWave(won.wave, 0, 101).transition).toBeNull();
  });
});
