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
| Static | Biome, tsc strict, markdownlint, Stylelint, Prettier (CSS), pnpm audit, actionlint, zizmor, gitleaks | Style, types, docs hygiene, CSS conventions, no known high-severity advisories, workflow syntax and permissions, no secrets in the tree or the history | `pnpm lint`, `pnpm typecheck`, `pnpm audit --audit-level=high`, the security job in `.github/workflows/ci.yml` | CI lint job, CI security job |
| Unit | Vitest, Node | Every core rule: movement, collision, weapons, grenades, enemy AI, bolts, waves, vitality, the whole step | `tests/unit/` | 85% lines on `src/core`, 75% branches |
| Playtest | Vitest, Node | A scripted player plays whole games; determinism, accuracy, wave clearing, profile differences | `tests/unit/bot.test.ts` | Thresholds in the test |
| Browser | Playwright, Chromium with WebGL | The built page loads, renders, starts, advances the simulation, moves on keys, no page errors | `tests/e2e/` | CI e2e job |
| Visual | Playwright, screenshots | What it looks like on a software GPU, reviewed by a person and filed under `docs/journey/` | manual, recorded | Review |
| Recording | `scripts/record-demo.mjs` | A deterministic bot run becomes an MP4; the frames are the proof the whole stack renders | manual | Review |

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
```
