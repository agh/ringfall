import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { runFfmpeg } from "./media-tools.mjs";

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export function captureUrl(source, seed) {
  const url = new URL(source);
  url.searchParams.set("record", "");
  url.searchParams.set("bot", "");
  url.searchParams.set("seed", String(seed));
  return url.href;
}

function requiredInteger(value, name, min = 1) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}.`);
  }
  return parsed;
}

function eventsFromResult(result, frameIndex) {
  const events = Array.isArray(result) ? result : result?.events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object" || typeof event.type !== "string") return [];
    const timeSeconds = typeof event.timeSeconds === "number"
      ? event.timeSeconds
      : typeof event.time === "number"
        ? event.time
        : frameIndex / FPS;
    return [{ ...event, timeSeconds }];
  });
}

export async function recordDemo({
  url = process.env.RINGFALL_URL ?? "http://localhost:4173/",
  seed = requiredInteger(process.env.DEMO_SEED ?? "1", "DEMO_SEED", 0),
  seconds = requiredInteger(process.env.DEMO_SECONDS ?? "60", "DEMO_SECONDS"),
  outputDirectory = process.env.DEMO_OUTPUT_DIR ?? "artifacts/demo",
} = {}) {
  if (seconds < 45 || seconds > 60) {
    throw new Error("DEMO_SECONDS must be between 45 and 60.");
  }
  const frameCount = seconds * FPS;
  const output = path.resolve(outputDirectory);
  const framesDirectory = path.join(output, "frames");
  await mkdir(framesDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.goto(captureUrl(url, seed), { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.ringfallCapture === "function");
    await page.evaluate(() => document.fonts?.ready);

    const events = [];
    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameResult = await page.evaluate(() => window.ringfallCapture());
      events.push(...eventsFromResult(frameResult, frame));
      const filename = path.join(framesDirectory, `frame-${String(frame).padStart(6, "0")}.jpg`);
      await page.screenshot({ path: filename, type: "jpeg", quality: 90 });
    }

    await writeFile(path.join(output, "events.json"), `${JSON.stringify({
      fps: FPS,
      seconds,
      seed,
      events,
    }, null, 2)}\n`);

    runFfmpeg([
      "-y",
      "-framerate", String(FPS),
      "-i", path.join(framesDirectory, "frame-%06d.jpg"),
      "-frames:v", String(frameCount),
      "-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos,setsar=1`,
      "-r", String(FPS),
      "-c:v", "libx264",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      path.join(output, "demo-video.mp4"),
    ]);
    return output;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recordDemo()
    .then((output) => console.log(`Captured frames and video in ${output}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
