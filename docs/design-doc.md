---
type: design-doc
title: "Ringfall: WebGL arena shooter"
status: draft
authors: ["Ringfall hackathon team"]
reviewers: []
created: 2026-10-21
approved: 2026-10-21
---

# Ringfall: WebGL arena shooter

## Overview

Ringfall is a single-player first-person arena shooter that runs in a
browser tab with no install and no assets to download. The player defends a
walled arena against eight waves of enemies using a rifle, grenades, and a
regenerating energy shield, under a ringworld arc on the horizon. It was
built in a three hour hackathon window to the
[crefft](https://github.com/agh/crefft) engineering standards: strict
TypeScript, a tested pure simulation core, pinned dependencies, and CI that
deploys to GitHub Pages.

## Context and Scope

### Background

The prompt was "a WebGL game inspired by a classic sci-fi console shooter, in
a browser, in three hours." The genre's defining feel is not its content but
its loop: a shield that recharges when you break contact, enemies that force
you to break contact, and a rhythm of engage, retreat, recover. That loop is
cheap to build and easy to test, so it is the product.

### Goals

- **G1:** Playable in a desktop browser with WebGL 2 and pointer lock, from a
  static host, with no backend.
- **G2:** The shield-and-health loop: shield absorbs first, recharges after a
  delay out of combat, health never regenerates.
- **G3:** Two enemy archetypes that create different pressure: one that closes
  and one that fires dodgeable projectiles from range.
- **G4:** Eight waves with escalating composition, a clear-wave pause, a win
  state, and a lose state that loops back to the title.
- **G5:** The simulation is unit-tested to a coverage threshold without a
  browser; the browser layer has smoke coverage in real Chromium.
- **G6:** Every dependency and GitHub Action is pinned to an exact version or
  commit SHA.

### Non-Goals

- **NG1:** Multiplayer or networking of any kind. The only persistence is the
  player's personal bests in their own browser's local storage.
- **NG2:** Mobile or touch controls.
- **NG3:** Vehicles, multiple weapons, or pickups.
- **NG4:** Imported art, audio, or any franchise material (see
  [ADR-0003](adr/0003-original-ip-only.md)).

## Design

### System Architecture

```text
┌──────────────┐   InputFrame    ┌──────────────────────────┐
│  src/input   │───────────────▶ │  src/core  (pure)        │
│ keyboard,    │                 │  stepGame(state, input,  │
│ mouse, lock  │                 │           dt, rng)       │
└──────────────┘                 │  → GameState + events    │
                                 └─────┬──────────┬─────────┘
                                       │ state    │ events
                     ┌─────────────────┼──────────┼──────────────────┐
                     ▼                 ▼          ▼                  ▼
              ┌────────────┐   ┌────────────┐  ┌────────────┐  ┌────────────┐
              │ src/render │   │  src/hud   │  │ src/audio  │  │  tests/    │
              │ three.js   │   │ DOM + 2D   │  │ WebAudio   │  │ unit + e2e │
              └────────────┘   └────────────┘  └────────────┘  └────────────┘
```

`src/main.ts` owns the loop. Each animation frame it adds the elapsed wall
time to an accumulator and calls `stepGame` with a fixed `dt` of 1/60 s
while at least that much time is banked, capped at five steps per frame so a
backgrounded tab does not fast-forward on return. After stepping it hands
the events to the renderer, HUD, and audio bank, then renders.

### Simulation model

`GameState` is immutable. A step creates a mutable draft, runs these stages
in order, and freezes the result:

<!-- design-check: simulation -->

1. **Player movement.** Wish direction from yaw and WASD, speed 6 m/s (9 when
   sprinting forward), gravity 18 m/s², jump impulse 6 m/s. The player is a
   vertical cylinder (radius 0.4 m, height 1.8 m, eye at 1.7 m). Each axis is
   resolved separately against cover boxes and the arena boundary, which
   yields wall sliding. The ground height under the player is the top of any
   box they stand on.
2. **Weapon.** The rifle holds 32 rounds with 160 in reserve, fires every
   0.1 s for 20 damage with 120 m range, and reloads in 1.8 s. A shot is a
   ray against enemy spheres and cover boxes; the nearest surface wins, so
   cover blocks bullets. Spread is 0.004 rad standing and 0.012 rad moving.
3. **Grenades.** Four per life. Thrown at 14 m/s plus a 2 m/s upward boost,
   2.5 s fuse, gravity 18 m/s², 35 % restitution. Floor contact scrubs 45 %
   of horizontal speed so a throw lands near its aim point rather than
   skating across the arena. The blast deals 150 damage at the centre
   falling linearly to zero at 6 m, and half that to the thrower.
4. **Enemies.** Each enemy is a small state machine (`spawning`, `chase`,
   `attack`, `flee`, `dead`). Spawning lasts 1 s and the enemy is invulnerable and
   visibly descending during it, so the player has a beat to react. Only
   skimmers enter `flee`, and only when a strider dies near them.
5. **Bolts.** Strider projectiles travel at 22 m/s for up to 3 s, stop on
   cover, the floor, and the arena edge, and hit a 0.9 m sphere around the
   player's centre.
6. **Waves.** A 3 s countdown, an active phase until all enemies are dead, a
   2.5 s cleared pause, then the next wave. Wave 8 cleared is victory.
7. **Vitality.** Damage hits the shield first (100), then health (100). The
   shield recharges at 35/s after 4 s without damage. Health never recharges.

<!-- /design-check: simulation -->

### Enemy archetypes

<!-- design-check: enemies -->

| Archetype | Health | Speed  | Attack                          | Behaviour                                        | Score |
| --------- | ------ | ------ | ------------------------------- | ------------------------------------------------ | ----- |
| Skimmer   | 40     | 7 m/s  | Melee zap, 12 dmg every 0.9 s   | Closes to 2 m with lateral jitter so packs fan out | 100   |
| Strider   | 120    | 3 m/s  | Bolt, 18 dmg every 1.4 s        | Holds 8 to 16 m, backs off when crowded, aims at the current eye position with 4 % spread | 300 |

The rifle kills a skimmer in two shots and a strider in six. Two skimmers in
contact strip a full shield in about four seconds; one strider's volley is
dodgeable by strafing because the bolt takes roughly half a second to cross
its range.

<!-- /design-check: enemies -->

### Rout

<!-- design-check: rout -->

The first "the AI is thinking" moment: when a strider dies, every skimmer
within 25 m of it (`FLEE_RADIUS`, XZ distance from the strider) breaks and
runs. Values are the `FLEE_*` constants in `src/core/enemy.ts`.

| Number                 | Value                   | Why                                                                                   |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Trigger                | strider `enemyKilled`   | Skimmer deaths rout nobody; a pack losing its leader is the one legible cause        |
| Radius                 | 25 m                    | Covers a whole pack spawned on the 26 m ring without reaching across the arena       |
| Duration               | 4 s (`FLEE_DURATION`)   | Long enough to be seen and shot at, short enough that wave 2 stays under 10 % slower |
| Speed                  | 1.3x (9.1 m/s)          | Faster than a sprinting player (9 m/s), so the gap opens instead of closing           |
| Heading                | straight away from the player | Reads as fear, not as a flank; cover and the arena edge stop it                |
| Attacks while fleeing  | none                    | The reward for the kill is a breather                                                 |
| After                  | `chase`                 | It comes back, which is what makes the next strider kill worth repeating              |
| Second strider death   | refreshes the 4 s       | Routs do not stack                                                                    |
| Spawning or dead       | unchanged               | A descending skimmer is not yet in the fight                                          |

Each rout emits `enemyFled { id, kind }` and then `enemyBark { id, line }`
for the same skimmer, after the strider's `enemyKilled` in the same step.
The lines are the three originals in `BARK_LINES`: the first skimmer of a
rout always calls "LEADER DOWN", the rest draw from the set with the
simulation's seeded `Rng`. A strider death with no skimmer within 25 m
routs nobody and barks nothing. Fleeing skimmers stay hittable and count
as alive for the wave. The posture (tilt, faster ring, a floating label
for 1.2 s) and the squeal belong to the render and audio layers, which
consume these events.

Balance, twenty seeded games per profile (`pnpm balance`), before and
after the rout. Wave 2 is the first wave with a strider and the gate from
the issue: no more than 10 % slower for the steady profile.

| Profile  | Wave 2 clear before | Wave 2 clear after | Win rate before | Win rate after |
| -------- | ------------------- | ------------------ | --------------- | -------------- |
| steady   | 15 s                | 16 s               | 15 %            | 30 %           |
| reckless | 13 s                | 14 s               | 0 %             | 10 %           |

<!-- /design-check: rout -->

### Weapons

<!-- design-check: weapons -->

Values are `WEAPON_SPECS` in `src/core/weapon.ts`; spread is in radians,
standing / moving. Damage falls linearly from full at the falloff start to
20 % of full (`FALLOFF_FLOOR`) at the falloff end. A minigun fires at 25 %
of its full rate (`MINIGUN_IDLE_RATE`) until it has spun up.

| Kind     | Magazine | Reserve | Fire interval | Reload | Damage        | Range | Spread        | Pellets | Falloff    | Charge | Spin-up | Projectile |
| -------- | -------- | ------- | ------------- | ------ | ------------- | ----- | ------------- | ------- | ---------- | ------ | ------- | ---------- |
| Rifle    | 32       | 160     | 0.1 s         | 1.8 s  | 20            | 120 m | 0.004 / 0.012 | 1       | none       | none   | none    | no         |
| Laser    | 12       | 60      | 0.35 s        | 2 s    | 45            | 160 m | 0 / 0.004     | 1       | none       | none   | none    | no         |
| Scatter  | 6        | 36      | 0.6 s         | 2.4 s  | 14 per pellet | 30 m  | 0.09 / 0.09   | 8       | 6 to 14 m  | none   | none    | no         |
| Beam     | 4        | 16      | 1.2 s         | 2.6 s  | 160           | 100 m | 0 / 0.002     | 1       | none       | 0.8 s  | none    | no         |
| Launcher | 3        | 12      | 0.9 s         | 2.8 s  | 110           | 60 m  | 0 / 0.006     | 1       | none       | none   | none    | yes        |
| Minigun  | 120      | 0       | 0.045 s       | 0 s    | 9             | 90 m  | 0.03 / 0.03   | 1       | none       | none   | 0.5 s   | no         |

- **Rifle.** The starting weapon and the baseline: accurate, forgiving, never
  dropped, and good enough to finish a run with.
- **Laser.** Slow and exact: one shot kills a skimmer and three kill a
  strider at any range, so it rewards standing still and punishes spraying.
- **Scatter.** Eight pellets that delete a skimmer in one shot inside 6 m and
  do almost nothing past 14 m, so it is the answer to a pack at the door.
- **Beam.** Hold to charge for 0.8 s, release to pierce every enemy in a
  line; it stops only at cover and exists to turn a strider column into one
  shot.
- **Launcher.** A fast, flat round that bursts on contact with a 4.5 m
  blast; the only weapon that hits around the player's aim, and the one that
  hurts them if they fire it at their feet.
- **Minigun.** A single 120-round belt with no reserve and no reload, slow
  until it has spun up for half a second; it is borrowed firepower that runs
  out.

<!-- /design-check: weapons -->

### Wave composition

<!-- design-check: waves -->

Wave *n* spawns `2 + n` skimmers and `floor(n / 2)` striders on a 26 m ring
around the arena centre, avoiding cover. Clearing a wave is worth 500. The
roster for the eight waves:

| Wave | Skimmers | Striders |
| ---- | -------- | -------- |
| 1    | 3        | 0        |
| 2    | 4        | 1        |
| 3    | 5        | 1        |
| 4    | 6        | 2        |
| 5    | 7        | 2        |
| 6    | 8        | 3        |
| 7    | 9        | 3        |
| 8    | 10       | 4        |

<!-- /design-check: waves -->

### Arena

<!-- design-check: arena -->

A 60 m square with transparent boundary walls and 16 procedurally placed
cover blocks (2 to 6 m footprint, 1.5 to 4 m tall), none within 6 m of the
centre so the spawn point is open. Layout is seeded; the seed comes from the
clock in production and is fixed in tests.

<!-- /design-check: arena -->

### Presentation

- **Renderer.** three.js `WebGLRenderer` into an HDR, multisampled
  `EffectComposer`: render pass, `UnrealBloomPass` with its threshold above
  1.0 so only emitters bloom, a custom feel pass (vignette, chromatic
  aberration that grows with damage, a hexagonal shield lattice that flares
  on hits, grain), then `OutputPass` for ACES tone mapping at exposure 0.38.
  Lighting is a sun, a hemisphere fill, and image-based lighting baked from
  the sky itself with `PMREMGenerator`, with exponential fog; the values
  come from the atmosphere rig below and blend over three seconds when the
  wave changes.
- **Atmosphere.** `waveAtmosphere(wave)` in `src/core/waves.ts` gives each
  wave a time of day and a weather from `ATMOSPHERE_TABLE`: 1 day, 2 night,
  3 dusk and rain, 4 night and fog, 5 dawn, 6 day and rain, 7 dusk, 8 night
  and rain, then the table repeats. `src/render/environment.ts` holds one
  rig per time of day (sun elevation and azimuth, sun colour and intensity,
  hemisphere colours, fog colour and density, star opacity, exposure, moon,
  ring glow, image-based-lighting intensity, dust) and two weather overlays:
  rain greys the sun, thickens the cloud deck and fog, and streams 1,500
  stretched drops a second through the particle pool with splashes at the
  floor; fog raises the density to 0.018 so a 40 m enemy keeps about half
  its contrast. Day is the 3500 K sun at 11 degrees with fog at 0.0032
  (unchanged from the first renderer); night puts the sun a degree under the
  horizon, lights the arena with a moon at 48 degrees and the ring's own
  glow, and lifts exposure from 0.38 to 0.55. `?atmo=night` and
  `?weather=rain` pin either part for review.
- **Environment.** A scattering sky (three.js `Sky`, turbidity 4). The ring
  is a 6 km torus with a 360 m tube, centred 5.2 km overhead so its near
  side is buried and the arc rises from both horizons; its inner face is a
  procedural ocean, land, and cloud texture with a bright metal rim. Rolling
  terrain (flat-shaded, vertex-coloured by height) with mountains from 500 m
  out. 1,600 stars that survive daylight at low opacity.
- **Particles.** One `Points` draw call with 12,000 slots; the CPU writes
  birth state once and the vertex shader integrates position, drag, and
  gravity, so sparks, smoke, bolt trails, and explosions cost nothing per
  frame on the CPU.
- **Enemies.** Skimmers are flattened octahedra with a spinning emissive
  ring and a warm core that pulses when attacking; striders are
  four-legged capsule walkers with a cannon, a Rose lens that goes white
  while charging, and a walk cycle. Spawning enemies descend from six
  metres over one second. Dead enemies squash and tilt for 1.2 s, then
  despawn with a kill ring and a spark burst.
- **Weapons on screen.** `src/render/weapons.ts` builds one viewmodel rig
  per kind under the camera and draws the active one in 0.25 s
  (`DRAW_TIME`); each has its own accent colour, muzzle flash sprite and
  light, and tracer: a 1 px line for the laser, eight pellet traces for the
  scatter, a glowing cylinder with sparks along it for the beam, a smoking
  round and a drum that turns a notch per shot for the launcher, a spinning
  barrel cluster for the minigun. Pickups (`src/render/pickups.ts`) are an
  emissive emblem over a post with a kind-coloured billboard halo and a 2 m
  column whose alpha fades to nothing at the top, no light of their own (so
  the scene's light count, and with it every compiled material, is the same
  before and after a spawn), a ring on the ground when they land and when
  they are taken, and a fade over the last three seconds of their life.
- **Effects.** Impact sparks, recoil on the viewmodel, kill rings, and camera
  shake on damage and blasts capped at 0.035 rad. An explosion is five things
  with their own clocks, so it reads at any distance and never whites out:
  a sprite flash (a radial-gradient sprite at 0.6 opacity, gone in 120 ms,
  `EXPLOSION_FLASH_LIFE`) and a 140-intensity point light that decays to
  nothing in 250 ms; a shockwave crest (a thin torus that expands to 1.3
  blast radii in 450 ms and flattens as it goes); 32 debris sparks and 22
  dark chips that arc under 14 to 16 m/s² of gravity for about a second; a
  smoke column of 56 alpha-blended puffs that rises, grows and thins over
  1.5 s, with a 30-puff skirt rolling out along the floor; and a scorch
  decal (a black disc with a ragged alpha map) that holds on the floor for
  4 s (`SCORCH_LIFE`) and fades over its second half. A kill borrows the
  dead enemy's own light colour for its ring (0.3 opacity, so it is never
  brighter than the accent it copies) and its shell colour for a short
  burst of sparks, chips and a puff; the corpse squash-and-tilt is
  unchanged. A blast within six metres of the camera is scaled down with
  distance (`near`) so a launcher round at the player's feet does not blind
  the frame. Particle sprites come in three shapes (`spark`, `smoke`,
  `shard`); the pool blends premultiplied alpha so sparks add to the frame
  exactly as before and smoke and chips can darken it. Sprites are capped
  at 64 px and fade inside two metres of the eye. Measured on the seed 7
  run as it stood before the bot's launcher clearance rule (#36) moved its
  launcher shots, at a launcher kill 3 m away (`?record&bot&seed=7&post`,
  then t = 47.0 s), mean frame luminance was 106 by day and 101 at night
  (budget 150 and 110); the first kill at night (t = 10.0 s) went from 59
  to 32. Hit-stop of 50 ms (skimmer kill), 90 ms (strider kill) and
  120 ms (shield break) slows the simulation to 5 % in `src/main.ts`.
