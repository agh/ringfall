---
type: decision-index
title: "Ringfall decision index"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall decision index

> [Ringfall](../README.md) > [Specification](spec.md) > Decisions

This table is append-only. One line per decision, with the date it was
made and where its reasoning is recorded: an architecture decision record
under [adr/](adr/), a GitHub issue, a pull request, a section of a
document, or an entry in [journey/README.md](journey/README.md). The
commit column gives the short hash and subject from `git log --oneline`
of the commit that landed the decision, so the diff can be found. All of
these were made on 2026-10-21, the hackathon morning; later rows carry
their own dates. A decision is never edited here; a reversal is a new row
pointing at the old one.

| Date | Decision | Where recorded | Commit |
| ---- | -------- | -------------- | ------ |
| 2026-10-21 | Write the game in TypeScript and render with three.js on WebGL rather than raw WebGL, another engine, or WebGPU. | [ADR-0001](adr/0001-typescript-three-vite.md) | `047e4cb` chore: scaffold TypeScript, Vite, Biome, Vitest, and Playwright toolchain; `21ddff6` feat(game): add three.js renderer, HUD, input, audio, and game loop |
| 2026-10-21 | Bundle and serve with Vite so the build is a static `dist/` that GitHub Pages hosts. | [ADR-0001](adr/0001-typescript-three-vite.md) | `047e4cb` chore: scaffold TypeScript, Vite, Biome, Vitest, and Playwright toolchain |
| 2026-10-21 | Keep the simulation a pure function over immutable state, `stepGame(state, input, dt, rng)`, with no three.js, DOM, clock, or `Math.random` under `src/core/`. | [ADR-0002](adr/0002-pure-simulation-core.md); [evolution.md](evolution.md) "Proving the implementation is the design" | `a3f8f0f` feat(core): add renderer-free simulation with unit tests |
| 2026-10-21 | Ship only original names, procedural visuals, and synthesized audio; describe the inspiration in prose without naming the franchise in code, metadata, or copy. | [ADR-0003](adr/0003-original-ip-only.md) | `515aebc` docs: add README, AGENTS.md, design doc, ADRs, changelog, and license |
| 2026-10-21 | Version with calendar versioning in the form `YYYY.M.N`, with Keep a Changelog release notes; the first tag is `v2026.10.0`. | [CHANGELOG.md](../CHANGELOG.md) header; [README.md](../README.md) "Develop" | `515aebc` docs: add README, AGENTS.md, design doc, ADRs, changelog, and license |
| 2026-10-21 | Step the simulation on a fixed 60 Hz accumulator capped at five steps per frame, so physics is frame-rate independent and a backgrounded tab does not fast-forward. | [ADR-0002](adr/0002-pure-simulation-core.md); [design-doc.md](design-doc.md) "System Architecture" | `21ddff6` feat(game): add three.js renderer, HUD, input, audio, and game loop |
| 2026-10-21 | Pin every dependency to an exact version and every GitHub Action to a commit SHA. | [design-doc.md](design-doc.md) goal G6; [README.md](../README.md) "Develop" | `047e4cb` chore: scaffold TypeScript, Vite, Biome, Vitest, and Playwright toolchain; `2a6e4a2` ci: add lint, test, e2e, build workflows and GitHub Pages deploy |
| 2026-10-21 | Ship eight uniform waves from a formula now, with `FINAL_WAVE` as the lever, and defer five named waves with drop-pods and a victory tableau. | Issue #8; [spec.md](spec.md) MLP item 8; [journey/README.md](journey/README.md) "Calls that were made, then overruled" | `415d9bd` feat: renderer v2, procedural score, playtest bot, demo recorder, spec and backlog docs |
| 2026-10-21 | Make the ring a torus 6 km in radius with a 360 m tube, sunk 820 m below the horizon, so the player stands on it and the arc rises on both sides after the first ring put the camera inside the tube. | [brand.md](brand.md) "The ring"; [journey/README.md](journey/README.md) "14:34 to 15:05 Renderer v2 and three bugs" | `415d9bd` feat: renderer v2, procedural score, playtest bot, demo recorder, spec and backlog docs |
| 2026-10-21 | Keep the bloom threshold above 1.0 in HDR so only emitters bloom, and tone map with ACES at exposure 0.38. | [design-doc.md](design-doc.md) "Presentation"; [brand.md](brand.md) checklist item 8 | `415d9bd` feat: renderer v2, procedural score, playtest bot, demo recorder, spec and backlog docs |
| 2026-10-21 | Adopt Chakra Petch for display and JetBrains Mono for body and HUD, both under the SIL Open Font License; `src/style.css` still carries the earlier fallback stack until the brand work lands. | [brand.md](brand.md) "Typography"; issue #10 | `415d9bd` feat: renderer v2, procedural score, playtest bot, demo recorder, spec and backlog docs |
| 2026-10-21 | Set the camera to 78 degrees vertical field of view, with sprint adding 6 degrees, and derive the 0.5 m readability rule from it. | [brand.md](brand.md) "Geometry language" and "Motion and feel"; `BASE_FOV` in `src/render/scene.ts` | `415d9bd` feat: renderer v2, procedural score, playtest bot, demo recorder, spec and backlog docs |
| 2026-10-21 | Film the demo with a deterministic recorder that steps the simulation once per captured frame, instead of screen capture, so the film plays at the right speed on a software GPU. | [test-plan.md](test-plan.md) "The I played it layer"; [journey/README.md](journey/README.md) "Screenshots as proof of play" and "15:20 Recording the demo" | `415d9bd` feat: renderer v2, procedural score, playtest bot, demo recorder, spec and backlog docs |
| 2026-10-21 | Render the soundtrack offline from the same seeded event timeline into an `OfflineAudioContext`, because headless Chromium cannot play audio and the live score schedules against the wall clock. | [journey/README.md](journey/README.md) "15:30 Soundtrack without a clock" | `d60e0c9` feat(audio): render the demo soundtrack offline from the deterministic event timeline |
| 2026-10-21 | Keep personal bests in the browser's local storage with nothing leaving the device, and treat missing, blocked, or corrupt storage as a clean slate. | [spec.md](spec.md) MLP item 15; [CHANGELOG.md](../CHANGELOG.md) Unreleased | `1637875` feat(records): keep personal bests in local storage and compare each round |
| 2026-10-21 | Make the browser smoke test wait on simulation time rather than on a wave spawning, and throttle idle title rendering to one refresh per 250 ms, so the test is not a benchmark of the runner's GPU. | Commit message; comment in `tests/e2e/smoke.spec.ts`; [runbook.md](runbook.md) "Everything is slow on a software GPU" | `c393c3d` fix(e2e): throttle idle title rendering and make the smoke test GPU-agnostic |
