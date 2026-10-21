# The journey

A time-indexed log of how Ringfall was built in one hackathon morning, with
the frames that were captured along the way. Times are UTC on 2026-10-21.
Each entry says what was tried, what was seen, and what was decided, so a
reader can follow the reasoning and not just the result. Images live in
`images/` and are named by the time they were captured.

## The story, not the straight line

The morning had three acts, and the second one started with a correction.

**Act one: a working game in forty minutes.** The first decisions were
made fast and have held: TypeScript on the house toolchain, three.js on
WebGL, a simulation written as a pure function so it could be tested in
Node, original names and procedural art only. The core (collision, rifle,
grenades, two enemies, waves, shields) was written and tested before a
single triangle was drawn. The first renderer was deliberately plain: flat
boxes, a dark sky, a torus on the horizon. It shipped as a draft PR at
14:30 with CI, a Pages deploy, and ninety-nine percent line coverage.

**The correction.** The brief that followed was blunt: the graphics were
not pushing boundaries, and the project needed a product backlog, a brand,
a journey log, a demo film, and a way for the agent to play the game rather
than screenshot it. The first renderer had been a call made for speed; it
was the wrong level of ambition for the demo, and that was named plainly.
Rather than polish the v1 scene, it was rewritten.

**Act two: the renderer rewrite, and three bugs in a black frame.** The
second renderer (scattering sky, a ring you stand on, terrain, image-based
lighting, GPU particles, an HDR composer with bloom and a feel pass) came
up black. It took forty minutes and a dozen headless captures with URL
flags to split that one symptom into three unrelated faults: the camera was
inside the ring's tube; the first animation frame after Deploy carried a
negative delta that made every decay term grow until the lights blew out;
and the terrain under the arena was fighting the floor in the depth buffer
at range. Each fix was small. Finding them was the work. Most flags were removed afterwards; `?nopost`, the uniform probe, and the `ringfallDebug` global stayed as documented diagnostics.

**Act three: the game plays itself.** Determinism paid off. The same seeded
`stepGame` that a person drives became a bot's playground: a headless
harness measures win rate and wave clear times in seconds, a Playwright run
proves the real stack in a real browser, and a recorder steps the sim once
per captured frame so the film plays at the right speed on a software GPU
that renders at under one frame per second. The soundtrack is rendered
offline from the same event timeline, which is why audio recorded minutes
later lines up with the frames.

Meanwhile three research agents ran in parallel and came back with sourced
reports on the design philosophy being borrowed, the browser prior art, and
a brand system. Their findings became the specification, the brand doc,
and seventeen GitHub issues, each with acceptance criteria a person can
check.

### Calls that were made, then overruled

- **A plain first renderer.** Chosen for speed; judged insufficient for the
  demo. Rewritten in act two. The lesson recorded in the spec: the first
  thirty seconds are the product.
- **Eight uniform waves.** A formula was faster to write than a composition
  table. The research on pacing says five named beats with a late
  spectacle. Deferred to issue #8 rather than done in the window; the
  constant is one line.
- **Screenshots as proof of play.** Replaced by the bot, the harness, and
  the recorder. Screenshots remain as evidence, not as the test.
- **One squashed commit for act two.** Everything from the renderer to the
  docs landed in a single commit because the clock mattered more than
  history. Later changes went back to one concern per commit.

## 14:08 Kick-off

The brief: a WebGL game inspired by a classic console shooter, in a
browser, three hours, to the crefft engineering standards. First decisions
within ten minutes: TypeScript, three.js on WebGL, Vite, a pure simulation
core so the game logic is unit-testable in Node, original names and
procedural art only.

## 14:08 to 14:27 Core and first renderer

The simulation (`src/core/`) was written first: vector helpers, a seeded
random source, arena generation with sliding collision, hitscan against
spheres and boxes, a shield-over-health model with a recharge delay, a
magazine-fed rifle, bouncing grenades, two enemy archetypes, slow bolts,
and the wave state machine. Forty-five unit tests, 99% line coverage. The
first renderer was flat-shaded boxes under a dark navy sky with a torus on
the horizon.