- **HUD.** DOM elements updated every frame: wave and enemies left, score,
  shield and health bars, ammo with a low-ammo colour, grenade pips, centre
  announcements, a hit marker, a damage vignette, and a pulsing border when
  the shield is down. The motion tracker is a 150 px canvas showing enemies
  and bolts within 28 m, rotated to the player's heading.
- **Audio.** Every sound is an oscillator sweep or filtered noise burst
  created on demand. The context is unlocked on the first click.

### Input

Pointer lock is requested on Deploy. Mouse movement adjusts yaw and pitch at
0.0022 rad per pixel, pitch clamped just short of vertical. Held keys are
read live each step; reload and grenade are latched so a key press between
two steps is never lost. Esc releases the lock and the game returns to the
overlay, where the run can be resumed with another click.

The title overlay carries a settings panel whose values persist under the
local-storage key `ringfall.settings.v1` (`src/core/settings.ts`). Corrupt or
blocked storage yields the defaults, which equal the behaviour before the
panel existed.

| Setting | Range | Default | Applied to |
| ------- | ----- | ------- | ---------- |
| Sensitivity | 0.5 to 2.0 × | 1.0 (0.0022 rad per pixel) | `InputController.setSensitivity` |
| Field of view | 70 to 100 degrees | 78 | `SceneRenderer.setBaseFov`; sprint still adds 6 |
| Screen shake | on / off | on | `SceneRenderer.setShakeEnabled`: off sets the shake cap to 0 rad |
| Hit flash | on / off | on | `SceneRenderer.setFlashEnabled` (hex shield lattice) and the HUD damage flash |

