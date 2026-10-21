---
type: spec
title: "Ringfall Chapter 1: specification, Minimum Lovable Product, and what is Later"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall Chapter 1: specification

> [Ringfall](../README.md) > Specification

This document is the contract for the demo. It says what Chapter 1 is, what
"lovable" means for each part, and what is explicitly deferred. The
engineering numbers live in [design-doc.md](design-doc.md); the look and
sound in [brand.md](brand.md); the evidence in [research/](research/); the
verification in [test-plan.md](test-plan.md). The backlog in GitHub Issues
mirrors this document: the MLP epic is #2, the Later epic is #3.

## One paragraph

Ringfall is a browser-native first-person arena shooter. You stand on the
inner surface of a ring at dawn, inside a walled arena, with a rifle, four
grenades, and an energy shield that recharges when you stop getting hit.
Waves of two kinds of enemy come at you. The demo is meant to last five to ten minutes and end on a victory tableau; today the victory camera lifts the gaze to the ring and the tableau text is not built (#8). Everything is procedural: no assets, no
franchise material, no backend.

## The loop we are building

A three-second loop inside a thirty-second loop inside a three-minute loop.

- **Three seconds:** aim, fire, hit-marker, kill chime.
- **Thirty seconds:** engage, take fire, shield breaks, break contact,
  enemies ease off, shield recharges, re-engage with a grenade.
- **Three minutes:** a wave arrives, escalates, breaks, is cleared, and the
  next arrives with something new.

Every feature below is judged by whether it makes one of those loops
better. Features that add content without changing a loop are Later.

## Minimum Lovable Product

"Lovable" means a first-time player, with no instructions beyond the title
card, has a moment in the first thirty seconds that they would describe to
a friend. Each MLP item names that moment.

| # | Item | The moment | Status | Issue |
| - | ---- | ---------- | ------ | ----- |
| 1 | Shield break as an event: hit-stop, flare, vignette, enemies ease off | "It let me breathe." | Partial (flare, vignette) | #4 |
| 2 | Weapon juice: kick, recoil, tracer, hit-flash, sway, bob | "The gun feels good." | Done | n/a |
| 3 | Skimmers flee when a strider dies, with a bark | "They noticed." | Done (`src/core/enemy.ts`, #40) | #5 |
| 4 | Striders dive from grenades and sidestep | "It dodged my grenade." | Not started | #6 |
| 5 | Firing points for striders | "They take positions." | Not started | #7 |
| 6 | The ring overhead, dawn sky, terrain, fog | "Where am I?" | Done | n/a |
| 7 | Procedural chant, calm and combat states, stingers | "What is that music?" | Partial (drone, states) | #9 |
| 8 | Five named waves, drop-pods, victory tableau | "It had an ending." | Not started (eight uniform waves today) | #8 |
| 9 | Title choreography and the Deploy moment | "Oh, nice." | Not started | #9 |
| 10 | Brand compliance (fonts, tokens, banner) | Consistency, not a moment | Partial (fonts and tokens in HUD v2; the compliance pass is #10) | #10 |
| 11 | Frame budget on an integrated GPU | It runs on the laptop in the room | Not measured | #11 |
| 12 | Playtest bot as a CI gate | We know it is fair | Done (`tests/balance/`, CI job `Balance gate`, #39) | #12 |
| 13 | Demo recording pipeline | The awards reel | Done (recorder, offline score, mux); CI artifact not | #13 |
| 14 | Easter eggs: temperaments, sector number, crouch, switch | "IYKYK." | Core done (temperaments, Sector 117, crouch and bark, switch scoring); glyph, tint and chime are render and audio follow-ups | #14 |
| 15 | Personal bests in the browser: this round against your previous best score, deepest wave, runs and clears | "I got further." | Done (`src/core/records.ts`, localStorage, nothing leaves the device) | n/a |
| 16 | Six weapons, pickups during waves, two slots with a swap key | "What does this one do?" | Done (`src/core/weapon.ts`, `src/core/pickups.ts`) | #16 |

## Later (explicit choices)

| Item | Why deferred | Issue |
| ---- | ------------ | ----- |
| Melee | Needs a telegraph and a reason; promote after the shield event. | #15 |
| Third enemy and encounter spice | Base dance first. | #17 |
| Mobile, WebGPU, co-op | No loop change; platform work. | #18 |
| Vehicles, campaign, second arena | A second game. | #3 |

## What shows mastery

**Engineering.** The simulation is a pure function with a seeded random
source. The same `stepGame` powers the human game, a headless bot that
plays hundreds of games a minute for balance numbers, a Playwright smoke
test in real Chromium, and a frame-exact demo recorder that steps the sim
once per captured frame regardless of GPU speed. Determinism is the
foundation; the rest is free. See [ADR-0002](adr/0002-pure-simulation-core.md).

**Design.** The world is one lighting idea executed consistently: a low
warm sun against a cold atmosphere, with every warm pixel meaning
something. The ring is geometry you stand on, not a backdrop. The shield is
the whole HUD's reason to exist. See [brand.md](brand.md).

## Easter eggs (proposed)

Subtle, non-infringing, recognizable to people who know games:

- Four skimmer temperaments (chaser, ambusher, flanker, skittish), the
  four-ghost idea applied to a shooter, and it also improves the AI.
- The arena is "Sector 117". No explanation.
- A crouch that, toggled three times over a dead strider, earns a
  one-word bark from a survivor.
- One hidden glyph per arena that awards points and a seven-note chime.
- The title drone is in the sacred register with an original line; nothing
  is quoted.

## Non-goals

Multiplayer, mobile, imported art or audio, difficulty settings, an
endless mode, anything that interrupts the first thirty seconds. The only
persistence is personal bests in the player's own browser.
