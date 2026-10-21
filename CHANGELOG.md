# Changelog

All notable changes to Ringfall will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[calendar versioning (`YYYY.M.N`)](https://github.com/agh/crefft/blob/main/guides/process/versioning.md).

## [Unreleased]

### Fixed

- Adversarial software review (#51): a death in the same step as the last
  kill is no longer overwritten by victory; blasts spare spawning enemies
  as shots do; the fixed-step loop drops, rather than defers, steps past
  its per-frame cap; resuming after Esc keeps the look direction; the beam
  charge hum is cut on victory and whenever the overlay returns; the
  arena rebuild and expired explosion and death effects dispose their GPU
  resources; a zero-height viewport no longer puts NaN in the projection;
  the recorder refuses frame rates that do not divide 60, as the audit
  claimed it already did; the purity test and the Biome denied-globals
  list cover `crypto`, `globalThis`, `structuredClone`, `Intl`, timers,
  storage and `console`; the Pages deploy waits for a green CI run; the
  browser smoke tests fail on page errors in every test and check for a
  WebGL 2 context; `tests/scratch/` is ignored by git, Biome and tsc.

### Added

- Enemy theatre: when a strider dies, every skimmer within 25 m breaks and
  runs for 4 s at 1.3x speed without attacking, then returns to the chase.
  New enemy state `flee` and two events for the presentation layers,
  `enemyFled { id, kind }` and `enemyBark { id, line }`, with three original
  bark lines (`src/core/enemy.ts`).
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
- Six weapons (rifle, laser, scatter, beam, launcher, minigun) with their
  own fire rules in `src/core/weapon.ts`, vended as pickups during waves
  and as a wave reward, held in two slots with a swap key; the bot swaps
  and collects them; the HUD names the weapon and the offhand.
- A viewmodel, muzzle flash, tracer and sound per weapon, and pickup
  emblems in the arena.
- Day and night: each wave has a time of day and a weather (night, dusk,
  dawn, rain, fog) that the renderer blends to over the countdown; a moon,
  a glowing ring at night, rain through the particle pool.
- A story reel pipeline (`scripts/reel.mjs`, `scripts/reel-cards/`): brand
  cards, wave 1 by day and wave 2 by night from the deterministic bot, the
  offline score, one MP4.
- Pages deploys to ringfall.alexhowells.com.

### Fixed

- A negative first frame delta after Deploy made every decay term grow
  without bound; the delta is now clamped at zero.
- The terrain under the arena z-fought the floor at range; it is sunk six
  metres.
- Enemy deaths and explosions whited out the frame, worst at night. The
  cause was the particle size law (a sprite's pixel size is 300 over its
  depth, so a size-10 spark eight metres away was 375 px); sprites are now
  capped at 64 px and fade within two metres of the eye, blasts are scaled
  by distance from the camera, and the explosion light is a quarter of
  what it was.

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