## Alternatives Considered

### Option A: Deterministic lockstep with interpolation

Rejected for the window: rendering interpolated positions between fixed
steps smooths motion at low frame rates, but at 60 Hz steps on a 60 Hz
display the gain is invisible. The accumulator design leaves the door open.

### Option B: Enemy pathfinding

Rejected: a navmesh or grid A* is a day of work. Enemies instead move
straight at the player with axis-separated sliding, which makes them hug and
round cover convincingly enough for an arena with convex blocks.

## Security Considerations

- No network calls after page load. The only stored data is the player's
  personal bests in local storage on their own device; nothing is sent anywhere.
- No third-party scripts; the only runtime dependency is three.js, pinned.
- CI actions are pinned to commit SHAs and checkouts do not persist
  credentials. The Pages deploy job holds the only write permission.
- `pointerlock` and `AudioContext` are gated behind a user gesture, as
  browsers require.

## Testing Strategy

- **Unit (Vitest, Node).** Every module in `src/core/` is covered
  (`playtest.ts` through the bot tests). Coverage thresholds: 85 % lines,
  functions, and statements, 75 % branches; the actual figures are printed by
  `pnpm test` and quoted in the pull request with the command that produced
  them.
- **Playtest (Vitest, Node).** A scripted player (`src/core/bot.ts`) plays
  whole games through `src/core/playtest.ts`; tests assert determinism per
  seed, first-wave clearance, accuracy, and that the steady and reckless
  profiles differ. See [test-plan.md](test-plan.md).
- **Recording.** `scripts/record-demo.mjs` films a seeded bot run frame by
  frame and `scripts/render-score.mjs` renders its soundtrack offline from
  the same event timeline; the film is reviewed and logged in
  [journey/](journey/README.md).
- **End-to-end (Playwright, Chromium).** Loads the built page, asserts the
  title and overlay, starts a game, checks the simulation clock advances, and
  confirms no page errors. It deliberately does not wait for the first wave,
  which software GL cannot reach in time; wave spawning is proven headlessly.
  A second test holds W and asserts the player moved. These run against
  `vite preview`.
- **Static.** Biome in CI mode and `tsc --noEmit` with every strict option.

## Rollout Plan

1. Pull request from `feat/ringfall-webgl-arena` into `main` with CI green.
2. Merge; the Pages workflow builds `dist/` and publishes it.
3. Tag `v2026.10.0` once the deployed page has been played through to wave 8.

## Open Questions

- [ ] Should striders lead their shots using player velocity? Currently they
      aim at the current eye position with a fixed spread.
- [ ] Is 8 waves the right length for a demo? A `FINAL_WAVE` constant makes
      this a one-line change.
- [ ] Gamepad support via the Gamepad API would fit the input layer; it was
      out of the three hour window.
