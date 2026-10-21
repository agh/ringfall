import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The repository is agh/ringfall. GitHub redirects the old path, but no
 * self-reference in the tree may depend on that redirect (#70). The journal
 * keeps the historical name in past-tense entries, so docs/journey/ is
 * exempt. The old path is assembled here so this file does not trip itself.
 */
const ROOT = join(__dirname, '..', '..');
const OLD_REPO = ['agh', 'hack'].join('/');
const OLD_PAGES = ['agh.github.io', 'hack'].join('/');
const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
]);
const EXEMPT_PREFIX = join('docs', 'journey') + sep;

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : listFiles(path);
    }
    return entry.isFile() ? [path] : [];
  });

const isExempt = (file: string): boolean => relative(ROOT, file).startsWith(EXEMPT_PREFIX);

const isText = (buffer: Buffer): boolean => !buffer.subarray(0, 8000).includes(0);

const violations = (file: string): string[] => {
  const buffer = readFileSync(file);
  if (!isText(buffer)) return [];
  return buffer
    .toString('utf8')
    .split('\n')
    .flatMap((line, index) =>
      line.includes(OLD_REPO) || line.includes(OLD_PAGES)
        ? [`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`]
        : [],
    );
};

describe('repository self-references', () => {
  const files = listFiles(ROOT).filter((file) => !isExempt(file));

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never names the pre-rename repository outside docs/journey/', () => {
    expect(files.flatMap(violations)).toEqual([]);
  });
});
