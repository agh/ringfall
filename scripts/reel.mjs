#!/usr/bin/env node
/**
 * Cuts the Ringfall demo reel: title cards, wave 1 by day, wave 2 by night, outro.
 *
 *   node scripts/reel.mjs [--seed 7] [--port 4181] [--fps 30] [--wave1-seconds 15]
 *     [--wave2-seconds 17] [--night atmo=night] [--dist dist] [--work node_modules/.cache/ringfall-reel]
 *     [--steps cards,wave1,wave2,score,stitch] [--force] [--out ringfall-reel.mp4]
 *
 * Steps are cached in the work directory so a long capture is never repeated by accident:
 *   cards   renders scripts/reel-cards/*.html at the target fps by seeking their CSS animations
 *   wave1   captures the seeded bot run from t=0 through wave 1 (`?record&bot&seed=N`)
 *   wave2   advances the same run without screenshots until wave 2 is active, then captures it,
 *           with the `--night` query flag appended so the environment is forced to night
 *   score   renders the offline score three times: drone only, the wave 1 run, the full run
 *   stitch  encodes each segment and joins them with xfade and acrossfade
 * Needs a production build (`pnpm build`) and a full ffmpeg (`FFMPEG=/path/to/ffmpeg`); the
 * Playwright-bundled one has no H.264, JPEG or AAC. See docs/runbook.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { parseArgs, requireSeed } from './lib/args.mjs';
import { startPreview } from './lib/preview.mjs';

const args = parseArgs(process.argv.slice(2));
const seed = requireSeed(args.seed);
const port = Number(args.port ?? 4181);
const fps = Number(args.fps ?? 30);
const width = 1280;
const height = 720;
const wave1Seconds = Number(args['wave1-seconds'] ?? 15);
const wave2Seconds = Number(args['wave2-seconds'] ?? 17);
const crossfade = Number(args.crossfade ?? 0.5);
const night = args.night === 'none' ? '' : (args.night ?? 'atmo=night');
// `--no-night` drops the wave 2 intertitle and segment: a day-only cut while that capture runs.
const noNight = args['no-night'] === 'true';
const dist = resolve(args.dist ?? 'dist');
const work = resolve(args.work ?? 'node_modules/.cache/ringfall-reel');
const out = resolve(args.out ?? 'ringfall-reel.mp4');
const webOut = resolve(args.web ?? out.replace(/\.mp4$/, '-web.mp4'));
const force = args.force === 'true';
const steps = new Set((args.steps ?? 'cards,wave1,wave2,score,stitch').split(','));
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const cardsDir = resolve(dirname(fileURLToPath(import.meta.url)), 'reel-cards');

if (60 % fps !== 0) {
  console.error(`fps must divide 60; ${fps} does not`);
  process.exit(1);
}
const stepsPerFrame = 60 / fps;

/**
 * The cut, in order. Card durations are what each one needs to be read; gameplay durations come
 * from the flags. Audio names the source each segment draws from: the choir drone under cards,
 * and the two score renders under play.
 */
const cut = [
  { id: 'title', kind: 'card', file: '01-title.html', seconds: 6, audio: 'drone' },
  { id: 'story', kind: 'card', file: '02-story.html', seconds: 10, audio: 'drone' },
  { id: 'approach-1', kind: 'card', file: '03-approach-1.html', seconds: 8.5, audio: 'drone' },
  { id: 'approach-2', kind: 'card', file: '04-approach-2.html', seconds: 8.5, audio: 'drone' },
  { id: 'wave-1-card', kind: 'card', file: '05-wave-1.html', seconds: 2.5, audio: 'drone' },
  { id: 'wave1', kind: 'play', seconds: wave1Seconds, audio: 'wave1' },
  { id: 'wave-2-card', kind: 'card', file: '06-wave-2.html', seconds: 2.5, audio: 'drone' },
  { id: 'wave2', kind: 'play', seconds: wave2Seconds, audio: 'wave2' },
  { id: 'outro', kind: 'card', file: '07-outro.html', seconds: 9, audio: 'drone' },
].filter((s) => !(noNight && (s.id === 'wave-2-card' || s.id === 'wave2')));
const hasWave2 = cut.some((s) => s.id === 'wave2');
const audioNames = [...new Set(cut.map((s) => s.audio))];
const totalSeconds = cut.reduce((sum, s) => sum + s.seconds, 0) - crossfade * (cut.length - 1);

