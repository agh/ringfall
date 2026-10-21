---
type: adr
title: "Ship only original names, assets, and audio"
status: approved
created: 2026-10-21
authors:
  - name: "Ringfall hackathon team"
---

# ADR-0003: Ship only original names, assets, and audio

## Status

Accepted

## Context

The game is "inspired by" a well-known console shooter franchise. Inspiration
is the mechanics and mood: a recharging shield, a ring on the horizon, a
deliberate pace. The franchise's names, characters, logos, models, sounds,
and music are trademarked and copyrighted. Hackathon code is published under
MIT and deployed to a public URL, so anything in the repository is
redistributed.

## Decision

Use original names throughout (Ringfall, skimmer, strider). Generate every
visual from three.js primitives and procedural textures. Synthesize every
sound with WebAudio. Do not load, vendor, or link to third-party game assets.
Describe the inspiration in prose without naming the franchise in code,
metadata, or marketing copy.

## Consequences

### Positive

- The repository is safe to publish and deploy under MIT.
- No asset pipeline: zero load time, no licensing table to maintain.

### Negative

- The look is low-poly and the audio is chiptune-adjacent. That is a style
  choice the HUD and skybox lean into.

### Neutral

- Future contributors who want higher-fidelity art must bring assets with a
  compatible license and record them in a `THIRD_PARTY_NOTICES.md`.

## Alternatives Considered

### Fan-made asset packs

Rejected: most are derivative works of the franchise and carry no license
that permits redistribution.

### Commercial CC0 packs

Deferred: compatible, but selecting and integrating them does not fit the
window. The `src/render/` layer is the only place that would change.
