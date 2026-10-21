# Changelog

All notable changes to Ringfall will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[calendar versioning (`YYYY.M.N`)](https://github.com/agh/crefft/blob/main/guides/process/versioning.md).

## [Unreleased]

### Added

- Renderer v2: scattering dawn sky, a ringworld you stand on, rolling
  terrain with mountains, image-based lighting, a GPU particle pool, an HDR
  composer with bloom and a custom feel pass (vignette, chromatic
  aberration, hex shield lattice), composite enemy rigs, weapon sway, head
  bob, recoil, sprint FOV.
- Procedural score: choir drone with vowel formants and a synthesised
  cathedral reverb; calm and combat buses that crossfade on wave state.
- Playtest bot and headless harness (`src/core/bot.ts`,
  `src/core/playtest.ts`) with balance tests; `pnpm balance`.
- Deterministic demo recorder (`scripts/record-demo.mjs`, `pnpm demo`) and
  the `?record&bot&seed=N` capture hook.
- Specification, brand system, test plan, two research reports, a journey
  log with captured frames, and a README banner.
- Personal bests kept in the browser's local storage: the end card compares
  the round with the previous best score, deepest wave, runs and clears.
  Storage that is missing, blocked, or corrupt yields a clean slate.

### Fixed

- A negative first frame delta after Deploy made every decay term grow
  without bound; the delta is now clamped at zero.
- The terrain under the arena z-fought the floor at range; it is sunk six
  metres.

### Added (initial build)

- First-person arena shooter rendered with three.js: pointer-lock mouse look,
  WASD movement, sprint, jump, wall sliding against procedurally placed cover.
- Regenerating energy shield over fixed health, with a four second recharge
  delay, a shield-down warning, and a damage vignette.
- Magazine-fed hitscan rifle (32 rounds, 160 reserve, reload) with tracers,
  muzzle flash, recoil, and hit markers.
- Grenades with a 2.5 s fuse, floor and wall bounces, and linear-falloff blast
  damage that also hurts the thrower.
- Two enemy types: fast melee skimmers and ranged striders that keep their
  distance and fire dodgeable energy bolts.
- Eight escalating waves with countdowns, clear bonuses, a victory state, and
  a death state, each returning to the overlay for a rematch.
- Heads-up display with shield and health bars, ammo, grenade count, wave
  status, score, announcements, and a 2D motion tracker.
- Procedural WebAudio sound bank; no external assets.
- Ringworld arc, planet, sun, and star field on the horizon.
- Vitest unit suite over the renderer-free core with V8 coverage thresholds,
  and Playwright smoke tests in real Chromium.
- GitHub Actions CI (lint, type check, unit, e2e, build) and GitHub Pages
  deployment, all actions pinned to commit SHAs.

[Unreleased]: https://github.com/agh/hack/commits/main
