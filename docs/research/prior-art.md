---
type: research
title: "Prior art: browser FPS and WebGL games, what they got right, what to reuse"
status: reference
authors: ["Ringfall research agent (Claude), reviewed by the hackathon team"]
created: 2026-10-21
---

# Prior art: browser WebGL games

A research note produced during the hackathon by a delegated agent and
reviewed by the team. Where a page could not be read the gap is stated, not
guessed. This note informs [ADR-0002](../adr/0002-pure-simulation-core.md)
and the renderer backlog.

## Comparison

| Project | Live / Source | Engine | What is visible | Architecture notes | Tests |
| ------- | ------------- | ------ | --------------- | ------------------ | ----- |
| three.js `games_fps` example | [example][games-fps-live] / [source][games-fps-src] (MIT) | three.js | ACES tone mapping, VSM shadows, fog, hemisphere plus directional light | `deltaTime = min(0.05, dt) / 5` sub-steps; `Capsule` vs `Octree`; 100 pre-allocated spheres recycled by index; `camera.rotation.order = 'YXZ'`; pointer lock on mousedown | none |
| webgl-quake3 (Brandon Jones, 2010) | [demo][q3-live] / [source][q3-src] | hand-written WebGL | Q3 shader scripts compiled to GLSL, lightmap atlas, one VBO | BSP parsed in a Web Worker; no culling because JS-side PVS was slower than brute GPU draw ([blog][q3-blog]) | none |
| QuakeJS (inolen) | [site][quakejs] / [source][quakejs-src] (MIT) | ioquake3 via Emscripten | ioq3 renderer as-is | WebSocket netcode; asset repack | none |
| Dwasm (PrBoom+ to wasm) | [demo][dwasm] / [source][dwasm-src] (GPL-2.0) | Emscripten + SDL2 | software renderer | about 1 MB gzip excluding resources; OPL2 synth keeps it small | none |
| Halo CE decomp in browser | [demo][halo-mobile] / [source][halo-mobile-src] (CC0) | Emscripten, WebGL 2 | Blam renderer | OffscreenCanvas in a worker, OPFS saves, COOP/COEP service worker | none |
| HexGL (Despoulain, 2012) | [site][hexgl] / [source][hexgl-src] (MIT) | three.js | bloom, hex vignette, quality tiers | 2D collision map sampled from a canvas image instead of a physics engine ([slides][hexgl-slides]) | none |
| Bruno Simon folio-2019 | [site][bruno] / [source][bruno-src] (MIT) | three.js, cannon, howler | baked-texture look | `Application`, `World`, `Resources`, `Camera` split; physics separated from visuals | none |
| instagib-arena (2025) | [site][instagib] / [source][instagib-src] (AGPL-3.0) | three.js, React HUD, Node ws | not described | 64 Hz sim; `src/game/*` modules do not depend on three.js; snapshots carry only numbers; sounds synthesised with Web Audio | typecheck, lint, netcode load tests |
| drift-arena (2025) | [source][drift-src] | three.js, TypeScript, Vite | not described | `shared/game.ts` holds movement, colliders, weapon constants; client predicts with the same sim | movement and server checks |
| After the Flood (PlayCanvas, 2017) | [demo][atf] | PlayCanvas WebGL 2 | transform-feedback particles, 3D-texture clouds, HDR + MSAA, runtime lightmaps ([blog][atf-blog]) | asset streaming | n/a |
| Krunker, Shell Shockers, Venge, TANX | closed | three.js, Babylon, PlayCanvas | commercial ceiling for browser FPS | n/a | n/a |

Also examined: the Google Pac-Man doodle (zero-friction onboarding: auto-start
after ten seconds, [Wikipedia][pacman]); Infinitown (three.js, reportedly
86 KB of code, [site][infinitown]); the Halo CE wasm port needing the
user's own XISO ([Notebookcheck][halo-wasm]).

## Architecture lessons for a pure core and reactive shell

**Who separates simulation from rendering.** Only the netcode projects do,
because the server forces them to: instagib-arena's game modules "do not
depend on Three.js" and its snapshots "carry only numbers"; drift-arena
runs "the same movement simulation as the server" on the client. That is
exactly Ringfall's `stepGame(state, input, dt, rng)` shape, validated by two
shipped games. Both also have the only automated tests in the survey,
because a three-free sim is trivially testable in Node. Keep `GameState`
numeric and serialisable; it makes replay, a headless bot and a future
multiplayer free.

