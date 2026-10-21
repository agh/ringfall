/**
 * Argument parsing shared by the recording scripts. The developer running the script is the
 * only caller, so this guards against typos rather than attackers: a flag that swallows the next
 * flag as its value, an unknown flag that silently does nothing, or a seed that is not a positive
 * integer and would label a non-reproducible recording as reproducible.
 */

/** `--key value` and bare `--flag` pairs; a value never starts with `--`. */
export const parseArgs = (argv, known) => {
  const pairs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    pairs.push([arg.slice(2), next === undefined || next.startsWith('--') ? 'true' : next]);
  }
  const args = Object.fromEntries(pairs);
  if (known) {
    for (const key of Object.keys(args)) {
      if (!known.has(key)) throw new Error(`unknown flag --${key}`);
    }
  }
  return args;
};

/** A positive safe integer, or an error naming the flag. */
export const requireInt = (
  name,
  raw,
  fallback,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) => {
  if (raw === undefined) return fallback;
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
  }
  return value;
};

/** Seeds are folded to uint32 by the game, so anything larger would alias another seed. */
export const requireSeed = (raw, fallback = 7) =>
  requireInt('seed', raw, fallback, { min: 1, max: 0xffffffff });
