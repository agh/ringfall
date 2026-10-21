# Ringfall

A browser-native first-person arena shooter built on WebGL. Hold the arena,
survive eight waves, and keep an eye on the ring.

Ringfall takes its cues from the classic console sci-fi shooter loop: a
regenerating energy shield over fixed health, a two-second rhythm of fire,
cover, recharge, and grenades that bounce before they go off. It is an
original work. No names, assets, audio, or lore from any commercial franchise
are used.

## Play

The `main` branch deploys to GitHub Pages on every push. Locally:

```bash
pnpm install --frozen-lockfile
pnpm dev            # http://localhost:5173
```

| Action         | Input              |
| -------------- | ------------------ |
| Move           | W A S D            |
| Look           | Mouse              |
| Fire           | Left click         |
| Grenade        | G or right click   |
| Reload         | R                  |
| Jump / Sprint  | Space / Shift      |
| Release mouse  | Esc                |

Requires a browser with WebGL 2 and pointer lock.

## How it works

The simulation is a pure function over immutable state. `stepGame` in
`src/core/game.ts` takes the current state, one frame of input, a fixed
timestep, and a seeded random source, and returns the next state plus the
events that happened during the step. Everything else reacts to those events:

- `src/render/` mirrors the state into a three.js scene and plays effects
- `src/hud/` draws vitals, ammo, wave status, and a motion tracker in the DOM
- `src/audio/` synthesises every sound with WebAudio oscillators
- `src/input/` turns keyboard, mouse, and pointer lock into an `InputFrame`

Because `src/core/` never touches the DOM or WebGL, it is unit-tested in Node
to a coverage threshold. The browser layers are covered by Playwright smoke
tests in real Chromium.

Design decisions and gameplay numbers are documented in
[docs/design-doc.md](docs/design-doc.md) and [docs/adr/](docs/adr/).

## Develop

```bash
pnpm lint           # Biome (lint + format, CI mode)
pnpm typecheck      # tsc --noEmit, strict
pnpm test           # Vitest unit tests with V8 coverage thresholds
pnpm test:e2e       # Playwright smoke tests against a production preview
pnpm build          # Type check and Vite production build to dist/
pnpm check          # All of the above except e2e, in CI's order
```

Contributor guidance for people and coding agents lives in
[AGENTS.md](AGENTS.md). Engineering standards follow
[crefft](https://github.com/agh/crefft): Conventional Commits, calendar
versioning (`YYYY.M.N`), Keep a Changelog, exact dependency pins, and
SHA-pinned GitHub Actions.

## Stack

| Concern   | Tool                 |
| --------- | -------------------- |
| Language  | TypeScript 6.0.3     |
| Rendering | three 0.186.1 (WebGL)|
| Bundler   | Vite 8.3.5           |
| Lint      | Biome 2.5.12         |
| Unit      | Vitest 5.0.0         |
| E2E       | Playwright 1.64.1    |
| Hosting   | GitHub Pages         |

## License

[MIT](LICENSE).