![Title screen, version one](images/1427-title-v1.png)

The first in-game frame confirmed the loop worked end to end: HUD, radar,
ring, enemies closing in.

## 14:30 First push, draft PR, research dispatched

Six Conventional Commits, CI with SHA-pinned actions, a GitHub Pages deploy,
and a draft PR. Three research agents were dispatched in parallel: Halo's
design philosophy and an MLP cut, prior art in browser WebGL games, and a
brand system. Their reports are under [`../research/`](../research/) and
[`../brand.md`](../brand.md).

## 14:34 to 15:05 Renderer v2 and three bugs

The brief said "10x more sophisticated". The second renderer added a
scattering sky, a ring you actually stand on (six kilometres in radius,
sunk below the horizon so it rises on both sides and crosses overhead),
rolling terrain with mountains at the rim, image-based lighting from the
sky, a GPU particle pool, an HDR composer with bloom, a custom feel pass
(vignette, chromatic aberration, hex shield lattice), composite enemy rigs,
and weapon sway, bob, and recoil.

It rendered black. Three separate faults, found by bisecting with URL
flags and headless screenshots:

1. **The camera was inside the ring.** The torus tube was larger than the
   amount it was sunk below the floor, so the inner surface wrapped the
   player. Fix: sink the ring further than the tube radius.
2. **A negative frame delta.** The first animation frame after Deploy
   carried a timestamp earlier than the clock set in `start()`, so every
   decay term (recoil, muzzle light, damage flare) ran backwards and grew
   without bound. The scene went white and the HDR target looked broken.
   Fix: clamp the delta at zero. The uniform probe that found it is still
   in the code.
3. **Terrain fighting the floor.** The terrain under the arena sat 0.6 m
   below the floor, but with a 0.08 m near plane and a 40 km far plane the
   depth buffer could not separate them at ten metres. Fix: sink the inner
   terrain six metres.

![Renderer v2 before terrain, direct path](images/1450-renderer-v2-first-light.png)

![The negative-delta bug as seen through the post stack](images/1455-negative-dt-bug.png)

![Terrain depth fixed, direct path](images/1458-terrain-depth-fixed.png)

## 15:05 Procedural score

A choir drone in D minor (three detuned oscillators per voice, vowel
formant filters drifting between "ah", "oh" and "oo", a synthesised
cathedral impulse response) with calm and combat buses that crossfade on
wave state. No samples anywhere.

## 15:06 The bot that plays the game

`src/core/bot.ts` turns the immutable state into an `InputFrame` the way a
person would: bounded turn rate, aim jitter, strafe bursts, bolt dodging,
retreat on low shield, grenades at clusters. `src/core/playtest.ts` runs it
headless at 60 Hz and reports win rate, accuracy, shield breaks, and
per-wave clear times. Because the sim is deterministic, the same seed
drives balance measurement, browser smoke tests, and the demo film.

## 15:14 Renderer v2 with the post stack, working

![Post stack working: sun, bloom on trims, ring, mountains](images/1514-renderer-v2-post.png)

## 15:17 Backlog landed

Seventeen GitHub issues: an MLP epic with eleven children (shield-break
event, enemy theatre, grenade dives, firing points, five named waves,
stingers and title choreography, brand compliance, frame budget, playtest
gate, demo pipeline, easter eggs) and a Later epic with four explicitly
deferred items. Each child has context, scope, acceptance criteria, and an
out-of-scope line.

## 15:20 Recording the demo

`scripts/record-demo.mjs` opens the built page with `?record&bot&seed=7`,
steps the simulation a whole number of ticks per captured frame (the
frame rate must divide 60; an earlier run at 24 fps rounded to three ticks
and played a fifth too fast, which the audit caught), and assembles the
frames with ffmpeg. On a software GPU the capture runs far slower than
real time; the film still plays at the right speed because the sim is
stepped, not timed.

