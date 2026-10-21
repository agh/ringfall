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

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'fog';

/** Sky and weather for a wave: the ring turns under the player as the night draws in. */
export interface Atmosphere {
  readonly timeOfDay: TimeOfDay;
  readonly weather: Weather;
}

/** One entry per wave; waves beyond the table cycle through it again. */
export const ATMOSPHERE_TABLE: readonly Atmosphere[] = [
  { timeOfDay: 'day', weather: 'clear' },
  { timeOfDay: 'night', weather: 'clear' },
  { timeOfDay: 'dusk', weather: 'rain' },
  { timeOfDay: 'night', weather: 'fog' },
  { timeOfDay: 'dawn', weather: 'clear' },
  { timeOfDay: 'day', weather: 'rain' },
  { timeOfDay: 'dusk', weather: 'clear' },
  { timeOfDay: 'night', weather: 'rain' },
];

export const waveAtmosphere = (wave: number): Atmosphere => {
  const index = (Math.max(1, Math.floor(wave)) - 1) % ATMOSPHERE_TABLE.length;
  return ATMOSPHERE_TABLE[index] ?? { timeOfDay: 'day', weather: 'clear' };
};
