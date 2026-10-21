export declare const parseArgs: (
  argv: readonly string[],
  known?: ReadonlySet<string>,
) => Record<string, string>;
export declare const requireInt: (
  name: string,
  raw: string | undefined,
  fallback: number,
  bounds?: { min?: number; max?: number },
) => number;
export declare const requireSeed: (raw: string | undefined, fallback?: number) => number;
