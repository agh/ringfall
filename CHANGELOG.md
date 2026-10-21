# Changelog

All notable changes to Ringfall will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[calendar versioning (`YYYY.M.N`)](https://github.com/agh/crefft/blob/main/guides/process/versioning.md).

## [Unreleased]

### Security

- Fonts are served from this origin (`src/fonts.css`, latin and latin-ext
  subsets of Chakra Petch and JetBrains Mono under the OFL), so the page
  makes no third-party request and the Content Security Policy names no
  other host; the reel cards use the same files (#52, items 5 and 19).
- `window.ringfallDebug` exists only on the dev server and under `?record`
  (#52, item 16). The failed-e2e artifact now carries the HTML report and
  the traces (#52, item 14).
- Content Security Policy and `no-referrer` meta tags in `index.html`; the
  dev server relaxes only `style-src` and `connect-src` for hot reload.
- `?seed` is parsed by `parseSeed` (decimal uint32 only) and personal bests
  are re-validated field by field with a 1 KB cap before `JSON.parse`, so
  hostile query strings and storage values cannot stall or corrupt the end
  card (`src/core/rng.ts`, `src/core/records.ts`).
- Hidden production source maps, a 24 h release cooldown and no lifecycle
  scripts for pnpm, `engine-strict`, a `pnpm audit --prod` script, grouped
  Dependabot updates with a seven-day cooldown, `markdownlint-cli2` 0.24.0.
- Per-job least-privilege tokens in the CI workflow, including its Pages
  build and deploy jobs; CI runs on `main` are no longer cancelled by the
  next push.
- Workflow and dependency hygiene gates in CI: actionlint, zizmor, gitleaks,
  `pnpm audit` and Stylelint (#44).
- Threat model in `docs/threat-model.md`, summarized in `SECURITY.md` (#78).

### Added

- A settings panel on the title overlay (#37): mouse sensitivity, field of
  view, and switches for screen shake and flash, kept in the browser's local
  storage (`src/core/settings.ts`).
- Luminance gate in CI (#30): `pnpm frames` captures ten seeded frames from
  the built site and fails on the mean, saturated-blob and whiteout budgets
  in `scripts/frames.mjs`; the `frames` artifact holds the images.
- Docs hygiene in CI (#43): frontmatter schema, typos, Vale (advisory) and
  an internal link check behind `pnpm lint:docs`.
- The dropship moment (#58): when a wave's first pod launches, a dark
  Hull craft with a Rose underlight crosses the arena in 4 s, in over the
  wall behind that pod, over the centre and out the far side. Each
  `dropPod` falls as a capsule from the craft's altitude to its landing
  point over the 1.5 s lead and raises a Slate dust ring on touchdown.
  New `src/render/dropship.ts`, one hook in `scene.ts`, and a low pass-by
  sweep for `dropPod` in the sound table. Presentation only: spawn times
  and positions per seed are unchanged.
- Five named wave beats (Scouts, The Leader, Fallback, The Push, Last
  Stand) replace the eight-wave formula; `waveStarted` carries the name and
  the HUD announces it. Enemies arrive by drop pod (`dropPod` event 1.5 s
  before they go active; The Leader's strider lands 4 s late). The Last
  Stand ends when its armoured strider (3x health) falls: `victory` carries
  kills and shield breaks, the survivors flee off the arena, and the state
  holds a 5 s tableau before the run is won. `scripts/wave-table.mjs`
  generates the design doc's composition table from the constants.

- An architecture package under `docs/architecture/`: C4 context and
  container diagrams, component diagrams and a module map generated from the
  import graph, an event catalogue generated from the `GameEvent` union and
  its consumers, the frame and tick data flows, the build and delivery view,
  a decision index and the invariants, with `pnpm docs:architecture` to
  regenerate and render and a unit test that fails on drift (#79).
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
- Core purity as a lint rule: a Biome override on `src/core/**` and
  `tests/unit/purity.test.ts` (#34).
- Balance gate in CI: `pnpm balance` fails on baseline-derived thresholds
  in `tests/balance/gate.ts` and uploads a `balance-report` artifact (#39).
- One event-to-sound table (`src/audio/sounds.ts`) shared by the live bank
  and the offline score, with a bark squeal for routed skimmers (#42).
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
- Specification, brand system, test plan, three research reports, a journey
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

- Five per-step allocations gone from the simulation (#105, block 1): the
  stepped state is returned as a literal instead of an object rest, enemy
  tracking is built for skimmers only, holdouts are counted without filter
  arrays, the player is copied only when the shield changed, and the
  collision probe takes coordinates instead of a fresh vector. About a
  quarter off `stepGame` on 184,758 recorded steps; same output, same
  `pnpm balance` summaries.
- The luminance gate is its own optional workflow (`.github/workflows/frames.yml`)
  on pull requests that touch the renderer and by hand; the smoke job is
  capped at twelve minutes (#104).
- The Pages build waits on the lint, unit, build, balance, docs and
  security jobs only; the browser smoke tests (and, until #104, the
  luminance gate) still fail the run but no longer hold the deploy. The smoke tests wait up to
  four minutes for the first simulation step and the e2e job uploads the
  Playwright traces, and since #96 the HTML report, as `playwright-report`
  on failure (#100).
- Pickups glow through their own emissive rig instead of one point light
  each (#29).
- HUD and overlay styling moved onto the brand tokens and type scale, with
  the banner and the brand document brought into line (#10).
- Night and weather readability (#31): dust motes are a hint rather than
  white discs (size 0.09, 3.5 to 10 m out, at most 11 px at 720p) with
  rate, life and brightness per time of day and weather; rain streaks are
  brighter and longer with larger splashes; enemy rigs own their materials
  and lift their emissives (skimmer ring and core, strider lens and muzzle)
  with a night factor from the atmosphere rig, so one strider charging no
  longer whitens every strider's lens.
- The repository no longer names the console shooter franchise it was
  inspired by outside the cited titles and URLs under `docs/research/`
  (ADR-0003). The research note on feel and the MLP cut dropped the name
  from its file name (`docs/research/feel-and-mlp.md`), and
  `tests/unit/originality.test.ts` greps the tree for the term list in
  `tests/unit/originality.terms.ts`.

### Fixed

- A chasing enemy wedged on the corner of a cover block, or pressed against
  a face the player stood straight behind, never moved again; it now
  sidesteps round the block after a second without headway (`STUCK_AFTER`
  and `sidestepDirection` in `src/core/enemy.ts`, numbers in
  `docs/design-doc.md`). A strider inside its range band with cover between
  it and the player's eye closes instead of firing into the block
  (`hasClearShot`). Seen in the balance traces for #93: five of the forty
  gate games ran to the clock that way, none does now, and the gate is
  re-derived from the new run (`tests/balance/gate.ts`, `docs/test-plan.md`).
- The HUD no longer forces a synchronous layout and style recalc on every
  playing frame: text is written only when it changes and the tracker and
  compass canvas sizes come from a `ResizeObserver` instead of a per-frame
  `getBoundingClientRect()` (layouts per frame 1.0 to 0.008 on a headless
  `?record&bot&seed=7` capture). One `mousemove` delta is capped at 400 px
  per axis, so the lock regained after Esc cannot whip the view (#105,
  block 4).

- Audio block of the quality pass (#105): noise buffers are built once per
  context and warmed at unlock, instead of a fresh buffer filled on the main
  thread for every shot, explosion and drop pod (141 fills and 11.7 MB over
  a five-wave run before #107, which made the pod sound once per step); the
  combat pulse looks two ticks ahead, so a timer tick a whole tick late no
  longer drops a beat and shifts the grid.
- Merge seams between features that landed from different branches (#97,
  pass C), each pinned by a deterministic test that runs both in one go:
  a skimmer already leaving after the final leader fell is no longer
  downgraded to a timed rout by a strider a late blast kills, so it keeps
  leaving and the tableau ends with an empty arena; an exiting watcher
  flees instead of holding the perimeter and charging through the
  tableau; the loop applies the core's `timeScaleOf`, so the tableau opens
  in slow motion as the design doc says; the `dropPod` sound plays once per
  launch step in the live bank and the offline score, one engine sweep for
  the one craft the renderer draws, instead of once per pod.
- The dropship and its pods borrow their lights from the pool too (#103).
- Weapon muzzle flashes, tracers and the beam re-tuned under the HDR
  composer so they read without blooming out (#28).
- Review sweep for #51 and #52, after the owning pull requests merged:
  - Every point light comes from a fixed pool of twelve in the scene from
    the first frame (`src/render/lights.ts`), so a bolt, a beam, an
    explosion or an enemy no longer recompiles every lit material on its
    way in and out (R2). Each strider has its own eye material and shares
    the muzzle geometry; rigs release their light and materials when they
    leave the scene (R7).
  - The particle pool uploads only the slots born since the last frame and
    no longer registers its start positions twice (R6); the renderer's hot
    path writes into scratch objects instead of allocating per frame (R5).
  - Renderer randomness is seeded (`src/render/random.ts`), grenade spin
    follows simulation time, and a new arena resets the head-bob baseline,
    so `?record` captures are reproducible frame for frame (R9).
  - A player falling onto a cover block lands on its top and is grounded
    there (C3); a shot is announced before the kill it causes (C6); the
    playtest counts a wave cleared when the player dies in the pause after
    it (C7).
  - A trackpad notch that arrives as several wheel events is one weapon
    swap (I4); a click on the canvas asks for pointer lock again after a
    refusal (I6).
  - The combat pulse rides the audio clock with a short look-ahead and is
    not scheduled while the context is suspended, so an interruption no
    longer fires a burst of stacked beats on resume (A2); a brick-wall
    limiter closes the master bus of the game and of the offline score
    (A3, set by the numbers, not yet by ear); the score stops on `pagehide`
    and the context suspends in a hidden tab (A5); the pulse stays down
    through the death window (A6, not yet listened to). The offline score's
    comment now lists every way its mix differs from the live bank (A4).
  - `pnpm test:e2e` builds first (T7); coverage thresholds rise to 97%
    lines and 90% branches with a test for `recordRound` without storage
    (T9); the recording scripts share a preview starter with `--strictPort`,
    a readiness poll and `try/finally`, the score's WAV lives in a
    temporary directory, and a resumed reel retakes its last frame (T10).
  - The contributing guide and the issue chooser point at the custom
    domain (#52, item 18).

- Player-facing copy agrees with the code (#97, pass A): the title card says
  five waves, not eight; the README controls table lists swap once and
  names Esc as Pause like the card; the Play line no longer says the site
  is not live; the frame captions date the capture to 17:40 UTC on
  2026-10-21, since the seed-7 timeline has moved.
- Documentation sweep of the second audit's deferred findings (#54): the
  VFX rules quoted from a live source, a login-walled course link dropped,
  the ringworld sentence restated from its sources, two journey frames
  renamed to the minute captured, and the freeze counts re-read after the
  last merges.

- The bot no longer fires a hitscan weapon at a target it cannot see (#93).
  On the reel seed, 94 of its 210 shots in the first 60 s went into cover
  with the target on the tracker only; the tracer and flash read as a shot
  through the wall. It now holds fire without line of sight (the launcher
  still fires over cover, the beam keeps a charge it holds) and walks at a
  target behind cover instead of waiting. The hit point of every shot and
  beam was already at the first obstacle; the balance baseline is re-derived
  in `tests/balance/gate.ts`.

- Design and UX review (#53): HUD labels and card copy never below 14 px and
  scale to 4K; the card is a dialog that names Victory, Defeat or Paused and
  takes focus when it returns; low ammo, an empty magazine and a kill are
  signalled in words or size, not colour alone; a
  `prefers-reduced-motion` rule stops the looping pulses.

- Still too much flare after the bloom prefilter: bloom strength and radius
  halved again (0.15, 0.25), the flare ghosts at 0.3 opacity and the core
  sprite at two thirds of its size, and the day and dawn skies given a
  thinner, tighter mie lobe so the sun reads as a disc; facing the sun the
  saturated blob went from 13% to 3% of the frame height (#71).

- Adversarial software review (#51): a death in the same step as the last
  kill is no longer overwritten by victory; blasts spare spawning enemies
  as shots do; the fixed-step loop drops, rather than defers, steps past
  its per-frame cap; resuming after Esc keeps the look direction and shows a pause card; one-shot key latches are cleared on reset; the beam
  charge hum is cut on victory and whenever the overlay returns; the
  arena rebuild and expired explosion and death effects dispose their GPU
  resources; a zero-height viewport no longer puts NaN in the projection;
  the recorder refuses frame rates that do not divide 60, as the audit
  claimed it already did; the purity test and the Biome denied-globals
  list cover `crypto`, `globalThis`, `structuredClone`, `Intl`, timers,
  storage and `console`; the Pages deploy is a job in the CI workflow that runs only after every other job is green; the
  browser smoke tests fail on page errors in every test and check for a
  WebGL 2 context; `tests/scratch/` is ignored by git, Biome and tsc.

- The bot no longer fires the launcher when cover sits inside the blast
  radius (#36).
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
- Escalating waves with countdowns, clear bonuses, a victory state, and
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