**Where everyone else couples.** The three.js FPS example mutates
`camera.rotation` from `mousemove` and stores collider and mesh on the same
object. HexGL's physics is a canvas lookup inside the ship controller. The
wasm ports are monoliths by construction. "Events out, reactions in" is
rare, and Ringfall's design is unusual in a good way.

**Timestep.** Gaffer's accumulator is the canonical fixed-step loop
([Fix Your Timestep][gaffer]); instagib and drift run fixed 64 and 60 Hz
ticks. A fixed `dt` is also what makes `rng` plus input replay
deterministic.

**Allocation discipline.** Every demo converged on pooling. For an
immutable-state core the main tension is structural sharing: copy only the
arrays that changed.

**Collision.** For a pure core, do what HexGL did: author the arena as data
and collide analytically; let the shell build meshes from the same
description.

**Audio as event reaction.** instagib synthesises its sounds at runtime with
Web Audio. Zero-asset audio maps one-to-one onto an event stream and
sidesteps licensing.

## Rendering techniques by wow per hour (three.js 0.186, WebGLRenderer)

1. Tone mapping, sRGB, fog, two lights (5 min): the `games_fps` recipe.
2. PMREM environment (3 lines): PBR specular without an HDRI download
   ([RoomEnvironment][roomenv]).
3. `Sky` addon as background and environment source (10 min)
   ([Sky][sky]).
4. `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass` (15 min)
   ([UnrealBloomPass][bloom]).
5. `InstancedMesh` for everything repeated (15 min).
6. Ambient occlusion via N8AO (20 min, measurable GPU cost) ([N8AO][n8ao]).
7. Particles (20 to 30 min): three.quarks, or a hand-rolled `Points` burst.
8. Lens flare on the sun (5 min) ([Lensflare][lensflare]).
9. God rays (30+ min): expensive and finicky; do last.
10. SDF text in-scene (10 min, optional) ([troika][troika]).

## How we go faster: drop-in pieces

| Piece | Licence | Minutes |
| ----- | ------- | ------- |
| `games_fps` loop, capsule controller, pool, pointer-lock code ([source][games-fps-src]) | MIT | 10 |
| `RoomEnvironment` + `PMREMGenerator` ([docs][roomenv]) | MIT | 2 |
| `Sky` ([source][sky]) | MIT | 10 |
| `UnrealBloomPass`, `OutputPass`, `EffectComposer` ([docs][bloom]) | MIT | 10 |
| N8AO ([repo][n8ao]) | CC0 | 10 |
| three.quarks ([repo][quarks]) | MIT | 20 |
| three-mesh-bvh ([repo][bvh]) | MIT | 20 |
| Gaffer fixed-timestep loop ([article][gaffer]) | pattern | 5 |
| Web Audio synthesised SFX pattern ([instagib][instagib-src]) | AGPL: re-implement, do not copy | 15 |

Procedural-first assets keep the Vite bundle near three.js's own size and
remove the asset pipeline from the critical path.

## Failure modes and known fixes

**Pointer lock.** Must come from a user gesture. After the user exits via
Esc, "an event generated as a result of an engagement gesture must be
received by the document before `requestPointerLock` will succeed"
([MDN][pointerlock]). Chrome enforces a cooldown after Esc. Fix: on
`pointerlockchange` with no element, pause and show a "click to resume"
overlay; never relock in a loop; clamp pitch in the core. Request
`{ unadjustedMovement: true }` and fall back ([web.dev][unadjusted]).

**Audio autoplay.** An `AudioContext` created before a gesture starts
suspended; resume it in the click handler ([Chrome blog][autoplay]). The
click that acquires pointer lock is the same gesture.

**First-frame shader stutter.** `renderer.compileAsync(scene, camera)`
plus one warm-up render behind the start overlay
([three.js forum][compile]).

**GC pauses.** Per-frame `new Vector3()` and closures in the loop; hoist
scratch objects, pool bullets and particles ([MDN][webxr-perf]).

**Tab backgrounding.** `requestAnimationFrame` pauses in background tabs;
clamp the first delta on return, pause on `visibilitychange`, suspend the
`AudioContext` too ([MDN rAF][raf]; [bugnet][visibility]).

