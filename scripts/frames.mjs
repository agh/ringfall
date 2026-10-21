#!/usr/bin/env node
/**
 * Luminance gate: captures a fixed set of frames from the built site and fails when one is
 * washed out.
 *
 *   node scripts/frames.mjs [--seed 7] [--fps 60] [--port 4177] [--lead-seconds 1]
 *     [--out node_modules/.cache/ringfall-frames] [--only day-3,night-10] [--no-gate]
 *
 * The frames in FRAME_SET that share query flags are captured from one page, in order of time,
 * through the `?record&bot&seed=N` hook: the simulation is advanced in chunks of 60 ticks until
 * `--lead-seconds` before each moment, then one rendered frame per `60 / fps` ticks so the
 * renderer's per-frame decays settle before the screenshot. Pages are captured one after another:
 * software GL already uses every core, so parallel pages only share the same throughput. The page
 * screenshot (canvas plus DOM HUD) is decoded here, box-filtered to 64x36, and measured: mean and
 * max luminance (Rec. 709, 0..255) and the largest 4-connected blob of saturated cells as a
 * fraction of the frame. Frames land in the output directory as PNG files next to `report.json`.
 * Needs a production build (`pnpm build`); runs on software GL (SwiftShader), as CI does.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    const next = all[i + 1];
    if (arg.startsWith('--'))
      pairs.push([arg.slice(2), next?.startsWith('--') ? 'true' : (next ?? 'true')]);
    return pairs;
  }, []),
);
const seed = Number(args.seed ?? 7);
const fps = Number(args.fps ?? 60);
const port = Number(args.port ?? 4177);
const leadSeconds = Number(args['lead-seconds'] ?? 1);
const out = resolve(args.out ?? 'node_modules/.cache/ringfall-frames');
const only = args.only ? new Set(args.only.split(',')) : null;
const gate = args['no-gate'] !== 'true';
const width = 1280;
const height = 720;
const COLS = 64;
const ROWS = 36;

if (!Number.isInteger(fps) || fps <= 0 || 60 % fps !== 0) {
  console.error(`fps must divide 60; ${args.fps} does not`);
  process.exit(1);
}
const ticksPerFrame = 60 / fps;

/**
 * Budgets: 0..255 for the mean of the 64x36 downscale, and a fraction of the frame for the largest
 * saturated blob. They are the whiteout lines from issue #30 (day 150, night 110, blob 8 %), set
 * against the frames measured at commit 8566f27, the commit this gate branched from, and not
 * raised until the gate passed. Measured there, mean / max / blob, two runs where noted:
 *   day-3 126.7 / 254.6 / 4.17 % (second run 128.7 / 254.6 / 4.21 %)
 *   day-10 104.9 / 255.0 / 0.35 %     day-18 23.4 / 188.6 / 0 %     day-45 61.2 / 235.2 / 0 %
 *   day-48 154.2 / 254.9 / 0.48 % (second run 154.8): OVER the day budget, a shield-down flash
 *   night-8.5 10.2 / 194.2 / 0 %      night-10 61.7 / 255.0 / 0.56 %   night-18 14.2 / 183.6 / 0 %
 *   dusk-rain-10 120.4 / 255.0 / 3.78 %           night-fog-10 58.0 / 255.0 / 0.56 %
 * Run-to-run drift on software GL was about 2 of 255 on the mean; keep budgets clear of it.
 */
const BUDGET = {
  mean: { day: 150, night: 110 },
  blob: 0.08,
};
/** A downscaled cell whose luminance is at or above this is saturated. */
const SATURATED = 250;

/**
 * The frame set: seed 7, ten moments across the atmospheres. `t` is simulation time in seconds;
 * `budget` names the mean budget that applies (dusk is lit like day).
 */
const FRAME_SET = [
  { id: 'day-3', flags: '&post', t: 3, budget: 'day' },
  { id: 'day-10', flags: '&post', t: 10, budget: 'day' },
  { id: 'day-18', flags: '&post', t: 18, budget: 'day' },
  { id: 'day-45', flags: '&post', t: 45, budget: 'day' },
  { id: 'day-48', flags: '&post', t: 48, budget: 'day' },
  { id: 'night-8.5', flags: '&post&atmo=night', t: 8.5, budget: 'night' },
  { id: 'night-10', flags: '&post&atmo=night', t: 10, budget: 'night' },
  { id: 'night-18', flags: '&post&atmo=night', t: 18, budget: 'night' },
  { id: 'dusk-rain-10', flags: '&post&atmo=dusk&weather=rain', t: 10, budget: 'day' },
  { id: 'night-fog-10', flags: '&post&atmo=night&weather=fog', t: 10, budget: 'night' },
];

