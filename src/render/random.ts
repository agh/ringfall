import { createRng } from '../core/rng';

/**
 * The renderer's one source of randomness: dust, shake, debris, texture grain. Seeded, so a
 * `?record` capture of a seeded run draws the same frames every time (R9 in #51); the game's
 * own rolls live in the simulation and never come through here.
 */
const rng = createRng(0x52494e47);

/** Uniform float in [0, 1), like `Math.random()`. */
export const renderRandom = (): number => rng.next();
