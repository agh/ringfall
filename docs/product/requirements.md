---
type: prd
title: "Ringfall Chapter 1 product requirements"
status: draft
authors: ["Ringfall hackathon team"]
created: 2026-10-21
related: ["docs/spec.md", "docs/design-doc.md", "docs/test-plan.md", "docs/brand.md"]
---

# Ringfall Chapter 1 product requirements

> [Ringfall](../../README.md) > [Specification](../spec.md) > Requirements

## Purpose

This document turns the Minimum Lovable Product in [spec.md](../spec.md)
into player stories whose acceptance criteria name the test layer in
[test-plan.md](../test-plan.md) that proves them. Every number cited is
owned by [design-doc.md](../design-doc.md) or [brand.md](../brand.md).

## Audience

The player opens a link on a desktop browser with no instructions beyond
the title card. The judge is that player with a stopwatch and an integrated
GPU. The engineer is anyone, human or agent, judging whether a change makes
one of the three loops better.

## Pillars

**The shield is the game.** Every system exists to make losing the shield
and getting it back a legible, repeatable event the enemies respect.

**Enemies are actors, not targets.** A skimmer or strider must show what it
is about to do, and what it has noticed, loudly enough that a first-time
player reads it.

**One image, one sound.** The ring at dawn and the chant are the two things
a player should carry out of the room, so nothing on screen or in the mix
competes with them.

## The core loop

The player stands at the centre of a 60 m walled arena among sixteen cover
blocks. After a three second countdown a wave descends on a 26 m ring
around them, each enemy taking one invulnerable second to land. Skimmers
close at 7 m/s and zap for 12 damage every 0.9 s; striders hold 8 to 16 m
and fire bolts for 18 damage every 1.4 s. Damage strips a 100 point shield
first and 100 points of health second. When the shield breaks the screen
flares and the enemies ease off; four seconds without damage starts a
35 point per second recharge, and the player re-engages, often with one of
four bouncing grenades. Clearing the wave pauses the arena for 2.5 s, then
the next wave arrives with something new, until the final wave ends on a
victory tableau.

## Player stories

Each story is followed by its acceptance criteria and the layer that proves
them: unit, playtest bot, Playwright, or visual review.

### The first thirty seconds

**S1.** As a first-time player, I see a live scene behind the title and a
single Deploy button so that I know what to do without reading. Accepted
when the built page shows the wordmark, one line of copy and the Deploy
control (Playwright), and the overlay choreography in brand.md plays in
the first three seconds (visual review).

**S2.** As a first-time player, I click Deploy and the mouse locks, the HUD
slides in and a three second countdown runs, so that the game starts in one
gesture. Accepted when Playwright starts a game and sees the first wave
spawn with no page errors, and the HUD stagger and recharge sting are
confirmed in the demo film (visual review).

**S3.** As a first-time player, I kill a skimmer in two rifle shots inside
the first wave so that the gun feels good before I am in danger. Accepted
when unit tests prove 20 damage against 40 health and the 50 ms hit-stop
event fires on the kill, and the steady bot clears wave one on every tested
seed (playtest bot).

### The shield loop

**S4.** As a player under fire, I see my shield absorb damage before my
health so that I understand which bar matters. Accepted when unit tests
prove damage ordering and that health never regenerates.

**S5.** As a player whose shield has just broken, I feel the game pause
and the enemies ease off so that I know to break contact. Accepted when a
unit test proves the shield-break event with its 120 ms hit-stop and the
aggression drop, and visual review confirms the flare and vignette.

**S6.** As a player behind cover, I watch the shield return after four
seconds at 35 per second so that I learn the rhythm. Accepted when unit
tests prove the delay and rate, and the bot's recorded seconds with the
shield down fall within the thresholds in the playtest (playtest bot).

### A wave

**S7.** As a player facing a strider, I can strafe its bolt and bounce a
grenade at it, and see it dive, so that the exchange feels like a
conversation. Accepted when unit tests prove bolt speed, the 2.5 s fuse and
the dive impulse, and the bot's grenade accuracy is reported (playtest
bot).

**S8.** As a player who has just killed a strider, I see the skimmers flee
with a bark so that I know they noticed. Accepted when a unit test proves
the flee state on strider death and the demo film shows it readably
(visual review).

**S9.** As a player, I meet something new each wave so that no thirty
seconds repeats. Accepted when the composition table in design-doc.md is
reproduced by unit tests and each named wave's beat is logged in the
journey (visual review).

### The ending

**S10.** As a player who clears the last wave, I get a tableau that tilts to
the ring and resolves the music so that the demo has an ending. Accepted
when a unit test proves the victory state on the final wave, and visual
review confirms the tableau and the gain ramp.

## Non-functional requirements

**Performance.** On an integrated GPU at 1080p the frame holds 16.7 ms,
with the scene under 7 ms, bloom under 2 ms and the feel pass under 0.5 ms,
per the feel research note in [research/](../research/). These are targets
until spec item 11 measures them.

**Accessibility.** A toggle sets the screen shake cap to zero. Every HUD
colour pairing meets the contrast ratios in brand.md, and no text sits
below 14 px. The game is playable with keyboard and mouse only, and no
action depends on a sound cue alone.

**Compatibility.** Desktop browsers with WebGL 2 and pointer lock. Mobile
and WebGPU are Later.

**Privacy.** No network calls after page load, no third-party scripts, no
analytics, no storage of any kind.

## Traceability

| Story | Spec MLP item |
| ----- | ------------- |
| S1, S2 | 9 Title choreography and the Deploy moment; 10 Brand compliance |
| S3 | 2 Weapon juice |
| S4, S5, S6 | 1 Shield break as an event |
| S7 | 4 Striders dive from grenades and sidestep |
| S8 | 3 Skimmers flee when a strider dies |
| S9 | 5 Firing points; 7 Procedural chant and stingers; 8 Five named waves |
| S10 | 8 Five named waves, drop-pods, victory tableau |
| Performance | 11 Frame budget on an integrated GPU |
| All | 12 Playtest bot as a CI gate; 13 Demo recording pipeline |

## Open questions

Whether five named waves replace the eight uniform ones or sit on top of
them is undecided; design-doc.md lists a `FINAL_WAVE` constant as the lever.
The shake toggle has no home in the HUD yet. Whether the strider should
lead its shots is open in design-doc.md and affects how dodgeable S7 feels.
