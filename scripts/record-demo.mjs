#!/usr/bin/env node
/**
 * Records a deterministic bot run to an MP4.
 *
 *   node scripts/record-demo.mjs [--seed 7] [--seconds 45] [--fps 30] [--out demo.mp4]
 *
 * The page is opened with `?record&bot&seed=N`, which installs `window.ringfallCapture`.
 * Each call to `advance(steps)` runs exactly `steps` simulation ticks (1/60 s each) and renders
 * once, so frames are pulled at whatever speed the GPU allows and reassembled at the target rate.
 * Requires a production build (`pnpm build`) and the Playwright-bundled ffmpeg.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { parseArgs, requireSeed } from './lib/args.mjs';

const args = parseArgs(
  process.argv.slice(2),
  new Set(['seed', 'seconds', 'fps', 'width', 'height', 'out']),
);
const seed = requireSeed(args.seed);
const seconds = Number(args.seconds ?? 45);
const fps = Number(args.fps ?? 30);
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 720);
const out = resolve(args.out ?? 'demo.mp4');
const port = 4175;
const framesDir = resolve('.record-frames');
const stepsPerFrame = Math.round(60 / fps);
const totalFrames = seconds * fps;

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const server = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port)],
  {
    stdio: 'ignore',
  },
);
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`http://127.0.0.1:${port}/?record&bot&seed=${seed}`);
await page.waitForFunction(() => Boolean(window.ringfallCapture));
// A few title frames first so the cut opens on the wordmark.
const titleFrames = fps;
for (let i = 0; i < titleFrames; i += 1) {
  const data = await page.screenshot({ type: 'jpeg', quality: 90 });
  writeFileSync(`${framesDir}/f${String(i).padStart(5, '0')}.jpg`, data);
}
await page.evaluate(() => window.ringfallCapture.start());
await page.waitForTimeout(300);
const started = Date.now();
for (let i = 0; i < totalFrames; i += 1) {
  await page.evaluate(({ steps }) => window.ringfallCapture.advance(steps), {
    steps: stepsPerFrame,
  });
  // The HUD lives in the DOM, so a page screenshot composites canvas and HUD in one go.
  const shot = await page.screenshot({ type: 'jpeg', quality: 90 });
  writeFileSync(`${framesDir}/f${String(titleFrames + i).padStart(5, '0')}.jpg`, shot);
  if (i % fps === 0) {
    const status = await page.evaluate(() => {
      const s = window.ringfall.state();
      return `t=${s.time.toFixed(1)} wave=${s.wave.number}/${s.wave.phase} enemies=${s.enemies.length} shield=${Math.round(s.player.vitality.shield)} hp=${s.player.vitality.health} kills=${s.kills} status=${s.status}`;
    });
    console.log(
      `frame ${i}/${totalFrames} ${status} (${((Date.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
}
await browser.close();
server.kill();

const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const result = spawnSync(
  ffmpeg,
  [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    `${framesDir}/f%05d.jpg`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    out,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) {
  console.error('ffmpeg failed');
  process.exit(1);
}
console.log(`wrote ${out}`);
