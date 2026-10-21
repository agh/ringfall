# Changelog

All notable changes to Ringfall will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[calendar versioning (`YYYY.M.N`)](https://github.com/agh/crefft/blob/main/guides/process/versioning.md).

## [Unreleased]

### Security

- Content Security Policy and `no-referrer` meta tags in `index.html`; the
  dev server relaxes only `style-src` and `connect-src` for hot reload.
- `?seed` is parsed by `parseSeed` (decimal uint32 only) and personal bests
  are re-validated field by field with a 1 KB cap before `JSON.parse`, so
  hostile query strings and storage values cannot stall or corrupt the end
  card (`src/core/rng.ts`, `src/core/records.ts`).
- Hidden production source maps, a 24 h release cooldown and no lifecycle
  scripts for pnpm, `engine-strict`, a `pnpm audit --prod` script, grouped
  Dependabot updates with a seven-day cooldown, `markdownlint-cli2` 0.24.0.
- Per-job least-privilege tokens in the Pages deploy workflow; CI runs on
  `main` are no longer cancelled by the next push.
- Threat model in `SECURITY.md`.

### Added

- A unit test that fails if the pre-rename repository path reappears outside
  `docs/journey/`, and a runbook note on the rename order (#70).

- The watcher, a third enemy archetype (#17): a tall perimeter sentinel
  that holds 24 to 32 m, orbits the player and fires a telegraphed hitscan
  beam that cover blocks; one from wave 5 and two from wave 7 by design,
  behind `WATCHERS_IN_ROSTER` (off) until the balance pass. New
  `watcherCharging` and `watcherFired` events, a tripod rig with an aiming
  line, and bot rules that shoot a charging watcher first with a precise gun.
- Four skimmer temperaments handed out round-robin per wave: chaser,
  ambusher (leads the player's velocity by 4 m), flanker (swings to the
  off-hand side) and skittish (holds at 10 m until a packmate is within
  6 m of the player). The HUD names the arena Sector 117 from a core
  constant. A crouch on C or Ctrl lowers the eye by 0.6 m; three crouches
  within 1.5 s over a fallen strider earn a one-word bark from a surviving
  skimmer. One cover block per arena hides a switch on its outward face;
  shooting it once scores 1000 and the end card counts secrets found.
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
- Explosions and deaths that read at any distance, by day and at night:
  a 120 ms sprite flash, a thin shockwave crest, debris sparks and chips
  under gravity, a smoke column that rises and thins over 1.5 s, and a
  4 s scorch on the floor; a kill borrows the enemy's own accent and shell
  colours. The particle pool gains `spark`, `smoke` and `shard` shapes with
  premultiplied blending so smoke can darken the frame (#26).

### Changed

- The repository no longer names the console shooter franchise it was
  inspired by outside the cited titles and URLs under `docs/research/`
  (ADR-0003). The research note on feel and the MLP cut dropped the name
  from its file name (`docs/research/feel-and-mlp.md`), and
  `tests/unit/originality.test.ts` greps the tree for the term list in
  `tests/unit/originality.terms.ts`.

### Fixed

- Still too much flare after the bloom prefilter: bloom strength and radius
  halved again (0.15, 0.25), the flare ghosts at 0.3 opacity and the core
  sprite at two thirds of its size, and the day and dawn skies given a
  thinner, tighter mie lobe so the sun reads as a disc; facing the sun the
  saturated blob went from 13% to 3% of the frame height (#71).
- The frame bloomed and flared too much: the bloom prefilter passed the
  whole HDR texel, so the sky's sun disc and the dust motes flooded the
  frame with halos. The prefilter now keeps only the excess over the
  threshold, with a knee and a per-pixel cap; the flare ghosts are sized as
  fractions of the frame and hidden with the sun at night (#25).
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

[Unreleased]: https://github.com/agh/ringfall/commits/main
