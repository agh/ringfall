---
type: design-doc
title: "Ringfall test plan"
status: draft
authors: ["Ringfall hackathon team"]
reviewers: []
created: 2026-10-21
approved: 2026-10-21
---

# Ringfall test plan

Follows the crefft testing guide: local-first, unit tests with no I/O,
browser tests in a real browser, and a layer that plays the game so a human
does not have to for every change.

## Layers

| Layer | Tool | What it proves | Where | Gate |
| ----- | ---- | -------------- | ----- | ---- |
| Static | Biome, tsc strict, markdownlint | Style, types, docs hygiene | `pnpm lint`, `pnpm typecheck` | CI lint job |
| Unit | Vitest, Node | Every core rule: movement, collision, weapons, grenades, enemy AI, bolts, waves, vitality, the whole step | `tests/unit/` | 85% lines on `src/core`, 75% branches |
| Playtest | Vitest, Node | A scripted player plays whole games; determinism, accuracy, wave clearing, profile differences | `tests/unit/bot.test.ts` | Thresholds in the test |
| Browser | Playwright, Chromium with WebGL | The built page loads, renders, starts, advances the simulation, moves on keys, no page errors | `tests/e2e/` | CI e2e job |
| Visual | Playwright, screenshots | What it looks like on a software GPU, reviewed by a person and filed under `docs/journey/` | manual, recorded | Review |
| Recording | `scripts/record-demo.mjs` | A deterministic bot run becomes an MP4; the frames are the proof the whole stack renders | manual | Review |
| Luminance | `scripts/frames.mjs`, Chromium on software GL | Ten seeded frames across day, night, dusk with rain, and night with fog are not washed out: mean of a 64x36 downscale within budget (day 150, night 110 of 255) and no saturated blob over 8 % of the frame | `pnpm frames`, CI `frames` job, frames and `report.json` as an artifact | CI frames job |

## The playtest layer, in detail

The bot in `src/core/bot.ts` reads only what a player could know (enemies in line of sight or within the 28 m tracker, never their health) and emits the same `InputFrame` a keyboard and mouse would: it turns at a bounded
rate with aim jitter, strafes in bursts, dodges incoming bolts, retreats on
low shield, reloads when safe, and lobs grenades at clusters or striders.
Two profiles exist: steady (retreats at 30% shield) and reckless (never
retreats).

`runPlaytest({ seed, profile })` in `src/core/playtest.ts` runs a whole game
at 60 Hz with no renderer and returns:

- outcome (won, dead, timeout), waves cleared, run length
- kills, score, shots fired and hit, grenades thrown
- damage taken, shield breaks, seconds with the shield down
- clear time per wave

`summarize(results)` folds a batch of seeds into win rate, mean waves,
accuracy, mean shield breaks, and mean clear time per wave. This is the
number a designer tunes against. The current tests assert determinism,
first-wave clearance, accuracy above 30%, and that the profiles behave
differently. Issue #12 turns this into a CI artifact with thresholds.

## The "I played it" layer

Screenshots are not playing. The recorder (`scripts/record-demo.mjs`)
drives the bot through a real browser render, one simulation tick per
frame, and produces a film. Reviewing that film is how an agent or a person
satisfies themselves the experience holds together: the wave arrives, the
bot fights, the shield breaks and recovers, grenades land, enemies die with
effects, the HUD tracks it all. Each review is logged in
`docs/journey/README.md` with the seed, the frame range, and what was
judged good or bad.

## The luminance gate

Three agents tuned lights before anyone measured a frame, and the whiteouts
were found by replaying a seed by hand. `scripts/frames.mjs` is that loop as
a check: it opens the production build with `?record&bot&seed=7`, one page
per atmosphere, and replays each moment of the frame set in order (chunks of
60 ticks until one second before the moment, then one rendered frame per
tick), screenshots the page, box-filters it to 64x36, and reports the mean and max luminance and
the largest 4-connected blob of saturated cells (luminance 250 or more). The
frame set and the budgets live at the top of the script; the budgets were
set from the frames measured at commit `8566f27`, the commit the gate was
branched from, and the measured values there were:

| Frame | Atmosphere | t (s) | Mean | Max | Blob | Mean budget | Result |
| ----- | ---------- | ----- | ---- | --- | ---- | ----------- | ------ |
| day-3 | day | 3 | 126.7 | 254.6 | 4.17 % | 150 | pass |
| day-10 | day | 10 | 104.9 | 255.0 | 0.35 % | 150 | pass |
| day-18 | day | 18 | 23.4 | 188.6 | 0.00 % | 150 | pass |
| day-45 | day | 45 | 61.2 | 235.2 | 0.00 % | 150 | pass |
| day-48 | day | 48 | 154.2 | 254.9 | 0.48 % | 150 | over |
| night-8.5 | night | 8.5 | 10.2 | 194.2 | 0.00 % | 110 | pass |
| night-10 | night | 10 | 61.7 | 255.0 | 0.56 % | 110 | pass |
| night-18 | night | 18 | 14.2 | 183.6 | 0.00 % | 110 | pass |
| dusk-rain-10 | dusk, rain | 10 | 120.4 | 255.0 | 3.78 % | 150 | pass |
| night-fog-10 | night, fog | 10 | 58.0 | 255.0 | 0.56 % | 110 | pass |

The blob budget is 8 % for every frame. `day-48` is wave 3 with the shield
down and a beam firing, and it is over the day budget at that commit on two
runs (154.2 and 154.8); the gate reports it rather than the budget being
raised to cover it. A second run of `day-3` measured 128.7 against 126.7,
so the mean drifts by about 2 of 255 between runs on software GL; a budget
should stay clear of a measured value by more than that.

A frame over its mean budget or its blob budget fails `pnpm frames`, and
the CI `frames` job with it; the PNGs and `report.json` are uploaded as the
`frames` artifact on every run so a failure can be looked at. Frame rates
that do not divide 60 are refused, as the recorder refuses them.

## What is deliberately not tested

- Pixel-exact rendering: software GL differs from hardware; we check
  structure (no errors, expected elements) not pixels.
- Audio output: synthesis is verified by code review and by listening; the
  event-to-sound mapping is unit-testable and will be (#9).
- Human feel: the bot measures fairness, not fun. A human playtest is the
  last gate before a release tag.

## How to run everything

```bash
pnpm check          # lint, typecheck, unit with coverage, build
pnpm test:e2e       # Playwright against vite preview
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e   # sandboxed browsers
node scripts/record-demo.mjs --seed 7 --seconds 40 --fps 30    # film a run
pnpm frames         # luminance gate: ten seeded frames against their budgets
```
