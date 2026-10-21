import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRANCHISE_TERMS } from './originality.terms';

/**
 * Ringfall is an original work (ADR-0003). This test greps every tracked
 * and untracked-but-not-ignored file outside `docs/research/` for the
 * franchise term list and fails on a hit, so a name cannot creep back in
 * through a comment, a UI string, a document, or a file name.
 */
const ROOT = join(__dirname, '..', '..');
const EXEMPT_PREFIX = 'docs/research/';
const TERMS_FILE = relative(ROOT, join(__dirname, 'originality.terms.ts'));
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
  '.woff',
  '.woff2',
]);

const listFiles = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((path) => path.length > 0)
    .filter((path) => !path.startsWith(EXEMPT_PREFIX) && path !== TERMS_FILE);

const hits = (path: string): string[] => {
  const inPath = FRANCHISE_TERMS.filter((term) => term.test(path)).map(
    (term) => `${path} (file name) matches ${term}`,
  );
  if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return inPath;
  const inBody = readFileSync(join(ROOT, path), 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      FRANCHISE_TERMS.filter((term) => term.test(line)).map(
        (term) => `${path}:${index + 1} matches ${term}: ${line.trim()}`,
      ),
    );
  return [...inPath, ...inBody];
};

describe('originality', () => {
  const files = listFiles();

  it('has a term list and a repository to scan', () => {
    expect(FRANCHISE_TERMS.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((path) => path.startsWith('src/'))).toBe(true);
  });

  it('names the franchise nowhere outside the cited research', () => {
    expect(files.flatMap(hits)).toEqual([]);
  });
});
