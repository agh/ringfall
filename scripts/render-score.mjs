import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runFfmpeg } from "./media-tools.mjs";

export const SAMPLE_RATE = 48_000;

const STINGERS = {
  shot: { frequency: 880, duration: 0.045, amplitude: 0.22 },
  kill: { frequency: 523.25, duration: 0.35, amplitude: 0.2 },
  grenade: { frequency: 110, duration: 0.7, amplitude: 0.28 },
  shield_break: { frequency: 196, duration: 0.45, amplitude: 0.24 },
  shield_recovery: { frequency: 659.25, duration: 0.5, amplitude: 0.18 },
  strider_kill: { frequency: 392, duration: 0.8, amplitude: 0.24 },
  flee: { frequency: 293.66, duration: 0.5, amplitude: 0.18 },
  victory: { frequency: 783.99, duration: 1.2, amplitude: 0.22 },
};

export function synthesizeScore(events, seconds, sampleRate = SAMPLE_RATE) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Score duration must be positive.");
  const sampleCount = Math.ceil(seconds * sampleRate);
  const samples = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    samples[index] = 0.055 * (
      Math.sin(2 * Math.PI * 55 * time) +
      0.48 * Math.sin(2 * Math.PI * 82.407 * time)
    );
  }

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const stinger = STINGERS[event.type];
    if (!stinger || !Number.isFinite(event.timeSeconds)) continue;
    const start = Math.max(0, Math.round(event.timeSeconds * sampleRate));
    const length = Math.min(Math.ceil(stinger.duration * sampleRate), sampleCount - start);
    for (let offset = 0; offset < length; offset += 1) {
      const envelope = Math.exp(-5 * offset / sampleRate);
      samples[start + offset] += stinger.amplitude * envelope *
        Math.sin(2 * Math.PI * stinger.frequency * offset / sampleRate);
    }
  }

  const dataSize = sampleCount * 4;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const pcm = Math.round(sample * 32767);
    wav.writeInt16LE(pcm, 44 + index * 4);
    wav.writeInt16LE(pcm, 46 + index * 4);
  }
  return wav;
}

export async function renderScore({
  eventsFile = process.env.DEMO_EVENTS_FILE ?? "artifacts/demo/events.json",
} = {}) {
  const eventsPath = path.resolve(eventsFile);
  const timeline = JSON.parse(await readFile(eventsPath, "utf8"));
  if (!Array.isArray(timeline.events)) throw new Error("Event timeline must contain an events array.");

  const directory = path.dirname(eventsPath);
  const wavPath = path.join(directory, "score.wav");
  const outputPath = path.join(directory, "demo.mp4");
  await writeFile(wavPath, synthesizeScore(timeline.events, timeline.seconds));
  runFfmpeg([
    "-y",
    "-i", path.join(directory, "demo-video.mp4"),
    "-i", wavPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", String(SAMPLE_RATE),
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ]);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderScore()
    .then((output) => console.log(`Demo written to ${output}`))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
