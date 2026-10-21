#!/usr/bin/env node
/**
 * Renders the soundtrack for a seeded run and muxes it into a silent demo MP4.
 *
 *   node scripts/render-score.mjs --seed 7 --seconds 40 --lead-in 1 --video demo.mp4 --out demo-scored.mp4
 *
 * The page re-runs the deterministic simulation headlessly to recover the event timeline and
 * schedules every sound into an OfflineAudioContext, so the audio lines up with the frames
 * that scripts/record-demo.mjs captured for the same seed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { parseArgs, requireSeed } from './lib/args.mjs';
import { startPreview } from './lib/preview.mjs';

const args = parseArgs(
  process.argv.slice(2),
  new Set(['seed', 'seconds', 'lead-in', 'video', 'out']),
);
const seed = requireSeed(args.seed);
const seconds = Number(args.seconds ?? 40);
const leadIn = Number(args['lead-in'] ?? 1);
const video = resolve(args.video ?? 'demo.mp4');
const out = resolve(args.out ?? 'demo-scored.mp4');
// The rendered WAV is an intermediate: it lives in a temporary directory, not the working tree.
const scratch = mkdtempSync(join(tmpdir(), 'ringfall-score-'));
const wav = join(scratch, 'score.wav');
const port = 4176;

try {
  const server = await startPreview(port);
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    await page.goto(`http://127.0.0.1:${port}/?record&bot&seed=${seed}`);
    await page.waitForFunction(() => Boolean(window.ringfallCapture));
    const base64 = await page.evaluate(
      ({ seconds, leadIn }) => window.ringfallCapture.score(seconds, leadIn),
      { seconds, leadIn },
    );
    writeFileSync(wav, Buffer.from(base64, 'base64'));
  } finally {
    await browser.close();
    server.kill();
  }

  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  const result = spawnSync(
    ffmpeg,
    ['-y', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error('ffmpeg failed');
    process.exit(1);
  }
  console.log(`wrote ${out}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
