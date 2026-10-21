/** Seeded PRNG (mulberry32) so simulations and tests are deterministic. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
  };
};

/** Largest seed the generator distinguishes: `createRng` folds the seed to an unsigned 32-bit int. */
export const MAX_SEED = 0xffffffff;

/**
 * Parses an untrusted seed string (the `?seed=` query parameter) into a usable seed.
 * Only a plain decimal integer in `[1, MAX_SEED]` is accepted; anything else (`abc`, `1e400`,
 * `-1`, `0x10`, `1.5`, an empty value, or `null`) yields `fallback`, so hostile or malformed
 * input can neither throw nor collapse the generator to a degenerate state.
 */
export const parseSeed = (raw: string | null | undefined, fallback: number): number => {
  if (typeof raw !== 'string' || !/^[0-9]{1,10}$/.test(raw)) return fallback;
  const value = Number(raw);
  return value >= 1 && value <= MAX_SEED ? value : fallback;
};
