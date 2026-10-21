---
type: design-doc
title: "Ringfall brand and design system"
status: draft
authors: ["Ringfall research agent (Claude), reviewed by the hackathon team"]
reviewers: []
created: 2026-10-21
approved: 2026-10-21
---

# Ringfall brand and design system

One recommendation per decision; alternatives marked "Alt". Values here are
the source of truth for `src/style.css`, the light rig in
`src/render/scene.ts`, and the README banner. Where the code and this
document disagree, fix the code or update this document in the same PR.

## Visual identity

### Palette

| Token | Hex | Role | Contrast vs Abyss sky / vs Hull panel |
| ----- | --- | ---- | ------------------------------------- |
| Abyss | `#0b1a2e` | Sky zenith, page background, clear colour | n/a |
| Beacon | `#7dd3fc` | Primary HUD accent, reticle, cover trims, shield | 10.5 / 9.9 (AAA) |
| Flare | `#fbbf24` | Health, low ammo, the player's own state | 10.5 / 9.9 (AAA) |
| Dawn | `#f6b26b` | Sun, horizon glow, sun-lit face tint | 9.6 / 9.1 (AAA) |
| Ring | `#b8d8ea` | The ringworld arc, far-fog lift, secondary text | 11.7 / 11.1 (AAA) |
| Bone | `#e8e4d8` | Body text, titles | 13.8 / 13.0 (AAA) |
| Rose | `#fb7185` | Damage taken, enemy emissive, threat | 6.5 / 6.1 (AA text, AAA large) |
| Hull | `#101f36` | HUD panel fill at 85% alpha | 1.06 vs sky: panels need a border |
| Slate | `#8aa0b8` | Muted text, panel borders, grid lines | 6.5 / 6.1 |

Thresholds per [WCAG 2.2 SC 1.4.3][wcag]. Rule: every panel gets a 1 px
Slate border; never rely on fill alone. Never place Beacon text on Ring or
Bone.

### Colour psychology

- The cold base (Abyss, Ring, Beacon) reads as composure and precision. The
  whole world is cold so the eye is drawn to the two warm exceptions.
- Flare is reserved for the player's own state: caution without alarm.
  Rose is reserved for threat: enemies and incoming damage. That single rule
  makes every warm pixel meaningful.
- Dawn is the narrative colour: the sun is low, the day is starting, the
  ring is catching first light. Warm key against cool fill is what makes
  flat-shaded faces read as volume.

### three.js light rig

- Sun: `DirectionalLight` at about 3500 K (`#ffc18d` via the
  [Helland approximation][helland]), elevation 11 to 12 degrees, azimuth
  towards the ring so the ring is backlit by the horizon. Shadow map 2048.
- Hemisphere: sky `#3b6a9a`, ground `#15202e`, intensity 0.6.
- Fog: exponential, colour between Abyss and the horizon band so geometry
  dissolves into the horizon rather than into the sky.
- Sky: scattering sky (three.js `Sky`) with turbidity 4, Rayleigh 2.2; the
  ring, sun and stars are excluded from fog.
- Bloom: threshold above 1.0 in HDR so ordinary lit albedo never blooms;
  only emissive trims and effects cross it. Tone mapping ACES Filmic.

## Typography

- Display: **Chakra Petch**, SIL OFL 1.1 ([metadata][chakra]). Squared,
  slightly chamfered terminals say "machined" without the usual sci-fi
  cliché; counters stay open at small sizes.
- Body and HUD: **JetBrains Mono**, SIL OFL 1.1 ([metadata][jbmono]).
  Tabular numerals for free, so health and ammo never jitter.
- Alt: keep **Rajdhani** (OFL) as the display fallback.

Rules: wordmark "RINGFALL" in Chakra Petch 700, uppercase, letter-spacing
0.14em. HUD labels 600, uppercase, 0.08em, at least 14 px. Numerals in
JetBrains Mono 500 with `font-variant-numeric: tabular-nums`. Body copy
sentence case, line-height 1.5, max-width 60ch. Uppercase only for labels
of three words or fewer. No italics in the HUD.

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
  Colour tells you what is hostile before shape does.

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
fog band, never a flat clear colour; no imported textures (the floor plating
and ring surface are procedural canvases).

## Audio identity

- Title theme: D minor pedal with open fifths and a ninth. Each voice is
  three detuned oscillators with slow vibrato, through two parallel
  bandpass formants that drift between "ah", "oh" and "oo", into a
  convolver whose impulse response is synthesised decaying noise
  ([ReverbGen recipe][reverbgen], re-implemented; [MDN][convolver]). A deep
  drum (pitch-drop sine plus a noise burst) lands every few bars.
- Weapon and shield: rifle is a click plus bandpassed noise plus a pitch
  drop; shield hit is glassy FM; shield break is a sweep down plus noise;
  recharge is a rising sine with tremolo.
- Calm and combat are two gain buses over one clock. The drone never stops;
  the beat only ever joins it. Crossfades are ramps, never cuts.

## Developer landing (github.com/agh/hack)

- One-liner: "Ringfall: a browser-native arena shooter. One ring, one dawn,
  two kinds of thing that want you dead. TypeScript + three.js, zero
  assets."
- Hero: an SVG banner (sky gradient, ring arc with three shadow-square
  notches, datum line, wordmark) checked in as `docs/banner.svg`.
- A "Play now" link in the first screen of the README.
- An architecture diagram with six nodes: loop, world, player, enemies,
  audio, HUD, with an event bus between them.

## Player landing

- Layout: full-bleed live scene behind a DOM overlay. Wordmark, one line of
  copy, one button. Controls hint bottom-right. Nothing else.
- Motion, first three seconds: scene fades up; wordmark letters slide and
  lock in; the trim lines across the arena ignite; the Deploy button draws
  its border and breathes.
- Copy tone: short, declarative, no exclamation marks.
- The Deploy moment: click, pointer lock, HUD elements slide in with a
  stagger, shield-recharge sting, combat bus armed.

## Motion and feel

Grounded in Swink's definition of game feel and the "juice" talks
([Nijman][nijman]; [Jonasson and Purho][juice]; [GMTK][gmtk]). Every effect
is tiny, short and additive.

- Camera FOV 78 degrees vertical; sprint adds 6 degrees over 150 ms.
- Head bob: vertical 0.03 m, lateral 0.02 m, scaled with speed, zero
  airborne.
- Weapon sway lags the look direction and springs back; recoil kicks the
  viewmodel back and up and recovers within 200 ms.
- Hit-stop: 50 ms on a skimmer kill, 90 ms on a strider kill, 120 ms on the
  player's shield break. Implement as a time-scale, not a frame skip.
- Screen shake: magnitude is max(current, new), never additive; hard cap
  0.035 rad; an accessibility toggle sets the cap to zero.
- HUD tweens at most 500 ms; numbers never snap.

## Consistency checklist (PR gate)

1. Only palette tokens are used; no new hex values without a token name.
2. Warm colours are semantic: Flare is player state, Rose is threat, Dawn is
   light.
3. Enemies carry no Beacon; world geometry carries no Rose.
4. Every HUD panel has a 1 px Slate border; no text below 14 px.
5. Uppercase only for short labels and the wordmark; no exclamation marks.
6. Emissive trim stays thin and on the datum.
7. Smallest gameplay-meaningful feature is 0.5 m or larger.
8. Bloom threshold stays above 1.0; tone mapping stays ACES.
9. No external audio files; every sound is synthesised.
10. Music changes are gain ramps, never hard cuts.
11. Screen shake respects the cap and the accessibility toggle.
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
