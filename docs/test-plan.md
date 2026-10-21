---
type: design-doc
title: "Ringfall test plan"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall test plan

Follows the crefft testing guide: local-first, unit tests with no I/O,
browser tests in a real browser, and a layer that plays the game so a human
does not have to for every change.

## Layers

| Layer | Tool | What it proves | Where | Gate |
| ----- | ---- | -------------- | ----- | ---- |
| Static | Biome, tsc strict, markdownlint, Stylelint, Prettier (CSS), pnpm audit, actionlint, zizmor, gitleaks | Style, types, docs hygiene, CSS conventions, no known high-severity advisories, workflow syntax and permissions, no secrets in the tree or the history | `pnpm lint`, `pnpm typecheck`, `pnpm audit --audit-level=high`, the security job in `.github/workflows/ci.yml` | CI lint job, CI security job |
| Unit | Vitest, Node | Every core rule: movement, collision, weapons, grenades, enemy AI, bolts, waves, vitality, the whole step | `tests/unit/` | 97% lines on `src/core`, 90% branches |
| Playtest | Vitest, Node | A scripted player plays whole games; determinism, accuracy, wave clearing, profile differences | `tests/unit/bot.test.ts` | Floors in the test |
| Balance gate | Vitest, Node | Twenty seeded games per profile stay within baseline-derived bounds; the report is a CI artifact | `tests/balance/` | CI balance job, thresholds in `tests/balance/gate.ts` |
| Browser | Playwright, Chromium with WebGL | The built page loads, renders, starts, advances the simulation, moves on keys, no page errors | `tests/e2e/` | CI e2e job |
| Visual | Playwright, screenshots | What it looks like on a software GPU, reviewed by a person and filed under `docs/journey/` | manual, recorded | Review |
| Recording | `scripts/record-demo.mjs` | A deterministic bot run becomes an MP4; the frames are the proof the whole stack renders | manual | Review |
| Luminance | `scripts/frames.mjs`, Chromium on software GL | Ten seeded frames across day, night, dusk with rain, and night with fog are not washed out: mean of a 64x36 downscale within budget (day 150, night 110 of 255) and no saturated blob over 8 % of the frame | `pnpm frames`, CI `frames` job, frames and `report.json` as an artifact | CI frames job |
| Docs | typos, Vale with the vendored crefft rules, markdown-link-check, frontmatter JSON schema | US spelling in code and prose, house prose rules, every internal link and anchor resolves, every document's frontmatter matches `docs/frontmatter.schema.json` | `pnpm lint:docs` | CI docs job; Vale reports without failing until its remaining findings are rewritten; external URLs advisory |

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
number a designer tunes against. The unit tests assert determinism,
first-wave clearance, accuracy above 25%, and that the profiles behave
differently. The balance gate below bounds the numbers themselves.

## The balance gate

`pnpm balance` runs `tests/balance/report.test.ts`: twenty seeded games
(seeds 100 to 119, 480 s cap) for each bot profile, about seven seconds on
a laptop. It writes `test-results/balance/balance-report.md` (summary
table with a block sparkline of mean clear time per wave, the gate table,
and one row per game) and `balance-report.json` (the same, machine
readable, including every `PlaytestResult`), then asserts the thresholds.
The report is written before the assertions, so it exists on a failing
run too. The CI job `Balance gate` uploads the directory as the
`balance-report` artifact on every pull request and appends the Markdown
to the job summary.

### Baseline

The run the thresholds are derived from, printed by `pnpm balance` on the
branch for issue #93 (the bot holds fire without line of sight and walks at
a target behind cover) on top of `main` at `cd16454`, seeds 100 to 119,
480 s cap:

| Profile | Win rate | Mean waves cleared (of 5) | Mean seconds | Accuracy | Shield breaks | Mean clear per wave (s) |
| ------- | -------- | ------------------------- | ------------ | -------- | ------------- | ----------------------- |
| Steady | 85% | 4.50 | 154 | 83% | 0.10 | 4, 11, 16, 20 |
| Reckless | 85% | 4.70 | 138 | 83% | 0.20 | 4, 16, 15, 18 |

