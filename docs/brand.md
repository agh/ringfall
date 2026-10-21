---
type: design-doc
title: "Ringfall brand and design system"
status: approved
authors:
  - name: "Ringfall research agent (Claude), reviewed by the hackathon team"
created: 2026-10-21
---

# Ringfall brand and design system

One recommendation per decision; alternatives marked "Alt". Values here are
the reference for `src/style.css`, the light rig in
`src/render/scene.ts`, and the README banner. Where the code and this
document disagree, fix the code or update this document in the same PR.

Status: the palette, typography, geometry and feel sections were checked
against the code in the brand compliance pass (issue #10) and the numbers
below are the ones the code carries. "Not yet in the code" marks a
recommendation that no module implements. Audio values are as designed
and were not re-verified against `src/audio/` in that pass.

## Visual identity

### Palette

| Token | Hex | Role | Contrast vs Abyss sky / vs Hull panel |
| ----- | --- | ---- | ------------------------------------- |
| Abyss | `#0b1a2e` | Sky zenith, page background, clear color | n/a |
| Beacon | `#7dd3fc` | Primary HUD accent, reticle, cover trims, shield | 10.5 / 9.9 (AAA) |
| Flare | `#fbbf24` | Health, low ammo, the player's own state | 10.5 / 9.9 (AAA) |
| Dawn | `#f6b26b` | Sun, horizon glow, sun-lit face tint | 9.6 / 9.1 (AAA) |
| Ring | `#b8d8ea` | The ringworld arc, far-fog lift, secondary text | 11.7 / 11.1 (AAA) |
| Bone | `#e8e4d8` | Body text, titles | 13.8 / 13.0 (AAA) |
| Rose | `#fb7185` | Damage taken, enemy emissive, threat | 6.5 / 6.1 (AA text, AAA large) |
| Hull | `#101f36` | HUD panel fill at 85% alpha (`--hull` is the 85% mix) | 1.06 vs sky: panels need a border |
| Slate | `#8aa0b8` | Muted text, panel borders, grid lines | 6.5 / 6.1 |

Thresholds per [WCAG 2.2 SC 1.4.3][wcag]. Rule: every panel gets a 1 px
Slate border; never rely on fill alone. Never place Beacon text on Ring or
Bone.

Every other color in `src/style.css` is derived from a token with
`color-mix()`: alpha variants (`color-mix(in srgb, var(--beacon) 45%,
transparent)`) and two lifts, `--beacon-lift` (Beacon half-mixed with Bone,
for hover and the bright end of the shield arc) and `--abyss-lift` (Abyss
with 12% Beacon, the overlay's center glow). The favicon is Beacon written
as a literal because a data URI cannot read a token. The 2D-canvas tracker
in `src/hud/hud.ts` writes Rose and Beacon as literals for the same reason.

The world's threat red is `#ff4d5a` (strider lens and its light), an HDR
emissive that tone-maps close to Rose; the HUD uses Rose itself. Skimmers
carry a warm amber ring (`#ffb347`, emissive `#ff8c1a`), the other side of
"warm means hostile" from the player's Flare. Pickups and the rifle carry
Beacon; enemies carry none.

### Color psychology

- The cold base (Abyss, Ring, Beacon) reads as composure and precision. The
  whole world is cold so the eye is drawn to the two warm exceptions.
- Flare is reserved for the player's own state: caution without alarm.
  Rose is reserved for threat: enemies and incoming damage. That single rule
  makes every warm pixel meaningful.
- Dawn is the narrative color: the sun is low, the day is starting, the
  ring is catching first light. Warm key against cool fill is what makes
  flat-shaded faces read as volume.

### three.js light rig

The values are the `day` preset in `src/render/environment.ts`, which is
the dawn rig the game opens on; `dawn`, `dusk` and `night` presets move the
sun and recolour the rig per wave, and rain and fog weathers grey it.

- Sun: `DirectionalLight` `#ffe2b8` (about 4500 K; warmer than the
  [Helland][helland] 3500 K first proposed, which read orange on the
  slabs), intensity 2.4, elevation 11 degrees, azimuth 205 degrees so the
  ring is backlit by the horizon. The `dawn` preset is Dawn itself at
  5 degrees. Shadow map 2048, PCF.
- Hemisphere: sky `#bfd8f5`, ground `#3b4a3a`, intensity 0.55 (the ground
  term carries the terrain's green).
- Fog: `FogExp2`, density 0.0032, color `#9fb8d0` between Abyss and the
  horizon band so geometry dissolves into the horizon rather than into the
  sky.
- Sky: scattering sky (three.js `Sky`) with turbidity 4, Rayleigh 2.2; the
  ring, sun and stars are excluded from fog.
- Bloom: `UnrealBloomPass` threshold 1.3 in HDR so ordinary lit albedo
  never blooms; only emissive trims and effects cross it, and only their
  excess over the threshold, capped at 1.5 per pixel, so the sun and a near
  sprite bloom like emitters rather than floodlights; strength 0.15, radius
  0.25. The day and dawn skies keep a thin, tight mie lobe (coefficient
  0.0008 and 0.002, g 0.93 and 0.92) so the sun is a disc, not an aureole.
  Tone mapping ACES Filmic, exposure 0.38 by day.

## Typography

- Display: **Chakra Petch**, SIL OFL 1.1 ([metadata][chakra]). Squared,
  slightly chamfered terminals say "machined" without the usual sci-fi
  cliché; counters stay open at small sizes.
- Body and HUD: **JetBrains Mono**, SIL OFL 1.1 ([metadata][jbmono]).
  Tabular numerals for free, so health and ammo never jitter.
- Alt: keep **Rajdhani** (OFL) as the display fallback.

Both families load from Google Fonts with `display=swap`; the fallback
stack is Rajdhani, Bahnschrift, Segoe UI for display and the system
monospace for body.

Rules: wordmark "RINGFALL" in Chakra Petch 700, uppercase, letter-spacing
0.14em. HUD labels Chakra Petch 600, uppercase, letter-spacing 0.16em to
0.22em (wider than the wordmark because they are small), never below
14 px. Hero numerals (shield, magazine) in Chakra Petch 700; the score and
every small count in JetBrains Mono with `font-variant-numeric:
tabular-nums`, which `body` sets for everything. Body copy sentence case,
line-height 1.5, max-width 60ch. Uppercase only for labels of three words
or fewer. No italics in the HUD.

### Type scale

Tokens in `src/style.css`; the HUD unit `--u` is 0.45 vmin clamped to
2 to 6 px, so HUD text is `max(14px, …)` of a unit multiple.

| Token | Size | Face | Used for |
| ----- | ---- | ---- | -------- |
| `--text-label` | clamp(14px, 1.6vmin, 16px) | Display 600 or mono | Eyebrow, controls, footnote |
| `--text-body` | clamp(14px, 1.9vmin, 16px) | Mono 400 | Tagline, end-card copy |
| `--text-stat` | clamp(16px, 2.2vmin, 20px) | Display | End-card summary line |
| `--text-button` | clamp(16px, 2.6vmin, 22px) | Display 700 | Deploy |
| `--text-message` | clamp(22px, 5.5vmin, 64px) | Display 600 | Wave banners |
| `--text-wordmark` | clamp(40px, 8vmin, 72px) | Display 700 | RINGFALL |
| `--text-hero` | clamp(36px, 8vmin, 96px) | Display 700 | Magazine count |
| HUD label | max(14px, 3.2u) | Display 600 | Sector, Score |
| HUD sub | max(14px, 3u) | Mono | Wave state, kills |

## Geometry language

Units: 1 three.js unit = 1 m. Eye height 1.7 m.

**Readability maths.** At 78 degrees vertical FOV on 1080p there are about
14 px per degree. A 2.6 m strider at 40 m is about 55 px; a skimmer body
about 12 px. **Rule: the smallest feature that must read at 40 m is 0.5 m.**
Anything smaller is decoration and must not carry gameplay meaning.

**Enemy silhouettes** must be distinguishable by aspect ratio alone:

- Skimmer: horizontal, wide, hovering and bobbing. One continuous warm
  emissive ring. Attack telegraph: core brightens.
- Strider: vertical, tall, four legs. One Rose lens on the head; charge
  telegraph: muzzle swells and the lens goes white.
- Enemies carry no Beacon cyan anywhere; the world carries no Rose anywhere.
  Color tells you what is hostile before shape does.

**Trim conventions.** Emissive trim strips are thin, Beacon, and sit on a
shared datum (the top edge of every cover slab). One horizontal line across
every block is the "manufactured by the same people" tell.

**The ring.** Real ringworlds are too thin to see as a band
([Niven][ringworld]; [Banks][orbital]). We cheat for readability: the arc is
6 km in radius with a 360 m tube, sunk 820 m below the horizon so it rises
from both sides and crosses overhead, with ocean, land and cloud bands on
its inner face and a bright rim.

**Low-poly, deliberate, not cheap.** Flat shading on terrain and enemies;
emissive trim no more than 5% of any object's surface; gradient sky plus
fog band, never a flat clear color; no imported textures (the floor plating
and ring surface are procedural canvases).

## Audio identity

- Title theme: D minor pedal with open fifths and a ninth. Each voice is
  three detuned oscillators with slow vibrato, through two parallel
  bandpass formants that drift between "ah", "oh" and "oo", into a
  convolver whose impulse response is synthesized decaying noise
  ([ReverbGen recipe][reverbgen], re-implemented; [MDN][convolver]). A deep
  drum (pitch-drop sine plus a noise burst) lands every few bars.
- Weapon and shield: rifle is a click plus bandpassed noise plus a pitch
  drop; shield hit is glassy FM; shield break is a sweep down plus noise;
  recharge is a rising sine with tremolo.
- Calm and combat are two gain buses over one clock. The drone never stops;
  the beat only ever joins it. Crossfades are ramps, never cuts.

## Developer landing (github.com/agh/ringfall)

- One-liner: "Ringfall: a browser-native arena shooter. One ring, one dawn,
  two kinds of thing that want you dead. TypeScript + three.js, zero
  assets."
- Hero: an SVG banner (sky gradient Abyss to Dawn, ring arc in Ring with
  three shadow-square notches, Beacon datum line over an Abyss ground with
  Slate grid lines, wordmark in Bone, one line of mono in Beacon) checked
  in as `docs/banner.svg`. Every fill is a palette token; the fonts fall
  back to the system stack because an image cannot load web fonts.
- A "Play now" link in the first screen of the README.
- An architecture diagram with six nodes: loop, world, player, enemies,
  audio, HUD, with an event bus between them.

## Player landing

- Layout: full-bleed live scene behind a DOM overlay. Wordmark, one line of
  copy, one button, the controls list, and a collapsed Settings strip
  (sensitivity, field of view, shake, flash). Nothing else.
- Motion, first second: the card fades up over 700 ms; the wordmark slides
  from 0.4em tracking to 0.14em over 900 ms; the Deploy button breathes
  (2.2 s cycle). Trim lines igniting across the arena and the button
  drawing its border are not yet in the code. `prefers-reduced-motion`
  removes every entrance animation and the breathing.
- Copy tone: short, declarative, no exclamation marks.
- The Deploy moment: click, pointer lock, HUD corners, tracker, vitals and
  weapon block slide in with an 80 ms stagger over 400 ms, combat bus
  armed. The shield-recharge sting on deploy is not yet in the code.

## Motion and feel

Grounded in Swink's definition of game feel and the "juice" talks
([Nijman][nijman]; [Jonasson and Purho][juice]; [GMTK][gmtk]). Every effect
is tiny, short and additive.

- Camera FOV 78 degrees vertical; sprint adds 6 degrees with an
  exponential approach whose time constant is 125 ms.
- Head bob: vertical 0.03 m, lateral 0.02 m, scaled with speed, zero
  airborne.
- Weapon sway lags the look direction and springs back; recoil kicks the
  viewmodel back and up and recovers in 100 ms.
- Hit-stop: 50 ms on a skimmer kill, 90 ms on a strider kill (any kill
  worth 300 points or more), 120 ms on the player's shield break.
  Implemented as a time-scale in `src/main.ts`, not a frame skip.
- Screen shake: magnitude is max(current, new), never additive; hard cap
  0.035 rad. The Settings panel's screen-shake switch sets the cap to zero
  and the hit-flash switch hides the lattice and damage flash
  (`src/core/settings.ts`, kept in local storage).
- HUD value tweens at most 500 ms (arcs 120 ms, flashes 400 ms); numbers
  never snap. Looping indicators (recharge 700 ms, low shield 900 ms) and
  the damage-direction fade (900 ms) are the only longer animations.

## Consistency checklist (PR gate)

1. Only palette tokens are used; no new hex values without a token name.
2. Warm colors are semantic: Flare is player state, Rose is threat, Dawn is
   light.
3. Enemies carry no Beacon; world geometry carries no Rose.
4. Every HUD panel has a 1 px Slate border; no text below 14 px.
   Panels are the tracker and the overlay card; the corner readouts and the
   weapon block have no fill and need no border.
5. Uppercase only for short labels and the wordmark; no exclamation marks.
6. Emissive trim stays thin and on the datum.
7. Smallest gameplay-meaningful feature is 0.5 m or larger.
8. Bloom threshold stays above 1.0; tone mapping stays ACES.
9. No external audio files; every sound is synthesized.
10. Music changes are gain ramps, never hard cuts.
11. Screen shake respects the cap and the Settings screen-shake switch.
12. No franchise names, logos, glyphs, fonts or melodies anywhere.

## Sources

[wcag]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
[helland]: https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html
[chakra]: https://raw.githubusercontent.com/google/fonts/main/ofl/chakrapetch/METADATA.pb
[jbmono]: https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/METADATA.pb
[ringworld]: https://en.wikipedia.org/wiki/Ringworld
[orbital]: https://en.wikipedia.org/wiki/Orbital_(The_Culture)
[reverbgen]: https://github.com/adelespinasse/reverbGen
[convolver]: https://developer.mozilla.org/docs/Web/API/ConvolverNode
[nijman]: https://www.youtube.com/watch?v=AJdEqssNZ-U
[juice]: https://www.youtube.com/watch?v=Fy0aCDmgnxg
[gmtk]: https://www.youtube.com/watch?v=216_5nu4aVQ

- <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- <https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html>
- <https://fonts.google.com/specimen/Chakra+Petch>
- <https://fonts.google.com/specimen/JetBrains+Mono>
- <https://en.wikipedia.org/wiki/Ringworld>
- <https://github.com/adelespinasse/reverbGen>
- <https://developer.mozilla.org/docs/Web/API/ConvolverNode>
- <https://web.dev/articles/audio-scheduling>
- <https://developer.valvesoftware.com/wiki/FOV>
- <https://www.youtube.com/watch?v=AJdEqssNZ-U>

## Hero and social

The hero, the README banner and the social card are renders of the shipped
build, never illustrations. Regenerate them with this recipe whenever the
look changes.

**Capture.** `pnpm build`, serve `dist/` with `pnpm exec vite preview`, open
headless Chromium (SwiftShader flags as in `scripts/record-demo.mjs`) at a
3840x1600 viewport with `deviceScaleFactor: 1`, and load
`?record&bot&seed=7&nohud&atmo=night`. `?nohud` keeps the heads-up display
hidden for the whole run (dev flag in `src/main.ts`); `atmo` and `weather`
pin the atmosphere (`src/render/environment.ts`). Call
`window.ringfallCapture.start()`, then `advance(ticks - 6)` and `advance(6)`
so the last render sees a real 0.1 s delta for its effects, and take a PNG
screenshot. One 4K frame costs about 30 s on software GL.

**Chosen frames** (all seed 7, 3840x1600, post stack on):

| Use | Moment | URL flags |
| --- | ------ | --------- |
| Hero, banner, social card | night, t = 10 s, wave 1 cleared, a skimmer kill glowing between the slabs | `atmo=night` |
| Strip: dawn | t = 95 s, wave 5, the sun flares behind the ring, minigun in hand | `atmo=dawn` |
| Strip: night | t = 18 s, wave 2, the beam in hand | `atmo=night` |
| Strip: dusk | t = 45 s, wave 3, the laser against a rose horizon | `atmo=dusk` |

**Lockup.** Top-left, on a safe margin of 6% of the width on both axes. From
the top: eyebrow "CHAPTER 1 · SECTOR 117" in Chakra Petch 600 at 1.2% of
the width, Ring, 0.08em tracking; the wordmark "RINGFALL" in Chakra Petch
700 at 6.6% of the width, Bone, 0.14em tracking; a Beacon datum line as
wide as the wordmark and 0.12% of the width thick; the one-liner and a
provenance line in JetBrains Mono 500 at 1.35% of the width, Ring and
Slate. A soft Abyss scrim (peak 55% alpha, blurred, top-left 62% of the
frame) sits under the type so the stars never fight the letters. Nothing
else is added to the frame.

**Crops and exports.** The banner is the full 2.4:1 frame: `docs/banner.png`
at 1920x800 and `docs/hero/banner-2x.webp` at 3840x1600. The raw hero frame
without type is `docs/hero/hero-night-seed7-t10.webp`. The social card is a
centered 2:1 crop of the same frame with the lockup re-set at 1.15x,
exported to `docs/social-card.png` at 1280x640 (GitHub's repository
preview size). Journey copies of every candidate and the contact sheet live
under `docs/journey/images/1740-hero-*`.
