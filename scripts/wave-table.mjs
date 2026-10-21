#!/usr/bin/env node
/**
 * Renders the wave composition table in docs/design-doc.md from `WAVE_BEATS`, so the document
 * is generated from the constants rather than retyped.
 *
 *   node scripts/wave-table.mjs            prints the table
 *   node scripts/wave-table.mjs --write    rewrites the block between the markers in the doc
 *   node scripts/wave-table.mjs --check    exits 1 when the doc's block is out of date
 *
 * Node 22.18+ strips the types of `src/core/waves.ts` on import; the module has no runtime deps.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMOURED_HEALTH_SCALE, DROP_POD_LEAD, WAVE_BEATS } from '../src/core/waves.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docPath = resolve(root, 'docs/design-doc.md');
const START = '<!-- wave-table:start -->';
const END = '<!-- wave-table:end -->';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Prose for whatever a beat does beyond lining up its roster. */
const notes = (beat) => {
  const out = [];
  const late = beat.spawns.filter((s) => s.delay > 0);
  for (const delay of [...new Set(late.map((s) => s.delay))]) {
    const group = late.filter((s) => s.delay === delay);
    const kinds = [...new Set(group.map((s) => s.kind))].map((k) =>
      plural(group.filter((s) => s.kind === k).length, k),
    );
    out.push(`${kinds.join(' and ')} ${group.length === 1 ? 'lands' : 'land'} ${delay} s late`);
  }
  const armoured = beat.spawns.filter((s) => s.healthScale !== 1);
  for (const scale of [...new Set(armoured.map((s) => s.healthScale))]) {
    const group = armoured.filter((s) => s.healthScale === scale);
    const kinds = [...new Set(group.map((s) => s.kind))].map((k) =>
      plural(group.filter((s) => s.kind === k).length, `armoured ${k}`),
    );
    out.push(`${kinds.join(' and ')} at ${scale}x health`);
  }
  if (beat.ending === 'leaderDown') out.push('ends when the leader falls; the survivors flee');
  return out.join('; ');
};

export const renderWaveTable = (beats = WAVE_BEATS) => {
  const rows = beats.map((beat, i) => [
    String(i + 1),
    beat.name,
    String(beat.spawns.filter((s) => s.kind === 'skimmer').length),
    String(beat.spawns.filter((s) => s.kind === 'strider').length),
    notes(beat),
  ]);
  const header = ['Wave', 'Name', 'Skimmers', 'Striders', 'Notes'];
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const line = (cells) => `| ${cells.map((cell, c) => cell.padEnd(widths[c])).join(' | ')} |`;
  const rule = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(header), rule, ...rows.map(line)].join('\n');
};

const totals = (beats = WAVE_BEATS) => {
  const all = beats.flatMap((b) => b.spawns);
  return {
    skimmers: all.filter((s) => s.kind === 'skimmer').length,
    striders: all.filter((s) => s.kind === 'strider').length,
  };
};

/** The whole generated block: table plus the sentence that depends on the same constants. */
export const renderBlock = (beats = WAVE_BEATS) => {
  const { skimmers, striders } = totals(beats);
  return [
    `${START}`,
    '',
    renderWaveTable(beats),
    '',
    `Every enemy arrives by drop pod: the \`dropPod\` event fires ${DROP_POD_LEAD} s before the`,
    `enemy goes active. Chapter 1 fields ${skimmers} skimmers and ${striders} striders in all;`,
    `the armoured strider has ${ARMOURED_HEALTH_SCALE}x the archetype's health.`,
    '',
    `${END}`,
  ].join('\n');
};

const replaceBlock = (doc, block) => {
  const start = doc.indexOf(START);
  const end = doc.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`markers ${START} and ${END} not found in ${docPath}`);
  }
  return `${doc.slice(0, start)}${block}${doc.slice(end + END.length)}`;
};

const main = () => {
  const args = new Set(process.argv.slice(2));
  const block = renderBlock();
  if (!args.has('--write') && !args.has('--check')) {
    console.log(block);
    return;
  }
  const doc = readFileSync(docPath, 'utf8');
  const next = replaceBlock(doc, block);
  if (args.has('--check')) {
    if (next !== doc) {
      console.error(
        `docs/design-doc.md wave table is stale; run: node scripts/wave-table.mjs --write`,
      );
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(docPath, next);
  console.log(`wrote wave table to ${docPath}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