const framesDir = (id) => resolve(work, 'frames', id);
const segmentFile = (id) => resolve(work, `seg-${id}.mp4`);
const wavFile = (name) => resolve(work, `${name}.wav`);
const metaFile = (id) => resolve(framesDir(id), 'meta.json');
const frameName = (i) => `f${String(i).padStart(5, '0')}.jpg`;
const done = (id) => existsSync(metaFile(id)) && !force;

mkdirSync(work, { recursive: true });

const launch = () =>
  chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });

const gameUrl = (flags) => `http://127.0.0.1:${port}/?record&bot&seed=${seed}${flags}`;

const statusLine = (page) =>
  page.evaluate(() => {
    const s = window.ringfall.state();
    return `t=${s.time.toFixed(1)} wave=${s.wave.number}/${s.wave.phase} enemies=${s.enemies.length} shield=${Math.round(s.player.vitality.shield)} hp=${s.player.vitality.health} kills=${s.kills} status=${s.status}`;
  });

// Cards ------------------------------------------------------------------------------------------

/**
 * Renders one card. Every CSS animation on the page is paused and seeked to the frame's time, so
 * the capture is deterministic however slow the machine is.
 */
const renderCard = async (browser, segment) => {
  const dir = framesDir(segment.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(pathToFileURL(resolve(cardsDir, segment.file)).href);
  await page.evaluate(() => document.fonts.ready);
  const frames = Math.round(segment.seconds * fps);
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate(
      (ms) => {
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = ms;
        }
      },
      (i / fps) * 1000,
    );
    writeFileSync(`${dir}/${frameName(i)}`, await page.screenshot({ type: 'jpeg', quality: 92 }));
  }
  await page.close();
  writeFileSync(metaFile(segment.id), JSON.stringify({ frames, fps }));
  console.log(`card ${segment.id}: ${frames} frames`);
};

// Gameplay ---------------------------------------------------------------------------------------

/**
 * Captures a run. With `skipUntil`, the simulation is advanced without screenshots until the
 * predicate holds, coarsely by half seconds and then tick by tick, so a later wave is reached in
 * minutes rather than the hour the full capture would take on a software GPU.
 */
