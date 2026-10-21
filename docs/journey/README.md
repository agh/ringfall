# Demo recording journey

The recording pipeline makes a fixed-step browser capture of a deterministic
game run and builds the accompanying score from the event timeline captured
during that same run.

## Capture contract

Serve the game separately and make `window.ringfallCapture` a callable function
on a page opened with `?record&bot&seed=N`. It must synchronously advance one
simulation tick at 60 Hz and render once per invocation. Return events from
that tick as an array or as `{ events: [] }`. Each event needs a string `type`;
`timeSeconds` is preferred, and missing timestamps are assigned from the
capture frame number. Use event types `shot`, `kill`, `grenade`,
`shield_break`, `shield_recovery`, `strider_kill`, `flee`, and `victory` to
trigger the score stingers.

Run `RINGFALL_URL=http://localhost:4173/ pnpm demo` after installing
dependencies and Chromium. The script captures 45–60 seconds at 60 fps in a
1920×1080 viewport, writes JPEG frames and `events.json`, creates an H.264
video, synthesizes a 48 kHz stereo WAV, and muxes the score as AAC. Outputs
default to `artifacts/demo/`. The pipeline uses `ffmpeg-static` for MP4
encoding: Playwright's bundled ffmpeg is limited to WebM/VP9 and lacks the
H.264/AAC codecs required by this output.

The requested title, deploy, wave, and victory sequence is authored by the
game itself; this checkout has no game or simulation implementation. It also
does not currently re-run the simulation in Node, so the generated timeline
comes from the deterministic browser capture.

## Reproducibility

The recorder calls the capture hook once before each JPEG screenshot and does
not use wall-clock timing to advance the game. Compare runs from the same
browser and platform by hashing the files in `artifacts/demo/frames/`:

```sh
sha256sum artifacts/demo/frames/*.jpg
```

Browser rasterization can differ across platforms or browser versions. The
stable-frame requirement is meaningful when the same browser build and
environment are used for both runs.
