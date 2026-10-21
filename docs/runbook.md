---
type: runbook
title: "Ringfall runbook: run, build, deploy, test, film, and fix"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall runbook

> [Ringfall](../README.md) > [Specification](spec.md) > Runbook

This document is for whoever has to run the demo, cut a release, or film
the reel. It repeats nothing from [design-doc.md](design-doc.md) or
[test-plan.md](test-plan.md) beyond the commands; where a number is
explained, those documents own the explanation. Every procedure was
exercised during the hackathon morning on 2026-10-21 and the known faults
at the end are the ones that were actually hit.

## Prerequisites

The toolchain is Node 22 and pnpm 10, with the exact package versions
pinned in `package.json` and `pnpm-lock.yaml`. The game itself needs a
desktop browser with WebGL 2 and pointer lock. Filming needs `ffmpeg` on
the path, or the `FFMPEG` environment variable pointing at one.

```bash
pnpm install --frozen-lockfile
```

## Run the game locally

The development server serves the source with hot reload on port 5173.

```bash
pnpm dev            # http://localhost:5173
```

Three query parameters change how the page starts. `?seed=N` fixes the
arena layout and enemy jitter so a run is reproducible; without it the seed
comes from the clock. `?bot` hands the controls to the scripted player in
`src/core/bot.ts`. `?record&bot&seed=N` enters record mode, which suspends
the animation loop and exposes `window.ringfallCapture` so a script can
step the simulation one tick at a time. `window.ringfall.state()` is
available on every page for inspection.

## Build

The build type checks first and then bundles to `dist/`. The preview server
serves that directory on port 4173, which is also what Playwright and the
`pnpm check` sequence use.

```bash
pnpm build          # tsc --noEmit && vite build
pnpm preview        # serve dist/ on http://127.0.0.1:4173
pnpm check          # lint, typecheck, unit tests with coverage, build
```

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` runs on every push to
`main` and on manual dispatch. Its `build` job installs with the frozen
lockfile, runs `pnpm build`, calls `actions/configure-pages`, and uploads
`dist/` with `actions/upload-pages-artifact`. Its `deploy` job publishes
that artifact with `actions/deploy-pages` into the `github-pages`
environment. The workflow holds the only write permission in the repository
(`pages: write` and `id-token: write`); CI has `contents: read` and
checkouts do not persist credentials. Every action is pinned to a commit
SHA.

One repository setting must be made once by hand, because a workflow
cannot make it: under Settings, Pages, Build and deployment, the Source
must be set to GitHub Actions. Until that is done the deploy job fails at
`configure-pages` and the site at <https://agh.github.io/ringfall/> does not
exist. The `github-pages` environment is created by the first successful
run.

To redeploy without a code change, dispatch the workflow by hand.

```bash
gh workflow run "Deploy to GitHub Pages" --ref main
gh run watch
```

## Unit and playtest suites

The unit suite runs in Node against `src/core/` only, with V8 coverage
thresholds of 85 percent for lines, functions, and statements and 75
percent for branches. The playtest suite is the same runner pointed at
`tests/unit/bot.test.ts` with coverage disabled, so it finishes in seconds
and prints the balance numbers defined in [metrics.md](metrics.md).

```bash
pnpm test           # vitest run --coverage
pnpm balance        # vitest run tests/unit/bot.test.ts --coverage.enabled=false
pnpm test:watch     # vitest in watch mode
```

## Playwright

The smoke tests in `tests/e2e/` run against `vite preview`, so the
production build must exist first. Each test has a 120 second budget and
waits up to 60 seconds for the simulation clock to pass 0.5 seconds,
because software GL renders the post stack at a few frames per second.

Without `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, Playwright wants its own browser
build, which is what CI installs.

```bash
pnpm exec playwright install --with-deps chromium
pnpm build
pnpm test:e2e
```

