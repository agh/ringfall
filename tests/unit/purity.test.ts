import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The core is a pure simulation: no renderer, no DOM, no clock, no
 * unseeded randomness. Biome enforces the imports and globals; this test
 * is the second lock, so the rule survives a lint config change.
 */
const CORE_DIR = join(__dirname, '..', '..', 'src', 'core');

const FORBIDDEN: readonly RegExp[] = [
  /Math\.random/,
  /Math\s*\[/,
  /\{[^}]*\brandom\b[^}]*\}\s*=\s*Math/,
  /\bDate\b/,
  /\bperformance\b/,
  /\bcrypto\b/,
  /\bglobalThis\b/,
  /\bself\./,
  /\bstructuredClone\b/,
  /\bIntl\b/,
  /\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/,
  /\blocalStorage\b|\bnavigator\b/,
  /\bconsole\b/,
  /from\s+["']three/,
  /import\s*\(\s*["']three/,
  /\bwindow\b/,
  /\bdocument\b/,
];

const listCoreFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listCoreFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });

/** Comment-only lines may name a host API they explain; code lines may not use one. */
const isComment = (line: string): boolean => /^\s*(\/\/|\/\*|\*)/.test(line);

const violations = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      FORBIDDEN.filter((pattern) => !isComment(line) && pattern.test(line)).map(
        (pattern) => `${file}:${index + 1} matches ${pattern}: ${line.trim()}`,
      ),
    );

describe('core purity', () => {
  const files = listCoreFiles(CORE_DIR);

  it('finds the core modules', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no renderer, DOM, clock, or Math.random', (file) => {
    expect(violations(file)).toEqual([]);
  });
});

/**
 * The patterns themselves: each impure line a core module could plausibly gain must match at
 * least one pattern, and ordinary pure lines must match none. The first audit's test caught
 * only four spellings; a mutation like `const { random } = Math` walked past it.
 */
const IMPURE = [
  'const t = globalThis.performance.now();',
  'new Date().getTime()',
  'Date.parse(stamp)',
  'crypto.getRandomValues(buf)',
  'crypto.randomUUID()',
  'const { random } = Math;',
  "Math['random']()",
  'structuredClone(state)',
  'new Intl.NumberFormat()',
  'import * as THREE from "three";',
  "await import('three')",
  'globalThis.window ?? self.window',
  'setTimeout(() => tick(), 16)',
  'console.log(state)',
  'localStorage.getItem(key)',
  'navigator.userAgent',
];
const PURE = [
  'const dt = 1 / 60;',
  'export const createRng = (seed: number): Rng => {',
  'const randomness = rng.next();',
  'const documentation = 1;',
  "const selfish = 'self-contained';",
];

describe('core purity patterns', () => {
  it.each(IMPURE)('flag %s', (line) => {
    expect(FORBIDDEN.some((p) => p.test(line))).toBe(true);
  });
  it.each(PURE)('allow %s', (line) => {
    expect(FORBIDDEN.some((p) => p.test(line))).toBe(false);
  });
  it('ignores comment lines that merely name a host API', () => {
    expect(isComment(' * the browser hands it `localStorage`.')).toBe(true);
    expect(isComment('const x = localStorage;')).toBe(false);
  });
});