// PNG --------------------------------------------------------------------------------------------

/** Reads the IHDR and concatenated IDAT of a PNG. */
const readPngChunks = (buf) => {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (!header) throw new Error('PNG without IHDR');
  return { header, idat: Buffer.concat(idat) };
};

/** The PNG filter predictor for one byte, given its left, up, and up-left neighbours. */
const predict = (filter, a, b, c) => {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4: {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      return pb <= pc ? b : c;
    }
    default:
      throw new Error(`bad PNG filter ${filter}`);
  }
};

/** Reverses one scanline's filter in place, given the previous unfiltered line. */
const unfilterLine = (filter, src, prev, line, channels) => {
  for (let i = 0; i < src.length; i += 1) {
    const a = i >= channels ? line[i - channels] : 0;
    const c = i >= channels ? prev[i - channels] : 0;
    line[i] = (src[i] + predict(filter, a, prev[i], c)) & 0xff;
  }
};

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what Playwright writes) to raw RGBA. */
const decodePng = (buf) => {
  const { header, idat } = readPngChunks(buf);
  const { width: w, height: h, depth, colour, interlace } = header;
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0)
    throw new Error(`unsupported PNG: depth ${depth} colour ${colour} interlace ${interlace}`);
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(idat);
  const stride = w * channels;
  const pixels = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    unfilterLine(filter, src, prev, line, channels);
    for (let x = 0; x < w; x += 1) {
      pixels[(y * w + x) * 4] = line[x * channels];
      pixels[(y * w + x) * 4 + 1] = line[x * channels + 1];
      pixels[(y * w + x) * 4 + 2] = line[x * channels + 2];
      pixels[(y * w + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev.set(line);
  }
  return { width: w, height: h, pixels };
};

// Measurement ------------------------------------------------------------------------------------

/** Box-filters the image to COLS x ROWS cells and returns each cell's Rec. 709 luminance. */
const downscaleLuminance = (image) => {
  const cells = new Float64Array(COLS * ROWS);
  const cw = image.width / COLS;
  const ch = image.height / ROWS;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x0 = Math.floor(col * cw);
      const x1 = Math.floor((col + 1) * cw);
      const y0 = Math.floor(row * ch);
      const y1 = Math.floor((row + 1) * ch);
      let sum = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * image.width + x) * 4;
          sum +=
            0.2126 * image.pixels[i] + 0.7152 * image.pixels[i + 1] + 0.0722 * image.pixels[i + 2];
        }
      }
      cells[row * COLS + col] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return cells;
};

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Size of the 4-connected saturated region containing `start`, marking it in `seen`. */
const floodFill = (cells, seen, start) => {
  const stack = [start];
  seen[start] = 1;
  let size = 0;
  while (stack.length > 0) {
    const i = stack.pop();
    size += 1;
    const col = i % COLS;
    const row = (i - col) / COLS;
    for (const [dc, dr] of NEIGHBOURS) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const j = r * COLS + c;
      if (!seen[j] && cells[j] >= SATURATED) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return size;
};

/** Largest 4-connected run of saturated cells, as a fraction of all cells. */
const largestSaturatedBlob = (cells) => {
  const seen = new Uint8Array(cells.length);
  let largest = 0;
  for (let start = 0; start < cells.length; start += 1) {
    if (!seen[start] && cells[start] >= SATURATED)
      largest = Math.max(largest, floodFill(cells, seen, start));
  }
  return largest / cells.length;
};

const measure = (png) => {
  const cells = downscaleLuminance(decodePng(png));
  let sum = 0;
  let max = 0;
  for (const v of cells) {
    sum += v;
    max = Math.max(max, v);
  }
  return { mean: sum / cells.length, max, blob: largestSaturatedBlob(cells) };
};

// Capture ----------------------------------------------------------------------------------------

/** Serves the production build on its own port so a concurrent recorder is not disturbed. */
const startPreview = async () => {
  const server = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: 'ignore' },
  );
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(url);
      if (res.ok) return server;
    } catch {
      // Not up yet.
    }
  }
  server.kill();
  throw new Error(`vite preview did not come up on ${url}`);
};

const gameUrl = (flags) => `http://127.0.0.1:${port}/?record&bot&seed=${seed}${flags}`;

