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
  /Date\.now/,
  /performance\.now/,
  /from 'three/,
  /window\./,
  /document\./,
];

const listCoreFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listCoreFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });

const violations = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      FORBIDDEN.filter((pattern) => pattern.test(line)).map(
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