With `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `playwright.config.ts` passes the
path through as `launchOptions.executablePath`, which is how a sandbox with
a preinstalled Chromium runs the suite without a download. The two demo
scripts honor the same variable.

```bash
pnpm build
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e
```

Setting `CI=1` turns off server reuse and turns on one retry, matching the
workflow.

## Film the demo and score it

`pnpm demo` runs the two scripts in sequence with the settings used for
the reel: seed 7, 40 seconds, 24 frames per second, a one second lead-in on
the score. It needs a production build and `ffmpeg`.

```bash
pnpm build
pnpm demo           # writes demo-silent.mp4, then demo.mp4 with the score
```

`scripts/record-demo.mjs` starts `vite preview` on port 4175, opens the
page with `?record&bot&seed=N` under SwiftShader, captures one second of
title frames, then advances the simulation by `round(60 / fps)` ticks per
captured frame and screenshots the page so the DOM HUD is composited in.
Frames land in `.record-frames/` and are assembled with `libx264` at CRF
18. Its flags and defaults are `--seed 7`, `--seconds 45`, `--fps 30`,
`--width 1280`, `--height 720`, and `--out demo.mp4`.

```bash
node scripts/record-demo.mjs --seed 7 --seconds 45 --fps 30 --out demo.mp4
```

`scripts/render-score.mjs` starts a second preview on port 4176, re-runs
the same seed headlessly to recover the event timeline, renders every voice
and effect into an `OfflineAudioContext`, writes `.record-score.wav`, and
muxes it into the silent film as 192 kbps AAC. Its flags and defaults are
`--seed 7`, `--seconds 40`, `--lead-in 1`, `--video demo.mp4`, and
`--out demo-scored.mp4`. The seed and seconds must match the capture or the
audio drifts from the frames.

```bash
node scripts/render-score.mjs --seed 7 --seconds 40 --lead-in 1 --video demo-silent.mp4 --out demo.mp4
```

Both scripts print `pageerror` lines from the browser; a clean run prints
none. The recorder also prints a status line once per second of film with
the simulation time, wave, enemy count, shield, health, and kills, which
is the quickest way to see that the bot is fighting. Films, frames, and
the WAV are ignored by git. Each review of a film is logged in
[journey/README.md](journey/README.md) with the seed and the frame range.

## Measure the frames (luminance gate)

`pnpm frames` captures the ten-frame set from `scripts/frames.mjs` (seed 7
by day, night, dusk with rain, and night with fog) on software GL, writes the
PNG files and `report.json` to `node_modules/.cache/ringfall-frames/`, prints a
table, and exits 1 when a frame is over its budget. It needs a production
build. CI runs it as the `frames` job on every pull request and uploads the
directory as the `frames` artifact. [test-plan.md](test-plan.md) explains the
measurement and the budgets.

```bash
pnpm build
pnpm frames
pnpm frames --only day-3,night-10 --out /tmp/frames   # a subset, elsewhere
pnpm frames --no-gate                                 # report without failing
```

Its flags and defaults are `--seed 7`, `--fps 60` (rendered frames per
simulated second in the lead-in before each moment; must divide 60),
`--lead-seconds 1`, `--port 4177`, `--out node_modules/.cache/ringfall-frames`,
`--only id,id`, and `--no-gate`. Frames that share an atmosphere are taken
from one page in order of time, so the replay from the start is paid once per
atmosphere; the cost is the renders, about 680 for the set, at roughly a
second each on software GL (17 minutes for the set on this sandbox). Pages are
not captured in parallel because SwiftShader already uses every core.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` is honored as for the other scripts.

### Custom domain

The site is served at <https://ringfall.alexhowells.com>. `public/CNAME` holds
the hostname so every Pages deploy keeps it. One-time setup: a DNS `CNAME`
record for `ringfall` pointing at `agh.github.io`, then in the repository's
Settings, Pages, enter the custom domain and tick "Enforce HTTPS" once the
certificate is issued (a few minutes after DNS resolves). The Vite build uses
a relative `base`, so the same `dist/` works at the apex, under `/ringfall/`, or
from a local preview.

Repository rename order: rename on GitHub first, then `git remote set-url origin`
on each clone, then re-check the Pages custom domain under Settings, Pages.

### The Playwright ffmpeg cannot assemble the film

The ffmpeg that Playwright bundles (`/opt/pw-browsers/ffmpeg-*/ffmpeg-linux`)
is built for screencasts only: VP8 and WebM, no JPEG decoder, no H.264, no
audio encoder. Point `FFMPEG` at a full build instead. The static binary
from `pip install imageio-ffmpeg` (`imageio_ffmpeg/binaries/ffmpeg-linux-*`)
or a system `ffmpeg` both work. A 24 fps capture made before the frame-rate
guard was added holds three simulation ticks per frame; encode it at
`-framerate 20` so it plays in real time, and render the score for the
simulated length (48 s for 960 frames) with a lead-in equal to the title
frames divided by 20.

## Known faults and their fixes

### Pointer lock is refused, or Deploy does nothing after Esc

`requestPointerLock()` rejects in headless browsers, in iframes without
the right `allow` attribute, and for a short browser-enforced cool-down
after the user presses Esc. `InputController.lock()` in
`src/input/input.ts` swallows the rejection, so the game still starts and
the keyboard works, but the mouse does not look around. After an Esc the
`pointerlockchange` handler returns to the overlay; wait a moment and
click Deploy again. If the page is embedded, give the iframe
`allow="pointer-lock"`.

### No sound until a click

Browsers refuse to start an `AudioContext` without a user gesture.
`AudioBank.unlock()` is called from the Deploy click and from the first
pointer down anywhere on the overlay, which is why the title drone starts
on the first click rather than on page load. There is nothing to fix; a
report of silence before any click is expected behavior.

### Everything is slow on a software GPU

Headless Chromium in CI and in sandboxes renders with SwiftShader, which
takes hundreds of milliseconds per frame with the post stack and has lower
depth precision. The title overlay therefore refreshes the idle scene only
every 250 ms, and nothing in the test suites is timed against the wall
clock: the smoke test waits on simulation time and the recorder steps the
simulation per frame. If a new test is flaky on CI only, the first suspect
is a wall-clock wait; move it to the `?record` hook or the headless
playtest.

### Lights blow out and the post stack looks broken right after Deploy

The first `requestAnimationFrame` timestamp after `start()` can be earlier
than the `performance.now()` captured in `start()`. Every decay of the form
`max(0, x - dt * k)` then grows instead of shrinking. `src/main.ts` clamps
`frameDt` to the range 0 to 0.1 seconds; the clamp must stay, and any new
loop or capture path must apply the same rule.

### Playwright reports a missing browser build

The error names a `chromium_headless_shell-NNNN` directory that does not
exist. Either install the matching build with
`pnpm exec playwright install --with-deps chromium`, or point
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an installed Chromium as shown above.
The browser version must be one the pinned Playwright 1.64.1 drives; a
much newer or older Chromium fails at launch with a protocol error.