const capturePlay = async (browser, segment, flags, skipUntil) => {
  const dir = framesDir(segment.id);
  if (force) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // A browser that died mid-capture leaves frames behind; the run is deterministic, so the
  // simulation is replayed to the last frame on disk and the capture resumes there. That last
  // frame is retaken: a crash mid-write leaves a truncated file that counts like a whole one.
  const resumeFrom = Math.max(0, readdirSync(dir).filter((f) => f.endsWith('.jpg')).length - 1);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(gameUrl(flags));
  await page.waitForFunction(() => Boolean(window.ringfallCapture));
  await page.evaluate(() => window.ringfallCapture.start());
  await page.waitForTimeout(300);
  const advance = (ticks) =>
    page.evaluate((n) => {
      window.ringfallCapture.advance(n);
      const s = window.ringfall.state();
      return { time: s.time, wave: s.wave.number, phase: s.wave.phase, status: s.status };
    }, ticks);
  let state = await advance(0);
  if (skipUntil) {
    const started = Date.now();
    while (!skipUntil(state) && state.status === 'playing') {
      // Coarse until the wave number is right, then fine so the capture opens on the first tick.
      state = await advance(state.wave < skipUntil.wave ? 30 : 6);
    }
    console.log(
      `skipped to t=${state.time.toFixed(2)} wave=${state.wave}/${state.phase} (${((Date.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
  const simStart = state.time;
  const frames = Math.round(segment.seconds * fps);
  const started = Date.now();
  if (resumeFrom > 0) {
    for (let left = resumeFrom * stepsPerFrame; left > 0; left -= 60)
      await advance(Math.min(60, left));
    console.log(`${segment.id}: resuming at frame ${resumeFrom}`);
  }
  for (let i = resumeFrom; i < frames; i += 1) {
    await advance(stepsPerFrame);
    // The HUD lives in the DOM, so a page screenshot composites canvas and HUD in one go.
    writeFileSync(`${dir}/${frameName(i)}`, await page.screenshot({ type: 'jpeg', quality: 90 }));
    if (i % fps === 0) {
      console.log(
        `${segment.id} frame ${i}/${frames} ${await statusLine(page)} (${((Date.now() - started) / 1000).toFixed(0)}s)`,
      );
    }
  }
  const simEnd = (await advance(0)).time;
  await page.close();
  writeFileSync(
    metaFile(segment.id),
    JSON.stringify({ frames, fps, simStart, simEnd, url: gameUrl(flags) }),
  );
  console.log(
    `${segment.id}: ${frames} frames, sim ${simStart.toFixed(2)}s to ${simEnd.toFixed(2)}s`,
  );
};

// Score ------------------------------------------------------------------------------------------

/**
 * Three renders of the offline score. The drone is the lead-in with no game in it, so a long
 * lead-in and a token run gives the choir alone; the wave 2 run is rendered from t=0 so its
 * timeline matches the capture, and trimmed at stitch time.
 */
const renderScores = async (browser) => {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(gameUrl(''));
  await page.waitForFunction(() => Boolean(window.ringfallCapture));
  const render = async (name, seconds, leadIn) => {
    const base64 = await page.evaluate(
      ({ seconds, leadIn }) => window.ringfallCapture.score(seconds, leadIn),
      { seconds, leadIn },
    );
    writeFileSync(wavFile(name), Buffer.from(base64, 'base64'));
    console.log(`score ${name}: ${(seconds + leadIn).toFixed(1)}s`);
  };
  await render('drone', 0.5, Math.ceil(totalSeconds) + 2);
  await render('wave1', wave1Seconds + 1, 0);
  if (hasWave2) {
    const wave2 = JSON.parse(readFileSync(metaFile('wave2'), 'utf8'));
    await render('wave2', Math.ceil(wave2.simEnd) + 1, 0);
  }
  await page.close();
};

// Stitch -----------------------------------------------------------------------------------------

const run = (argv) => {
  const result = spawnSync(ffmpeg, argv, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`ffmpeg failed: ${argv.join(' ')}`);
    process.exit(1);
  }
};

/** Encodes one segment's frames into an intermediate at the exact frame count. */
const encodeSegment = (segment) => {
  const meta = JSON.parse(readFileSync(metaFile(segment.id), 'utf8'));
  const have = readdirSync(framesDir(segment.id)).filter((f) => f.endsWith('.jpg')).length;
  if (have !== meta.frames)
    throw new Error(`${segment.id}: ${have} frames on disk, ${meta.frames} expected`);
  run([
    '-y',
    '-framerate',
    String(fps),
    '-i',
    `${framesDir(segment.id)}/f%05d.jpg`,
    '-frames:v',
    String(meta.frames),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '12',
    '-pix_fmt',
    'yuv420p',
    segmentFile(segment.id),
  ]);
  return meta.frames / fps;
};

const stitch = () => {
  const durations = cut.map(encodeSegment);
  const wave2 = hasWave2 ? JSON.parse(readFileSync(metaFile('wave2'), 'utf8')) : { simStart: 0 };
  // Timeline start of each segment once crossfades overlap them.
  const starts = durations.map(
    (_, k) => durations.slice(0, k).reduce((sum, d) => sum + d, 0) - k * crossfade,
  );
  const total = starts[cut.length - 1] + durations[cut.length - 1];
  const inputs = cut.flatMap((s) => ['-i', segmentFile(s.id)]);
  const audioIndex = Object.fromEntries(audioNames.map((name, i) => [name, cut.length + i]));
  for (const name of audioNames) inputs.push('-i', wavFile(name));

  const filters = [];
  cut.forEach((s, k) => {
    const fadeIn = k === 0 ? `,fade=t=in:d=0.8` : '';
    const fadeOut = k === cut.length - 1 ? `,fade=t=out:st=${durations[k] - 1}:d=1` : '';
    filters.push(`[${k}:v]fps=${fps},settb=AVTB,format=yuv420p${fadeIn}${fadeOut}[v${k}]`);
    // Drone slices are cut at their timeline position, so the overlapping crossfades of identical
    // audio sum back to one continuous choir. Wave 2 is trimmed to where its capture began.
    const from = s.audio === 'drone' ? starts[k] : s.audio === 'wave2' ? wave2.simStart : 0;
    filters.push(
      `[${audioIndex[s.audio]}:a]atrim=start=${from.toFixed(3)}:duration=${durations[k].toFixed(3)},asetpts=PTS-STARTPTS[a${k}]`,
    );
  });
  let v = 'v0';
  let a = 'a0';
  for (let k = 1; k < cut.length; k += 1) {
    const offset = (starts[k - 1] + durations[k - 1] - crossfade).toFixed(3);
    filters.push(
      `[${v}][v${k}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[vx${k}]`,
    );
    filters.push(`[${a}][a${k}]acrossfade=d=${crossfade}:c1=tri:c2=tri[ax${k}]`);
    v = `vx${k}`;
    a = `ax${k}`;
  }
  filters.push(`[${a}]afade=t=in:d=1,afade=t=out:st=${(total - 2).toFixed(3)}:d=2[aout]`);
  run([
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${v}]`,
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    out,
  ]);
  run([
    '-y',
    '-i',
    out,
    '-c:v',
    'libx264',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    webOut,
  ]);
  console.log(`wrote ${out} and ${webOut}`);
  console.log('segment  start   end     source');
  cut.forEach((s, k) => {
    const source =
      s.kind === 'card'
        ? `scripts/reel-cards/${s.file}`
        : JSON.parse(readFileSync(metaFile(s.id), 'utf8')).url;
    console.log(
      `${s.id.padEnd(12)} ${starts[k].toFixed(1).padStart(5)}  ${(starts[k] + durations[k]).toFixed(1).padStart(5)}   ${source}`,
    );
  });
  console.log(`total ${total.toFixed(1)}s`);
};

// Main -------------------------------------------------------------------------------------------

const needsGame = ['wave1', 'wave2', 'score'].some((s) => steps.has(s));
// Browser first: Playwright reaps it when the process dies, nothing reaps the preview server.
const browser = await launch();
const server = needsGame ? await startPreview(port, { outDir: dist }) : null;
try {
  if (steps.has('cards')) {
    for (const s of cut) if (s.kind === 'card' && !done(s.id)) await renderCard(browser, s);
  }
  const wave1 = cut.find((s) => s.id === 'wave1');
  const wave2 = cut.find((s) => s.id === 'wave2');
  if (steps.has('wave1') && !done('wave1')) await capturePlay(browser, wave1, '', null);
  if (steps.has('wave2') && hasWave2 && !done('wave2')) {
    const flags = night ? `&${night}` : '';
    const untilWave2 = (s) => s.wave >= 2 && s.phase === 'active';
    untilWave2.wave = 2;
    await capturePlay(browser, wave2, flags, untilWave2);
  }
  if (steps.has('score') && (force || !audioNames.every((n) => existsSync(wavFile(n))))) {
    await renderScores(browser);
  }
} finally {
  await browser.close();
  server?.kill();
}
if (steps.has('stitch')) stitch();