Accuracy jumped from the fifties because shots fired into cover had been
counted as misses; from here it measures line of sight as much as aim.
Holding fire without the walk was measured too and left the gate on its
limits (steady 70% wins, 4.10 waves, 231 s mean; reckless 65% wins, 4.05
waves): the bot stood still while a target sat behind a slab, and more
games ran to the 480 s cap.

This supersedes the five-beat baseline (#8 merged onto the rout #40 and the
temperaments #47: steady 75% wins, 4.35 waves, 152 s, 52% accuracy;
reckless 70% wins, 4.55 waves, 127 s, 43% accuracy), the eight-wave
baseline the gate was introduced with (steady 15% wins, 5.35 waves of 8,
39% accuracy; reckless 0% wins, 4.20 waves), the reckless re-derivation at
`84a835b` for the temperaments (15% wins), both of which could not hold
once `FINAL_WAVE` became 5, and the earlier table in
`docs/journey/README.md` (0% wins, 3.40 waves).

### Thresholds

Each limit is the baseline moved by a stated margin in the lenient
direction. The gate is a regression fence, not a target: a tuning change
that moves a number past the margin fails the build and the report says
by how much. The same games run every time (seeded simulation and bot),
so the margin covers design drift, not sampling noise. Moving a limit is a
design decision that belongs in the same pull request as the tuning
change, with the new baseline in this table.

The margins were sized against the reference breaking change named in
issue #12, halving rifle damage from 20 to 10, under the eight-wave
formula: there it moved steady wins from 15% to 5%, steady waves from 5.35
to 4.35, and reckless wins from 0% to 25% (steady accuracy rose to 57%, so
accuracy is not a damage signal). Each margin is about half of that shift.
The margins have not been re-measured under the five beats; issue #12 is
closed and no issue tracks that re-measurement. The reckless bound's original intent ("never retreating must
not become the way to win") does not hold under the compositions #8
specifies: the reckless profile wins 85% of its games. Issue #63 holds
that question.

| Profile | Metric | Bound | Limit | Baseline | Margin |
| ------- | ------ | ----- | ----- | -------- | ------ |
| Steady | Win rate | at least | 80% | 85% | one game of twenty |
| Steady | Mean waves cleared | at least | 4.00 | 4.50 | half a wave of five |
| Steady | Accuracy | at least | 73% | 83% | ten points |
| Steady | Slowest mean wave clear | at most | 40 s | 20 s | twice the slowest baseline wave |
| Reckless | Win rate | at most | 95% | 85% | two games of twenty; drift only, see above and #63 |
| Reckless | Mean waves cleared | at least | 4.20 | 4.70 | half a wave of five |

The original intent of the reckless row, that never retreating must not
become the way to win, would be a cross-profile bound (reckless not
exceeding steady by more than two games of twenty); the gate has no
cross-profile metric yet, so that is issue #63 rather than a row.

The thresholds live in `tests/balance/gate.ts`; the report shape
(`BalanceReport`, `GateThreshold`, `evaluateGate`) in
`src/core/playtest.ts`. Issue #12 asked for 60% steady wins and a five to
nine minute median run; the five beats meet the first (85%) and miss the
second (the median won run is under two minutes), so the gate holds what
the game does as of 2026-10-21 and the run-length target stays with issue #8.

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
the CI `frames` job with it; the PNG files and `report.json` are uploaded as the
`frames` artifact on every run so a failure can be looked at. Frame rates
that do not divide 60 are refused, as the recorder refuses them.

## What is deliberately not tested

- Pixel-exact rendering: software GL differs from hardware; we check
  structure (no errors, expected elements) not pixels.
- Audio output: synthesis is verified by code review and by listening; the
  event-to-sound mapping is unit-tested in `tests/unit/sounds.test.ts`;
  the synthesis itself is not.
- Human feel: the bot measures fairness, not fun. A human playtest is the
  last gate before a release tag.

## How to run everything

```bash
pnpm check          # lint, typecheck, unit with coverage, build
pnpm test:e2e       # Playwright against vite preview
pnpm balance        # the balance gate; report under test-results/balance/ (pnpm test:e2e empties test-results/, so copy it first)
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e   # sandboxed browsers
node scripts/record-demo.mjs --seed 7 --seconds 40 --fps 30    # film a run
pnpm frames         # luminance gate: ten seeded frames against their budgets
```
