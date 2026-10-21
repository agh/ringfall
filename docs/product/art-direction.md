---
type: art-direction
title: "Ringfall art direction"
status: draft
authors: ["Ringfall hackathon team"]
created: 2026-10-21
related: ["docs/brand.md", "docs/design-doc.md", "docs/spec.md"]
---

# Ringfall art direction

> [Ringfall](../../README.md) > [Specification](../spec.md) > Art direction

This bible says what the world is and how it is lit, drawn and moved. The
palette tokens, typography, light rig values and the PR checklist live in
[brand.md](../brand.md) and are not repeated here; renderer and motion
numbers are owned by [design-doc.md](../design-doc.md) and brand.md.

## World premise

You are standing on the inside of a ring. It is six kilometres across, its
near side buried below the horizon so the arc climbs from both edges of the
world and crosses overhead, ocean and land and cloud bands on its inner
face and a bright metal rim catching the light. The sun is low, eleven
degrees up and 3500 K warm, and it sits behind the ring so the arc is
backlit by the horizon. Mountains close the view at 500 m. It is dawn, and
it is the first dawn anyone has watched from here.

In front of you is a walled arena, 60 m square, with sixteen slabs of cover
that were manufactured by the same people and share one line of emissive
trim along their top edge. The walls are transparent; the world does not
stop at them, the fight does. The terrain outside rolls away flat-shaded
and vertex-coloured by height. Nothing explains who built the slabs or why
the arena is numbered 117. The premise is a place, not a plot.

## Rendering tenets

**One lighting idea.** A low warm sun against a cold atmosphere, executed
everywhere. The sky is scattered, not painted; the environment lighting is
baked from that sky; the fog is tuned to the horizon band so geometry
dissolves into the dawn rather than into the zenith. There is no second
light rig for the HUD, the title or the tableau.

**Warm means something.** The world is cold so the eye goes to the warm
exceptions, and each warm token has one job: Dawn is light, Flare is the
player's own state, Rose is threat. An enemy never carries Beacon; the
world never carries Rose. If a pixel is warm, the player can act on it.

**Geometry agrees with itself.** Flat shading, hard edges, one datum line,
and a readability floor of 0.5 m for anything that carries meaning at 40 m.
Enemies are told apart by aspect ratio before colour, and colour before
detail. Low-poly is a choice, not a shortcut.

## Reference moods

**Dawn over a reservoir.** Still water holding a band of orange under a
sky that is still navy at the top. The light is horizontal and long; every
vertical face has a lit side and a cold side. This is the arena at Deploy.

**Brutalist concrete with inlaid light.** Heavy slabs, chamfered edges, and
one thin line of light set into the surface at a shared height, as if a
building's signage system had been designed by its structural engineer.
This is the cover and the HUD panels.

**Deep-sea bioluminescence.** Dark bodies with a single glowing organ that
brightens when the creature is about to act. Soft, pulsing, slightly wrong.
This is the enemies: the skimmer's ring and the strider's lens.

## Silhouette sheet

Both enemies must read at 40 m by aspect ratio alone. Emissive placements
are marked with `*`; nothing else on an enemy glows.

```text
Skimmer: horizontal, wide, hovering, bobbing. Flattened octahedron.

        ______________
   * * /              \ * *      <- one continuous Rose ring, spinning
  *   <       (o)      >   *     <- warm core, brightens on attack
   * * \______________/ * *

Strider: vertical, tall, four legs, cannon. Capsule walker.

             ___
            | * |                <- one Rose lens, goes white on charge
            |___|==|             <- cannon; muzzle swells before a bolt
           /  |  \
          /  / \  \
         /  /   \  \
        _| _|   |_ |_            <- four capsule legs, walk cycle
```

The skimmer is about one body wide and a third of that tall; the strider is
2.6 m tall and narrower than it is high. Spawning enemies descend from six
metres over one second; dead ones squash and tilt for 1.2 s before the
kill ring and spark burst.

## VFX language

Bloom is HDR with its threshold above 1.0, so only things that are meant to
glow ever do. What blooms: the emissive trim on the slabs, the skimmer ring
and core, the strider lens and bolt, the muzzle light, the tracer, the hex
shield lattice when it flares, the kill ring, and the core of a grenade
explosion. What never blooms: lit albedo of any kind, terrain, the HUD, the
ring's surface, and the sky away from the sun.

Particles come from one pool, so colour is the only variable. The
assignments below are proposed and use brand.md tokens only; brand.md
remains the source for hex values.

| Event | Particle colour | Notes |
| ----- | --------------- | ----- |
| Rifle impact on cover | Dawn sparks, Slate dust | Light striking stone. |
| Rifle impact on an enemy | Rose sparks | Threat bleeds threat. |
| Bolt trail and bolt impact | Rose | The only Rose the player sees coming. |
| Shield hit and shield break | Beacon lattice, Rose vignette | Beacon is the shield; Rose is what got through. |
| Grenade explosion | Flare core, Dawn ring, Slate smoke | The player's own weapon, lit by the dawn. |
| Kill ring and death burst | Rose fading to Slate | Threat going cold. |
| Drop-pod streak (MLP 8) | Dawn | Catching the sun on the way down. |

Every effect is tiny, short and additive: a 70 ms tracer, a 450 ms
explosion light, hit-stops of 50, 90 and 120 ms as a time-scale and never
a frame skip.

## Camera and lens

The camera is 1.7 m off the ground with a 78 degree vertical field of
view; sprint adds 6 degrees over 150 ms. Head bob is 0.03 m vertical and
0.02 m lateral, scaled with speed and zero when airborne. The weapon lags
the look direction and springs back; recoil kicks it back and up and
recovers within 200 ms. The mouse turns at 0.0022 rad per pixel with pitch
clamped just short of vertical. Screen shake is max(current, new), never
additive, hard-capped at 0.035 rad, and the accessibility toggle sets the
cap to zero. Tone mapping is ACES at exposure 0.38; fog is exponential at
density 0.0032. The tableau is the only scripted camera move: a tilt up to the ring, then
stillness.

## What we will never do

- Use a texture, model, sound or font file from the internet; everything is
  procedural or an OFL font named in brand.md.
- Draw any franchise glyph, logo, silhouette, colour scheme or melody.
- Put lens flares, glow or bloom on the HUD; panels get a 1 px Slate border
  and nothing else.
- Let shake exceed the cap, or ignore the toggle.
- Add a second lighting idea, a second warm rule, or a second datum line.
- Give a feature smaller than 0.5 m any gameplay meaning.
