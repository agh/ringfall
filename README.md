# Ringfall demo recording

This repository contains the deterministic demo recording pipeline. The game
must be served separately and expose `window.ringfallCapture` as a function on
its `?record&bot&seed=N` page. Each call must advance the simulation by one
60 Hz tick, render once, and return either an event array or `{ events: [] }`.
Events use `{ type, timeSeconds }`; omitted timestamps are assigned to the
capture frame.

Install dependencies and Playwright's browser binaries, start the game at its
local URL, then run:

```sh
npm install
npx playwright install chromium
RINGFALL_URL=http://localhost:4173/ pnpm demo
```

`DEMO_SEED` defaults to `1`, `DEMO_SECONDS` defaults to `60` (allowed range
45–60), and `DEMO_OUTPUT_DIR` defaults to `artifacts/demo`. The output includes
the JPEG sequence, `events.json`, an intermediate video, `score.wav`, and the
final `demo.mp4`. The capture uses a fixed 1920×1080 viewport and invokes the
simulation hook exactly once per frame. The video is H.264 at 60 fps and CRF
18; the synthesized stereo score is muxed as AAC. The MP4 encoder uses
`ffmpeg-static` because Playwright's bundled ffmpeg only supports WebM/VP9 and
cannot produce H.264/AAC MP4.

The current checkout does not include the game, its simulation, or the
`docs/journey/` content, so it cannot generate or link a finished Ringfall cut
until the game is integrated. The pipeline records the event timeline from the
same browser run rather than independently re-running a Node simulation.

See [the demo journey](docs/journey/README.md) for the capture contract and
output details.