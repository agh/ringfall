import type { EnemyKind } from './enemy';

export type WavePhase = 'countdown' | 'active' | 'cleared' | 'won';

export interface WaveState {
  readonly number: number;
  readonly phase: WavePhase;
  /** Simulation time the next phase transition happens. */
  readonly phaseEndsAt: number;
}

export const FINAL_WAVE = 8;
export const WAVE_COUNTDOWN = 3;
export const WAVE_CLEAR_PAUSE = 2.5;
export const WAVE_BONUS = 500;

export const createWaveState = (now: number): WaveState => ({
  number: 1,
  phase: 'countdown',
  phaseEndsAt: now + WAVE_COUNTDOWN,
});

/** Enemy roster for a wave: skimmers scale linearly, striders join from wave 2. */
export const waveComposition = (wave: number): readonly EnemyKind[] => {
  const skimmers = 2 + wave;
  const striders = Math.floor(wave / 2);
  return [
    ...Array.from({ length: skimmers }, (): EnemyKind => 'skimmer'),
    ...Array.from({ length: striders }, (): EnemyKind => 'strider'),
  ];
};

export type WaveTransition = 'spawn' | 'next' | 'won' | null;

export interface WaveTick {
  readonly wave: WaveState;
  readonly transition: WaveTransition;
}

/** Advances the wave clock. The caller spawns enemies on 'spawn' and reports `aliveEnemies`. */
export const tickWave = (w: WaveState, aliveEnemies: number, now: number): WaveTick => {
  switch (w.phase) {
    case 'countdown':
      if (now < w.phaseEndsAt) return { wave: w, transition: null };
      return { wave: { ...w, phase: 'active', phaseEndsAt: now }, transition: 'spawn' };
    case 'active':
      if (aliveEnemies > 0) return { wave: w, transition: null };
      if (w.number >= FINAL_WAVE) return { wave: { ...w, phase: 'won' }, transition: 'won' };
      return {
        wave: { ...w, phase: 'cleared', phaseEndsAt: now + WAVE_CLEAR_PAUSE },
        transition: null,
      };
    case 'cleared':
      if (now < w.phaseEndsAt) return { wave: w, transition: null };
      return {
        wave: { number: w.number + 1, phase: 'countdown', phaseEndsAt: now + WAVE_COUNTDOWN },
        transition: 'next',
      };
    case 'won':
      return { wave: w, transition: null };
  }
};
