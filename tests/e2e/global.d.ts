import type { GameState } from '../../src/core/game';

declare global {
  interface Window {
    ringfall?: {
      state: () => GameState;
      running: () => boolean;
    };
  }
}
