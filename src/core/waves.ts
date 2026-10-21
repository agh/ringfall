import type { EnemyKind } from './enemy';

export type WavePhase = 'countdown' | 'active' | 'cleared' | 'won';

export interface WaveState {
  readonly number: number;
  readonly phase: WavePhase;
  /** Simulation time the next phase transition happens. */
  readonly phaseEndsAt: number;
}

export const FINAL_WAVE = 5;
export const WAVE_COUNTDOWN = 3;
export const WAVE_CLEAR_PAUSE = 2.5;
export const WAVE_BONUS = 500;
/** Seconds between a drop pod's `dropPod` event and its enemy going active. */
export const DROP_POD_LEAD = 1.5;
/** The Leader's strider launches this many seconds after its skimmers. */
export const LEADER_STRIDER_DELAY = 4;
/** Health multiplier of the Last Stand's armoured strider. */
export const ARMOURED_HEALTH_SCALE = 3;

export const createWaveState = (now: number): WaveState => ({
  number: 1,
  phase: 'countdown',
  phaseEndsAt: now + WAVE_COUNTDOWN,
});

/** One enemy of a wave: what lands, when its pod launches, and how tough it is. */
export interface WaveSpawn {
  readonly kind: EnemyKind;
  /** Seconds after the wave goes active that this enemy's drop pod launches. */
  readonly delay: number;
  /** Multiplier on the archetype's health; 1 for the rank and file. */
  readonly healthScale: number;
  /** The wave's leader. A `leaderDown` wave ends when it dies and the survivors flee. */
  readonly leader: boolean;
}

/** `cleared` ends the wave when every enemy is dead; `leaderDown` when the leader falls. */
export type WaveEnding = 'cleared' | 'leaderDown';

/** A named wave: its roster and the condition that ends it. */
export interface WaveBeat {
  readonly name: string;
  readonly spawns: readonly WaveSpawn[];
  readonly ending: WaveEnding;
}

const rank = (kind: EnemyKind, count: number, delay = 0): readonly WaveSpawn[] =>
  Array.from({ length: count }, (): WaveSpawn => ({ kind, delay, healthScale: 1, leader: false }));

const ARMOURED_STRIDER: WaveSpawn = {
  kind: 'strider',
  delay: 0,
  healthScale: ARMOURED_HEALTH_SCALE,
  leader: true,
};

/**
 * The five beats of Chapter 1, in order. Peaks and valleys for a five to ten minute demo:
 * a lesson, a first spectacle, a breather, a push, and an ending on the leader's death.
 * `docs/design-doc.md` carries the table rendered from this constant.
 */
export const WAVE_BEATS: readonly WaveBeat[] = [
  { name: 'Scouts', ending: 'cleared', spawns: rank('skimmer', 3) },
  {
    name: 'The Leader',
    ending: 'cleared',
    spawns: [...rank('skimmer', 4), ...rank('strider', 1, LEADER_STRIDER_DELAY)],
  },
  { name: 'Fallback', ending: 'cleared', spawns: [...rank('skimmer', 5), ...rank('strider', 2)] },
  { name: 'The Push', ending: 'cleared', spawns: [...rank('skimmer', 6), ...rank('strider', 3)] },
  {
    name: 'Last Stand',
    ending: 'leaderDown',
    spawns: [...rank('skimmer', 6), ...rank('strider', 2), ARMOURED_STRIDER],
  },
];

const FIRST_BEAT: WaveBeat = WAVE_BEATS[0] ?? { name: 'Scouts', ending: 'cleared', spawns: [] };

/** The beat for a wave number; numbers past the table hold on the final beat. */
export const waveBeat = (wave: number): WaveBeat => {
  const index = Math.min(WAVE_BEATS.length, Math.max(1, Math.floor(wave))) - 1;
  return WAVE_BEATS[index] ?? FIRST_BEAT;
};

export const waveName = (wave: number): string => waveBeat(wave).name;

/** Enemy roster for a wave, in spawn order. */
export const waveComposition = (wave: number): readonly EnemyKind[] =>
  waveBeat(wave).spawns.map((s) => s.kind);

export type WaveTransition = 'spawn' | 'next' | 'won' | null;

export interface WaveTick {
  readonly wave: WaveState;
  readonly transition: WaveTransition;
}

/**
 * Advances the wave clock. The caller spawns enemies on 'spawn' and reports `holdouts`: the
 * enemies still standing between the player and the end of the wave (every live or pending
 * enemy for a `cleared` wave, the leader alone for a `leaderDown` wave).
 */
export const tickWave = (w: WaveState, holdouts: number, now: number): WaveTick => {
  switch (w.phase) {
    case 'countdown':
      if (now < w.phaseEndsAt) return { wave: w, transition: null };
      return { wave: { ...w, phase: 'active', phaseEndsAt: now }, transition: 'spawn' };
    case 'active':
      if (holdouts > 0) return { wave: w, transition: null };
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
