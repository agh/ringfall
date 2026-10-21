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
| Static | Biome, tsc strict, markdownlint | Style, types, docs hygiene | `pnpm lint`, `pnpm typecheck` | CI lint job |
| Unit | Vitest, Node | Every core rule: movement, collision, weapons, grenades, enemy AI, bolts, waves, vitality, the whole step | `tests/unit/` | 85% lines on `src/core`, 75% branches |
| Playtest | Vitest, Node | A scripted player plays whole games; determinism, accuracy, wave clearing, profile differences | `tests/unit/bot.test.ts` | Floors in the test |
| Balance gate | Vitest, Node | Twenty seeded games per profile stay within baseline-derived bounds; the report is a CI artifact | `tests/balance/` | CI balance job, thresholds in `tests/balance/gate.ts` |
| Browser | Playwright, Chromium with WebGL | The built page loads, renders, starts, advances the simulation, moves on keys, no page errors | `tests/e2e/` | CI e2e job |
| Visual | Playwright, screenshots | What it looks like on a software GPU, reviewed by a person and filed under `docs/journey/` | manual, recorded | Review |
| Recording | `scripts/record-demo.mjs` | A deterministic bot run becomes an MP4; the frames are the proof the whole stack renders | manual | Review |
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
branch that cut Chapter 1 to five named waves (#8) merged onto the rout
(#40) and the skimmer temperaments (#47), seeds 100 to 119, 480 s cap:

| Profile | Win rate | Mean waves cleared (of 5) | Mean seconds | Accuracy | Shield breaks | Mean clear per wave (s) |
| ------- | -------- | ------------------------- | ------------ | -------- | ------------- | ----------------------- |
| Steady | 75% | 4.35 | 152 | 52% | 0.10 | 4, 13, 14, 20 |
| Reckless | 70% | 4.55 | 127 | 43% | 0.45 | 4, 14, 19, 23 |

This supersedes the eight-wave baseline the gate was introduced with
(steady 15% wins, 5.35 waves of 8, 39% accuracy; reckless 0% wins, 4.20
waves), the reckless re-derivation at `84a835b` for the temperaments (15%
wins), both of which could not hold once `FINAL_WAVE` became 5, and the
earlier table in `docs/journey/README.md` (0% wins, 3.40 waves).

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
The margins have not been re-measured under the five beats; that is open
in issue #12. The reckless bound's original intent ("never retreating must
not become the way to win") does not hold under the compositions #8
specifies: the reckless profile wins 70% of its games. Issue #63 holds
that question.

| Profile | Metric | Bound | Limit | Baseline | Margin |
| ------- | ------ | ----- | ----- | -------- | ------ |
| Steady | Win rate | at least | 70% | 75% | one game of twenty |
| Steady | Mean waves cleared | at least | 3.85 | 4.35 | half a wave of five |
| Steady | Accuracy | at least | 42% | 52% | ten points |
| Steady | Slowest mean wave clear | at most | 40 s | 20 s | twice the slowest baseline wave |
| Reckless | Win rate | at most | 80% | 70% | two games of twenty; drift only, see above and #63 |
| Reckless | Mean waves cleared | at least | 4.05 | 4.55 | half a wave of five |

The original intent of the reckless row, that never retreating must not
become the way to win, would be a cross-profile bound (reckless not
exceeding steady by more than two games of twenty); the gate has no
cross-profile metric yet, so that is issue #63 rather than a row.

The thresholds live in `tests/balance/gate.ts`; the report shape
(`BalanceReport`, `GateThreshold`, `evaluateGate`) in
`src/core/playtest.ts`. Issue #12 asked for 60% steady wins and a five to
nine minute median run; the five beats meet the first (75%) and miss the
second (the median won run is under two minutes), so the gate holds what
the game does today and the run-length target stays with issue #8.

## The "I played it" layer

Screenshots are not playing. The recorder (`scripts/record-demo.mjs`)
drives the bot through a real browser render, one simulation tick per
frame, and produces a film. Reviewing that film is how an agent or a person
satisfies themselves the experience holds together: the wave arrives, the
bot fights, the shield breaks and recovers, grenades land, enemies die with
effects, the HUD tracks it all. Each review is logged in
`docs/journey/README.md` with the seed, the frame range, and what was
judged good or bad.

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
pnpm balance        # the balance gate; report under test-results/balance/
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome pnpm test:e2e   # sandboxed browsers
node scripts/record-demo.mjs --seed 7 --seconds 40 --fps 30    # film a run
```
