---
type: design-doc
title: "How Ringfall proves intent, prevents regressions, and evolves with agents"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# How Ringfall proves intent, prevents regressions, and evolves with agents

> [spec](spec.md) · [test plan](test-plan.md) · [journey](journey/README.md)

This document answers four questions a skeptical engineer asks of a
project built largely by a coding agent in a morning: how do we know the
implementation is the product that was designed, how is it tested, what
stops the next change from breaking it, and how can the next change be
made quickly without lowering the bar. It is written in the present tense
for what exists and in the future tense for what is only planned, so the
two are not confused.

## Proving the implementation is the design

The design is a set of numbers and rules, not adjectives. Every gameplay
number in [design-doc.md](design-doc.md) names the module and constant
that holds it (`PLAYER_SPEED`, `SHIELD_RECHARGE_DELAY`, `GRENADE_FUSE`,
`ENEMY_STATS`, `waveComposition`). A reader can diff the document against
`src/core/` in minutes, and that diff is the first thing a review should
do. Where the numbers drift, one of the two is wrong and the pull request
fixes it in the same change.

The rules are proven by tests that read like the design. The shield
absorbs before health and recharges only after the delay
(`tests/unit/vitality.test.ts`). Cover blocks shots
(`tests/unit/raycast.test.ts`). Grenades bounce and come to rest, and
their blast falls off linearly (`tests/unit/grenade.test.ts`). Striders
keep their distance and skimmers close in (`tests/unit/enemy.test.ts`).
Waves walk countdown, active, cleared, next (`tests/unit/waves.test.ts`).
The whole step is exercised end to end: moving, jumping, shooting,
reloading, a grenade killing a strider, a swarm breaking the shield and
killing the player, a wave clearing and the next arriving, and victory
(`tests/unit/game.test.ts`). These are not tautologies; several of them
failed when first written and exposed real behavior (the grenade flew too
far; the enemy faced the wrong way by the renderer's convention; the
rifle shot over a low enemy's head because the player must aim down).

Purity is enforced, not assumed. Nothing under `src/core/` imports
three.js, touches `window` or `document`, calls `Math.random`, or reads
the clock; the seeded `Rng` is passed in. That is what makes the same
`stepGame` serve the human game, the bot, the smoke test, and the
recorder, and it is what makes a bug reproducible from a seed and an
input sequence. The lint rule and test that enforce it are listed under
"What stops the next change from breaking it".

The one place intent is not yet proven is the presentation layer. The
renderer, HUD, and audio are reviewed by eye and ear through captured
frames and the demo film, and the journey log records each review with
the seed and what was judged. That is honest but not automated; the
"Next" section says what would make it so.

## How it is tested

The layers are described in [test-plan.md](test-plan.md); the short
version is a pyramid with one unusual layer in the middle.

| Layer | What it proves | How long it takes |
| ----- | -------------- | ----------------- |
| Static: Biome, strict tsc, markdownlint | Style, types, document hygiene | seconds |
| Unit: Vitest in Node | Every core rule, the whole step, the records module | about a second |
| Playtest: the bot in Node | Whole games are winnable, deterministic per seed, the two bot profiles differ, and twenty seeded games per profile stay within the balance gate | seconds |
| Browser: Playwright in Chromium with WebGL | The built page loads, renders, starts, advances the simulation, moves on keys, and logs no errors | about a minute on software GL |
| Visual and film: captured frames, the recorder | What it looks and plays like | minutes, reviewed by a person |

The playtest layer is the one worth explaining. `src/core/bot.ts` is a
scripted player that sees only what a human sees on the HUD and emits
only what a keyboard and mouse can emit: a bounded turn rate, aim jitter,
strafe bursts, retreat on low shield, grenades at clusters. It considers only enemies in line of sight or within the tracker's 28 m, never their health, and it cannot act faster than the input layer allows.
`src/core/playtest.ts` runs it at 60 Hz with no renderer and reports win
rate, waves cleared, accuracy, shield breaks, and per-wave clear times.
The assertions in `tests/unit/bot.test.ts` are floors, not targets:
determinism, first-wave clearance on most seeds, pooled accuracy above 25%,
and that both profiles run and report separately. The balance numbers
themselves are printed by `pnpm balance`, and the first run's figures are
quoted in the journey log so later tuning has a baseline. Issue #12 turns the harness into a gate with
thresholds chosen from a baseline, not from what passed.

## What stops the next change from breaking it

- Every pull request runs the static, unit, playtest, browser, and build
  layers in CI, with coverage thresholds on `src/core/` (85% lines and
  functions, 75% branches; `pnpm test` prints the actual figures).
- The playtest gate (`pnpm balance`, the `Balance gate` CI job) plays
  twenty seeded games per bot profile and fails the build when a number
  leaves its baseline-derived bound: steady wins at least 10%, waves at
  least 4.85, accuracy at least 29%, no wave slower than 50 s on average,
  reckless wins at most 10%. The margins are written next to the
  thresholds in `tests/balance/gate.ts` and `docs/test-plan.md`, and the
  report (Markdown and JSON) is uploaded as the `balance-report` artifact.
- Dependencies and actions are pinned exactly; nothing moves under the
  project between runs.
- The simulation is deterministic, so a regression report is a seed and a
  step count, and a fix can be shown against the same seed.
- Core purity is a lint rule, not a grep. A Biome override on `src/core/**`
  forbids importing `three`, and the globals `window`, `document`,
  `performance`, and `Date`; `tests/unit/purity.test.ts` reads every core
  file and fails on `Math.random`, `Date.now`, `performance.now`,
  `from 'three`, `window.`, or `document.`, naming the file and line.
- The design document, the brand checklist, and the AGENTS.md pitfalls
  give a reviewer, human or agent, a list to check the diff against rather
  than a feeling.
- Rendering regressions are the weak point: there is no automated image
  comparison, because software GL differs from hardware. The mitigation is
  cheap and in use: the recorder makes a film of a seed, and the journey
  log records the review.

## Evolving with agents, quickly and safely

The project is arranged so that an agent can make a change with the same
evidence a person would have to produce.

**Everything an agent needs is in the repo.** `AGENTS.md` carries the
commands, the structure, the conventions, and the pitfalls that were
actually hit this morning (the negative frame delta, software GL, aiming
below eye height). The spec names the moment each feature is for. The
backlog issues carry acceptance criteria that name the test layer that
proves them. An agent picking up issue #5 knows to add a unit test for the
flee state, a bark event, and a playtest assertion that wave 2 does not
get slower, before it writes a line of renderer code.

**The core is the safe place to change.** A gameplay change touches
`src/core/`, where it is typed strictly, tested in milliseconds, and
measured by the bot. The renderer reacts to events and state; adding a
sound or an effect never touches the simulation. That boundary is the
main reason the morning's rewrite of the whole renderer did not break a
single gameplay test.

**Evidence over assertion.** Verification claims in pull requests quote
the command and the result. Screenshots are filed with their time and
seed. Research is cited to a URL and marked as a target where it is not a
measurement. Where a number was loosened to make a test pass, the
document says so. This is the habit that keeps agent output honest, and
it is checked in review as deliberately as the code.

**Human in the loop where it matters.** The agent proposes; the person
decides what is lovable. That is why the backlog is issues with
acceptance criteria rather than a plan in a chat, why the brand document
has a PR checklist, and why the journey log records what was overruled.

## Next

These are the gaps, in the order they should be closed.

1. A per-frame performance measurement on real hardware (issue #11), so
   the budget in the research becomes a number in this document.
2. An audit of every number in the design document against the code,
   automated as a test that imports the constants and compares them to a
   table in the document's frontmatter.
3. A visual regression check that compares a small set of deterministic
   frames against references rendered on the same software GL, with a
   tolerance, so renderer changes get a diff a reviewer can look at.
