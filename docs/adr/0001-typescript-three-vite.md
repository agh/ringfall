---
type: adr
title: "Use TypeScript, three.js, and Vite for the browser game"
status: approved
created: 2026-10-21
authors:
  - name: "Ringfall hackathon team"
---

# ADR-0001: Use TypeScript, three.js, and Vite for the browser game

## Status

Accepted

## Context

The brief is a WebGL first-person shooter that runs in a browser, built in a
three hour hackathon window, to the house engineering standards in
[crefft](https://github.com/agh/crefft). Those standards already define a
TypeScript toolchain (Biome, strict `tsc`, Vitest, Playwright) with pinned
versions, so any other language would spend part of the window on tooling
with no guidance behind it.

Raw WebGL requires shader programs, buffer management, a camera matrix
stack, and a lighting model before the first triangle appears. A game engine
such as Unity or Godot exports to the web, but adds a multi-minute build
step, a large runtime, and an editor workflow that does not fit a
test-driven repository.

## Decision

Write the game in TypeScript 6.0.3 under strict compiler options. Render with
three.js 0.186.1 using its `WebGLRenderer`. Bundle and serve with Vite 8.3.5.
Pin every dependency to an exact version.

## Consequences

### Positive

- The crefft TypeScript guide applies directly: lint, format, type check,
  test, coverage, and CI snippets are copy-paste.
- three.js supplies the camera, lights, shadows, fog, geometry, and materials,
  so the window is spent on gameplay.
- Vite gives sub-second rebuilds during the hackathon and a static `dist/`
  that GitHub Pages hosts with no server.
- Playwright drives the built page in real Chromium, so WebGL initialization
  is verified, not assumed.

### Negative

- three.js is ~550 kB minified in a single chunk. Acceptable for one scene;
  a larger game would code-split.
- three.js tracks browser APIs closely and removes options between releases
  (`PCFSoftShadowMap` was already gone at 0.186). Upgrades need a visual check.

### Neutral

- WebGPU is available in three.js through a separate renderer. The brief asks
  for WebGL and WebGL has wider support; swapping renderers later is a
  one-file change in `src/render/scene.ts`.

## Alternatives Considered

### Raw WebGL 2

Rejected: the shader and matrix plumbing alone would consume most of the
window, with no tested gameplay to show for it.

### Babylon.js

Rejected: comparable capability, but a heavier bundle and no existing house
guidance. three.js has more community examples for FPS-style controls.

### Unity or Godot web export

Rejected: multi-minute builds, editor-centric workflow, large runtime, and no
way to unit test gameplay logic in Node under the house testing standard.
