---
type: adr
adr: "ADR-0002"
title: "Keep the simulation a pure function, separate from rendering"
status: accepted
date: 2026-10-21
deciders: ["Ringfall hackathon team"]
---

# ADR-0002: Keep the simulation a pure function, separate from rendering

## Status

Accepted

## Context

The crefft testing guide requires unit tests that are fast, isolated, and
free of I/O, and the TypeScript guide expects coverage to be measured. A game
whose logic lives inside three.js objects can only be tested by booting a
browser, which is slow and makes coverage meaningless.

Games are also notoriously hard to debug when state is scattered across scene
graph nodes, timers, and event handlers.

## Decision

All gameplay lives in `src/core/` as pure functions over immutable data.
`stepGame(state, input, dt, rng)` returns a new `GameState` and a list of
`GameEvent`s describing what happened. The renderer, HUD, and audio bank
consume state and events; they never mutate them. Randomness comes from a
seeded generator passed in by the caller. Time advances in a fixed 1/60 s
step driven by an accumulator in `src/main.ts`.

## Consequences

### Positive

- The core runs in Node. The unit suite covers it to a threshold and runs in
  about one second.
- Any bug is reproducible from a seed and an input sequence.
- Presentation features (a sound, a particle, a HUD flash) attach to an
  event and never touch the simulation.
- Frame rate does not affect physics or AI.

### Negative

- Every step allocates new objects. At this entity count (tens of enemies,
  a few bolts) the cost is negligible; a much larger game would need pooling.
- Some presentation state (recoil, screen shake, effect lifetimes) still
  lives in the renderer, because it is not gameplay.

### Neutral

- The browser layer is verified by Playwright smoke tests rather than unit
  tests; that is the right tool for pointer lock and WebGL initialisation.

## Alternatives Considered

### Entity-component-system library

Rejected: an ECS brings its own scheduling and query model, which is
over-engineering for a dozen entity types, and would need its own learning
curve inside the window.

### Logic on three.js objects

Rejected: untestable without a browser, and state becomes implicit in the
scene graph.