/** One rendered frame at the end of `ticks` simulation ticks, with the state reached. */
const advance = (page, ticks) =>
  page.evaluate((n) => {
    window.ringfallCapture.advance(n);
    const s = window.ringfall.state();
    return { time: s.time, wave: s.wave.number, status: s.status };
  }, ticks);

/** Advances to `t`: coarse until the lead-in, then one rendered frame per `ticksPerFrame`. */
const advanceTo = async (page, state, t) => {
  const half = 1e-6;
  let s = state;
  while (s.time + half < t - leadSeconds && s.status === 'playing') {
    const remaining = Math.round((t - leadSeconds - s.time) * 60);
    s = await advance(page, Math.min(60, Math.max(1, remaining)));
  }
  while (s.time + half < t && s.status === 'playing') s = await advance(page, ticksPerFrame);
  return s;
};

/**
 * Captures every frame that shares one set of query flags from a single page, in order of time,
 * so the replay from t = 0 is paid once per atmosphere. Returns one result per frame with the
 * measurement and the simulation time actually reached.
 */
const captureGroup = async (browser, flags, group) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`${flags}: ${e.message}`));
  await page.goto(gameUrl(flags), { timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.ringfallCapture), null, { timeout: 120_000 });
  await page.evaluate(() => window.ringfallCapture.start());
  await page.waitForTimeout(300);
  const results = [];
  let state = await advance(page, 0);
  for (const frame of [...group].sort((a, b) => a.t - b.t)) {
    const started = Date.now();
    state = await advanceTo(page, state, frame.t);
    const png = await page.screenshot({ type: 'png' });
    const file = `${frame.id}.png`;
    writeFileSync(resolve(out, file), png);
    const m = measure(png);
    const result = {
      id: frame.id,
      url: gameUrl(flags),
      t: frame.t,
      simTime: Number(state.time.toFixed(4)),
      wave: state.wave,
      status: state.status,
      file,
      mean: Number(m.mean.toFixed(2)),
      max: Number(m.max.toFixed(2)),
      blob: Number(m.blob.toFixed(4)),
      budget: { mean: BUDGET.mean[frame.budget], blob: BUDGET.blob },
    };
    result.pass = result.mean <= result.budget.mean && result.blob <= result.budget.blob;
    results.push(result);
    console.log(
      `${frame.id.padEnd(13)} t=${result.simTime.toFixed(2).padStart(6)} mean=${result.mean.toFixed(1).padStart(6)} max=${result.max.toFixed(1).padStart(6)} blob=${(result.blob * 100).toFixed(2).padStart(6)}% ${result.pass ? 'ok' : 'OVER'} (${((Date.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
  await page.close();
  return { results, pageErrors };
};

// Main -------------------------------------------------------------------------------------------

const selected = FRAME_SET.filter((f) => !only || only.has(f.id));
if (selected.length === 0) {
  console.error(`no frames selected; ids are ${FRAME_SET.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Not a checkout.
}

const server = await startPreview();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const frames = [];
const pageErrors = [];
const started = Date.now();
try {
  const groups = new Map();
  for (const f of selected) groups.set(f.flags, [...(groups.get(f.flags) ?? []), f]);
  for (const [flags, group] of groups) {
    const captured = await captureGroup(browser, flags, group);
    frames.push(...captured.results);
    pageErrors.push(...captured.pageErrors);
  }
} finally {
  await browser.close();
  server.kill();
}

const report = {
  commit,
  seed,
  fps,
  leadSeconds,
  viewport: { width, height },
  downscale: { cols: COLS, rows: ROWS },
  saturated: SATURATED,
  budget: BUDGET,
  pageErrors,
  frames,
  pass: frames.every((f) => f.pass) && pageErrors.length === 0,
};
writeFileSync(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log('');
console.log('| Frame | t (s) | Mean | Max | Blob | Mean budget | Result |');
console.log('| ----- | ----- | ---- | --- | ---- | ----------- | ------ |');
for (const f of frames) {
  console.log(
    `| ${f.id} | ${f.simTime.toFixed(2)} | ${f.mean.toFixed(1)} | ${f.max.toFixed(1)} | ${(f.blob * 100).toFixed(2)}% | ${f.budget.mean} | ${f.pass ? 'pass' : 'FAIL'} |`,
  );
}
console.log(
  `\n${frames.length} frames at commit ${commit}, ${((Date.now() - started) / 1000).toFixed(0)}s; wrote ${out}/report.json`,
);
for (const e of pageErrors) console.error(`pageerror ${e}`);
if (gate && !report.pass) {
  console.error('luminance gate failed');
  process.exit(1);
}
