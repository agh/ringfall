---
type: design-doc
title: "Ringfall: WebGL arena shooter"
status: approved
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

- **NG1:** Multiplayer, networking, or persistence of any kind.
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
   `attack`, `dead`). Spawning lasts 1 s and the enemy is invulnerable and
   visibly descending during it, so the player has a beat to react.
5. **Bolts.** Strider projectiles travel at 22 m/s for up to 3 s, stop on
   cover, the floor, and the arena edge, and hit a 0.9 m sphere around the
   player's centre.
6. **Waves.** A 3 s countdown, an active phase until all enemies are dead, a
   2.5 s cleared pause, then the next wave. Wave 8 cleared is victory.
7. **Vitality.** Damage hits the shield first (100), then health (100). The
   shield recharges at 35/s after 4 s without damage. Health never recharges.

### Enemy archetypes

| Archetype | Health | Speed  | Attack                          | Behaviour                                        | Score |
| --------- | ------ | ------ | ------------------------------- | ------------------------------------------------ | ----- |
| Skimmer   | 40     | 7 m/s  | Melee zap, 12 dmg every 0.9 s   | Closes to 2 m with lateral jitter so packs fan out | 100   |
| Strider   | 120    | 3 m/s  | Bolt, 18 dmg every 1.4 s        | Holds 8 to 16 m, backs off when crowded, leads with 4 % spread | 300 |

The rifle kills a skimmer in two shots and a strider in six. Two skimmers in
contact strip a full shield in about four seconds; one strider's volley is
dodgeable by strafing because the bolt takes roughly half a second to cross
its range.

### Wave composition

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

### Arena

A 60 m square with transparent boundary walls and 16 procedurally placed
cover blocks (2 to 6 m footprint, 1.5 to 4 m tall), none within 6 m of the
centre so the spawn point is open. Layout is seeded; the seed comes from the
clock in production and is fixed in tests.

### Presentation

- **Renderer.** three.js `WebGLRenderer` into an HDR, multisampled
  `EffectComposer`: render pass, `UnrealBloomPass` with its threshold above
  1.0 so only emitters bloom, a custom feel pass (vignette, chromatic
  aberration that grows with damage, a hexagonal shield lattice that flares
  on hits, grain), then `OutputPass` for ACES tone mapping at exposure 0.38.
  Lighting is a 3500 K sun at 11 degrees elevation, a hemisphere fill, and
  image-based lighting baked from the sky itself with `PMREMGenerator`.
  Exponential fog at density 0.0032.
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
- **Effects.** Tracers (70 ms), impact sparks, a muzzle point light, recoil
  on the viewmodel, grenade explosions (expanding sphere with a 300 cd point
  light over 450 ms), kill rings, and camera shake on damage and blasts.
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

- No network calls after page load; no user data is collected or stored.
- No third-party scripts; the only runtime dependency is three.js, pinned.
- CI actions are pinned to commit SHAs and checkouts do not persist
  credentials. The Pages deploy job holds the only write permission.
- `pointerlock` and `AudioContext` are gated behind a user gesture, as
  browsers require.

## Testing Strategy

- **Unit (Vitest, Node).** Every module in `src/core/` has a test file.
  Coverage thresholds: 85 % lines, functions, and statements, 75 % branches.
  Current run: 49 tests, 99.8 % lines, 97.9 % branches via `pnpm test`.
- **Playtest (Vitest, Node).** A scripted player (`src/core/bot.ts`) plays
  whole games through `src/core/playtest.ts`; tests assert determinism per
  seed, first-wave clearance, accuracy, and that the steady and reckless
  profiles differ. See [test-plan.md](test-plan.md).
- **Recording.** `scripts/record-demo.mjs` films a seeded bot run frame by
  frame and `scripts/render-score.mjs` renders its soundtrack offline from
  the same event timeline; the film is reviewed and logged in
  [journey/](journey/README.md).
- **End-to-end (Playwright, Chromium).** Loads the built page, asserts the
  title and overlay, starts a game, waits for the first wave to spawn, checks
  the simulation clock advances, and confirms no page errors. A second test
  holds W and asserts the player moved. These run against `vite preview`.
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
