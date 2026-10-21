import { describe, expect, it } from 'vitest';
import { createBotMemory, decideBot, hasLineOfSight, STEADY_BOT } from '../../src/core/bot';
import {
  createGame,
  type GameEvent,
  type GameState,
  playerEye,
  stepGame,
} from '../../src/core/game';
import { rayAabb } from '../../src/core/raycast';
import { createRng } from '../../src/core/rng';
import { distance, normalize, sub, type Vec3 } from '../../src/core/vec3';
import type { Aabb } from '../../src/core/world';

/**
 * The measurement behind issue #93, kept as a fence: the demo reel's seed, replayed headlessly
 * for its first 60 s. Before the fix, 94 of the bot's 210 shots had no line of sight to any
 * live enemy (every one of them stopped at a slab), and the reel read as shooting through walls.
 * No hit point ever lay beyond the first obstacle on its ray, so the simulation itself was sound.
 */
const DT = 1 / 60;
const SEED = 7;
const SECONDS = 60;

/** Distance along the ray from `from` towards `to` to the first obstacle, or null in the open. */
const firstCover = (from: Vec3, to: Vec3, obstacles: readonly Aabb[]): number | null => {
  const dir = normalize(sub(to, from));
  let nearest: number | null = null;
  for (const box of obstacles) {
    const t = rayAabb(from, dir, box, Number.POSITIVE_INFINITY);
    if (t !== null && (nearest === null || t < nearest)) nearest = t;
  }
  return nearest;
};

interface Tally {
  shots: number;
  beams: number;
  withoutLineOfSight: number;
  beyondCover: number;
  stoppedByCover: number;
}

/** Replays the reel's seed with the steady bot and classifies every ray it fires. */
const measure = (): Tally => {
  let state: GameState = createGame({ seed: SEED });
  const simRng = createRng(SEED ^ 0x9e3779b9);
  const botRng = createRng(SEED ^ 0x7f4a7c15);
  let memory = createBotMemory();
  const tally: Tally = {
    shots: 0,
    beams: 0,
    withoutLineOfSight: 0,
    beyondCover: 0,
    stoppedByCover: 0,
  };
  while (state.status === 'playing' && state.time < SECONDS) {
    const before = state;
    const decision = decideBot(state, memory, STEADY_BOT, DT, botRng);
    memory = decision.memory;
    state = stepGame(state, decision.input, DT, simRng);
    for (const e of state.events as readonly GameEvent[]) {
      if (e.type !== 'shot' && e.type !== 'beamFired') continue;
      const eye = playerEye(before.player);
      const obstacles = before.arena.obstacles;
      const cover = firstCover(e.from, e.to, obstacles);
      const reach = distance(e.from, e.to);
      if (cover !== null && reach > cover + 1e-6) tally.beyondCover += 1;
      if (e.type === 'beamFired') {
        tally.beams += 1;
        continue;
      }
      tally.shots += 1;
      if (cover !== null && !e.hitEnemy) tally.stoppedByCover += 1;
      // The bot only pulls a hitscan trigger on a target it can see, so some live enemy must be
      // in its line of sight for every shot (the launcher fires a round, not a `shot`).
      const live = before.enemies.filter((en) => en.state !== 'dead' && en.state !== 'spawning');
      if (!live.some((en) => hasLineOfSight(eye, en, obstacles))) tally.withoutLineOfSight += 1;
    }
  }
  return tally;
};

describe('line of sight on the reel seed', () => {
  it('fires no hitscan shot without line of sight, and no hit lies beyond the first obstacle', () => {
    const tally = measure();
    expect(tally.shots).toBeGreaterThan(30);
    expect(tally.withoutLineOfSight).toBe(0);
    expect(tally.beyondCover).toBe(0);
    // Spread and aim jitter can still put a ray into the edge of a slab beside a visible target;
    // that is a miss on the slab, not a shot at it. Before the fix this was 93 of 210.
    expect(tally.stoppedByCover).toBeLessThan(tally.shots / 5);
  }, 30_000);
});
