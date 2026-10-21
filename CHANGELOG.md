# Changelog

All notable changes to Ringfall will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[calendar versioning (`YYYY.M.N`)](https://github.com/agh/crefft/blob/main/guides/process/versioning.md).

## [Unreleased]

## [2026.10.0] - 2026-10-21

### Added

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

[Unreleased]: https://github.com/agh/hack/compare/v2026.10.0...HEAD
[2026.10.0]: https://github.com/agh/hack/releases/tag/v2026.10.0