## 15:30 Soundtrack without a clock

Headless Chromium cannot play audio, and the live score schedules against
wall-clock time. `src/audio/offline.ts` re-runs the same seed headlessly to
recover the event timeline, schedules every voice, drum and effect into an
`OfflineAudioContext`, and returns a WAV that `scripts/render-score.mjs`
muxes into the silent capture. Determinism makes the audio line up with
frames rendered minutes apart.

## 15:45 HUD v2 and the full-tab experience

The second presentation pass: Deploy requests fullscreen, the HUD is
sized in viewport units so it fits any laptop, a segmented shield arc sits
over the health arc, the tracker sweeps, a compass strip shows heading
and hostile bearings, damage segments orbit the reticle pointing at the
source, the magazine is drawn as pips, and the brand fonts and tokens are
finally applied. The renderer gained a sun flare, airborne dust, hit-stop
on kills and shield breaks, death and victory cameras, and a frame-time
driven resolution scaler. The first flare used the three.js addon and
failed on the multisampled target; it was replaced with sprites.

## 15:50 The audit

An unanchored reviewer audited the whole repository for agent slop and
scored it two and a half out of five: real code, clean prose, but
documents running ahead of the code and one real bug in the recorder's
frame stepping. The findings and what was done with each are in
[audit.md](../audit.md). The one that stung: the bot "sees what a human
sees" sentence was false (it read enemy health and targeted enemies
beyond the tracker). It is true now.

### Balance baseline

First printed run of `pnpm balance` after the bot was made fair, twenty
seeds per profile, 480 s cap:

| Profile | Win rate | Mean waves cleared | Mean seconds | Accuracy | Shield breaks |
| ------- | -------- | ------------------ | ------------ | -------- | ------------- |
| Steady | 0% | 3.40 | 342 | 41% | 0.40 |
| Reckless | 0% | 3.55 | 302 | 38% | 0.45 |

No profile reaches wave eight. Either the bot is too weak or the later
waves are too hard for a five-to-ten-minute demo; issue #8 (five named
waves) and #12 (the balance gate) decide which. Until then this table is
the baseline every tuning change is measured against.

## 16:05 Coach, not player

The sixth ask was five things at once: day and night per wave, a
ninety-second story reel, six weapons with a swap key, weather, a custom
domain, and a change of role: dispatch to agents, review their outcomes,
land the code. Four streams were cut with disjoint file ownership so they
could not collide: A owned the environment and the lighting hook in the
scene, B1 the simulation, input and HUD for weapons, B2 the weapon
viewmodels, pickup meshes and sounds (started after B1 landed), C the
reel script and its cards. The coach's job became reading hand-backs,
checking frames, running the gates and writing commits. Two things went
wrong with that. A checkpoint commit made to satisfy the stop hook swept
an agent's scratch harness into the tree and broke CI lint for one run.
And a brief that said both "wave 1 unchanged" and "day: sun at 35
degrees" was resolved by the agent in favour of the first; the right
call, flagged in its report, and the kind of ambiguity a coach should not
write.

## 16:45 "The flare when enemies explode is way too much"

