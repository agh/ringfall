import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate } from '../../scripts/architecture.mjs';

/**
 * The architecture package quotes the code: the module map and the C4 level 3 diagrams come
 * from the import graph, and the event catalogue from the `GameEvent` union and the switches
 * that consume it. `scripts/architecture.mjs` generates those files; this test regenerates
 * them in memory and compares byte for byte, so an import, a module, an event or a consumer
 * added without `pnpm docs:architecture` fails here with the path to rewrite.
 */
const ROOT = join(__dirname, '..', '..');
const DIAGRAMS = join(ROOT, 'docs', 'architecture', 'diagrams');
const RENDER = join(ROOT, 'docs', 'architecture', 'render');

describe('docs/architecture generated files', () => {
  const { files, moduleCount, eventCount } = generate();

  it('generates the four files the package expects', () => {
    expect(Object.keys(files).sort()).toEqual([
      'docs/architecture/diagrams/core-components.mmd',
      'docs/architecture/diagrams/render-components.mmd',
      'docs/architecture/events.md',
      'docs/architecture/modules.md',
    ]);
    expect(moduleCount).toBeGreaterThan(0);
    expect(eventCount).toBeGreaterThan(0);
  });

  it.each(Object.keys(files))('%s matches the code', (path) => {
    const full = join(ROOT, path);
    expect(existsSync(full), `${path} is missing; run pnpm docs:architecture`).toBe(true);
    expect(
      readFileSync(full, 'utf8'),
      `${path} drifted from the code; run pnpm docs:architecture`,
    ).toBe(files[path]);
  });

  it('quotes the generated counts in the generated prose, not by hand', () => {
    expect(files['docs/architecture/modules.md']).toContain(`holds ${moduleCount} modules`);
    expect(files['docs/architecture/events.md']).toContain(`has ${eventCount} events`);
  });
});

describe('docs/architecture rendered diagrams', () => {
  const sources = readdirSync(DIAGRAMS).filter((f) => f.endsWith('.mmd'));

  it('has a PNG under render/ for every Mermaid source', () => {
    const missing = sources
      .map((f) => f.replace(/\.mmd$/, '.png'))
      .filter((png) => !existsSync(join(RENDER, png)));
    expect(missing, 'run pnpm docs:architecture to render').toEqual([]);
  });

  it('embeds every rendered diagram from the README or the module map', () => {
    const text = ['README.md', 'modules.md']
      .map((f) => readFileSync(join(ROOT, 'docs', 'architecture', f), 'utf8'))
      .join('\n');
    for (const source of sources) {
      expect(text, `${source} is rendered but not embedded`).toContain(
        `render/${source.replace(/\.mmd$/, '.png')}`,
      );
    }
  });
});
