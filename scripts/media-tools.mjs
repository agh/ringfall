import { spawnSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

export function runFfmpeg(args) {
  const executable = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!executable) throw new Error("No ffmpeg binary available for this platform.");
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited with status ${result.status}`);
}