The user watched the reel and said so. The fix was briefed to stream A
with exact numbers (explosion light 600 to 140, flash opacity 1.0 to
0.55, bursts halved) and landed, and the frame at the first kill at night
was still white. The agent ran out of budget and handed back an honest
"not this". The coach replayed seed 7 headlessly to find what fires at
that moment (a skimmer kill 8.3 m away and the wave clear, nothing else)
and then read the particle shader: a sprite's size is `size * 300 /
depth`, so each of the forty size-10 sparks was 375 px wide, additive,
with a three-times colour boost at the centre. Nobody had tuned a light
that mattered. Sprites are now capped at 64 px and fade within two metres
of the eye, blasts scale with distance from the camera, and the death
burst is sixteen motes. Mean frame brightness at that moment went from
204 to 61 on a scale of 255.

![Night kill, before: a whiteout](images/1652-night-kill-before.jpg)

![Night kill, after: a glow at the kill point](images/1700-night-kill-after.jpg)

## 16:56 Weapons in hand

Stream B2's viewmodels integrated with the scene by the coach from the
agent's snippet; the agent had written against a copy of the scene
because stream A owned the file. The beam rig at night and the scatter
gun with a pickup column beside it, from the deterministic run at seed 7:

![Wave 2 at night with the beam](images/1656-wave2-night-beam.jpg)

![Wave 3, the scatter gun and a pickup](images/1656-wave3-scatter-pickup.jpg)

## 17:13 Pickup glow without a light

Issue #29. Every pickup carried its own point light and a 3 m additive
column. Adding a light to a three.js scene changes the light count that
every lit material is compiled against, so the first pickup of a round
recompiled every shader (a hitch on real hardware), and the column
bloomed into a pillar that owned the frame from close up. The capture
hook at seed 7 shows the wave 3 reward land 5 m ahead at 41.9 s and the
bot walk into it by 42.5 s. The pickup is now an emissive emblem above
the bloom threshold, a billboard halo sprite, and a 2 m column whose
alpha falls off with the square of its height to zero at the top. A
Node test over the renderer counted zero lights under the pickup group
after a spawn, and the two take bursts dropped from sprite sizes 9 and
16 to 0.6 and 0.9, so a mote that has flown clear of the near fade stays
under the 64 px cap. Same frame, same tick, before and after:

![Pickup at 3 m, before: the column is a pillar](images/1713-pickup-column-before.jpg)

![Pickup at 3 m, after: an emblem with a halo and a short plume](images/1715-pickup-glow-after.jpg)

No pickup in the seed 7 run is ever seen from far away (rewards land 6 m
ahead and the bot walks into them), so the range check pushed a launcher
pickup into the live state through the `ringfall.state()` hook, 21 m
along the view at 43 s, night. It reads as a lime point on a post with
its plume, between the trims:

![Injected pickup at 21 m, night](images/1724-pickup-glow-21m-night.jpg)

## Playtest reviews

Each row is a human or agent watching the game play, not a screenshot.

| When | Seed | What was watched | Verdict |
| ---- | ---- | ---------------- | ------- |
| 17:00 | 7 | A 75 s bot run by day, frames every 3 s, and the night kill at 10 s, after the weapon integration | Weapon swaps read (beam at 18 s, scatter at 45 s, launcher at 48 s), pickup columns are visible from across the arena, the night frame keeps its stars and trims. The launcher round the bot fired at its own feet at 48 s still washes the frame pink with the shield-down effect; that is the jolt it should be, but the bot should not do it (issue for the bot: no launcher inside the blast radius). |
| 15:56 | 7 | The whole 49 s film with its offline score: title, deploy, waves 1 to 4 | Reviewed frame-by-frame at 8 s, 22 s and 46 s and watched end to end at speed: the sun flare and bloom carry the opening, the bot's first kill lands at 4.8 s, wave 2 brings the first strider and bolts, the HUD reads at 720p. Weak points: around 8 s the bot turns into the sun and the frame whites out for about two seconds (this capture predates the exposure and haze reduction and HUD v2), and the bot stands in the open while reloading. Shipped as the first reel; a second capture with the current build was started at 16:00. |
| 15:29 | 7 | Frames 100 to 225 of the first capture (wave 1, 24 fps) | Bot kills two skimmers by 8 s, loses the third behind cover and reloads in the open; the sun behind a slab blooms hard enough to hide the reticle for a second. Readable, dramatic, slightly over-bright. Exposure left as is for the reel; a bloom radius reduction is a candidate. |

![Wave 1, the sun behind a slab](images/1535-demo-seed7-wave1-sun.jpg)

![Wave 1, holding cover with one left](images/1535-demo-seed7-wave1-cover.jpg)