**Resize and DPR.** Update camera aspect, renderer size and composer size;
cap `devicePixelRatio`.

## Sources

[games-fps-live]: https://threejs.org/examples/#games_fps
[games-fps-src]: https://github.com/mrdoob/three.js/blob/dev/examples/games_fps.html
[q3-live]: http://media.tojicode.com/q3bsp
[q3-src]: https://github.com/toji/webgl-quake3
[q3-blog]: https://blog.tojicode.com/2010/08/rendering-quake-3-maps-with-webgl-tech.html
[quakejs]: http://www.quakejs.com
[quakejs-src]: https://github.com/inolen/quakejs
[dwasm]: https://gmh-code.github.io/dwasm/
[dwasm-src]: https://github.com/GMH-Code/Dwasm
[halo-mobile]: http://halo.omgithub.com/
[halo-mobile-src]: https://github.com/OMG-Guest/Halo-Mobile
[hexgl]: https://hexgl.bkcore.com/
[hexgl-src]: https://github.com/BKcore/HexGL
[hexgl-slides]: https://www.slideshare.net/slideshow/html5-game-dev-with-threejs-hexgl/14357478
[bruno]: https://bruno-simon.com
[bruno-src]: https://github.com/brunosimon/folio-2019
[instagib]: https://instagib.win
[instagib-src]: https://github.com/8tp/instagib-arena
[drift-src]: https://github.com/dc3344/drift-arena
[atf]: https://playcanv.as/p/44MRmJRU/
[atf-blog]: https://blog.playcanvas.com/mozilla-launches-webgl-2-with-playcanvas/
[pacman]: https://en.wikipedia.org/wiki/Pac-Man_Google_Doodle
[infinitown]: https://littleworkshop.fr/projects/infinitown/
[halo-wasm]: https://www.notebookcheck.net/Halo-Combat-Evolved-now-playable-with-web-browser-for-free.1412338.0.html
[gaffer]: https://gafferongames.com/post/fix_your_timestep/
[roomenv]: https://threejs.org/docs/pages/RoomEnvironment.html
[sky]: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Sky.js
[bloom]: https://threejs.org/docs/pages/UnrealBloomPass.html
[n8ao]: https://github.com/N8python/n8ao
[lensflare]: https://threejs.org/docs/pages/Lensflare.html
[troika]: https://github.com/protectwise/troika/tree/main/packages/troika-three-text
[quarks]: https://github.com/Alchemist0823/three.quarks
[bvh]: https://github.com/gkjohnson/three-mesh-bvh
[pointerlock]: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API
[unadjusted]: https://web.dev/articles/disable-mouse-acceleration
[autoplay]: https://developer.chrome.com/blog/autoplay/
[compile]: https://discourse.threejs.org/t/reduce-first-render-lag-renderer-compileasync-is-not-doing-anything/86191
[webxr-perf]: https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Performance
[raf]: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
[visibility]: https://bugnet.io/blog/fix-web-game-page-visibility-change-pauses-raf-but-not-audio

- <https://github.com/mrdoob/three.js/blob/dev/examples/games_fps.html>
- <https://blog.tojicode.com/2010/08/rendering-quake-3-maps-with-webgl-tech.html>
- <https://github.com/inolen/quakejs>
- <https://github.com/GMH-Code/Dwasm>
- <https://github.com/OMG-Guest/Halo-Mobile>
- <https://github.com/BKcore/HexGL>
- <https://github.com/brunosimon/folio-2019>
- <https://github.com/8tp/instagib-arena>
- <https://github.com/dc3344/drift-arena>
- <https://blog.playcanvas.com/mozilla-launches-webgl-2-with-playcanvas/>
- <https://gafferongames.com/post/fix_your_timestep/>
- <https://threejs.org/docs/pages/RoomEnvironment.html>
- <https://threejs.org/docs/pages/UnrealBloomPass.html>
- <https://github.com/N8python/n8ao>
- <https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API>
- <https://developer.chrome.com/blog/autoplay/>
- <https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>

Unverified in the session: Space Pirates licence text, webgl-quake3 and
drift-arena licences, Master Blaster's WebGPU claim. GitHub API calls were
blocked from the research sandbox, so stars and push dates were not
collected.
