---
type: prfaq
title: "Ringfall concept proposal (PR/FAQ)"
status: draft
authors: ["Ringfall hackathon team"]
created: 2026-10-21
related: ["docs/spec.md", "docs/design-doc.md", "docs/adr/0003-original-ip-only.md"]
---

# Ringfall concept proposal

> [Ringfall](../../README.md) > [Specification](../spec.md) > Concept proposal

This document works backwards from the player. The press release describes
Chapter 1 as it should feel on launch day; the FAQs answer what a player, a
judge, an engineer or a sponsor would ask. Scope and numbers are owned by
[spec.md](../spec.md) and [design-doc.md](../design-doc.md).

## Press release

### Ringfall puts a ringworld dawn, a recharging shield and two kinds of enemy in a browser tab, with nothing to install and nothing to download

*A five to ten minute arena shooter that opens on one image and ends on it.*

For immediate release. Sector 117, 4 November 2026. The Ringfall hackathon team today released
Chapter 1 of Ringfall, a first-person arena shooter that runs from a static
web page in any desktop browser with WebGL 2. You click Deploy, the mouse
locks, the HUD slides in, and you are standing on the inner surface of a
ring at dawn with a rifle, four grenades and an energy shield. Five named
waves of enemies come for you. When the last one falls, the camera tilts
up to the ring and the music resolves. There is no menu after that, because
there does not need to be.

Browser games have a reputation to live down: a thin port of something
that was better elsewhere, or a loop so shallow it is forgotten when the
tab closes. Players who love the deliberate rhythm of a classic console
shooter, where a shield that recharges when you break contact turns every
fight into engage, retreat, recover, have had nowhere in a browser to feel
it.

Ringfall is built around that rhythm and nothing else. Damage hits a
100 point shield first and 100 points of health second; the shield comes
back at 35 points per second once you have gone four seconds without being
hit, and health never does. Skimmers close at seven metres per second and
zap you up close; striders hold eight to sixteen metres and fire bolts slow
enough to strafe. Grenades bounce, so a throw around a cover block is a
conversation, not a button press. Everything on screen is generated when
the page loads: the sky, the six kilometre ring overhead, the terrain, the
enemies, and every sound, which is an oscillator or a noise burst shaped on
demand.

"We wanted one thirty-second loop that is good enough to repeat five times
with something new each time, wrapped in one image and one sound," said the
Ringfall hackathon team. "The shield is the whole reason the HUD exists.
When it breaks, the game lets you breathe, and that is the moment we built
everything else to serve."

To play, open the published page, read the controls hint in the corner,
and click Deploy. The first wave arrives after a three second countdown.
W, A, S and D move, the mouse aims, the left button fires, G or the right
button throws a grenade, R reloads, and Esc hands the mouse back. There is
no account, no download and no network traffic after the page has loaded.

"I clicked a link someone sent me and thirty seconds later I had killed
three things, lost my shield, hidden behind a block and watched it come
back," said a first-time player at the hackathon. "Then I looked up."

## External FAQ

**What do I need to run it?** A desktop browser with WebGL 2 and pointer
lock. That is every current release of the major browsers on Windows,
macOS and Linux. An integrated GPU is the target; see
[spec.md](../spec.md) item 11 for the frame budget commitment.

**How long is a session?** Five to ten minutes from Deploy to the victory
tableau. The [spec](../spec.md) names five waves; the current build ships
eight uniform ones, and the roster per wave is in
[design-doc.md](../design-doc.md).

**Is there a story?** Only what you can see. A ring, a dawn, a walled
arena numbered 117, and two kinds of thing that want you dead. The world
is the premise, and we would rather you look up than read a codex.

**Can I play on my phone?** Not in Chapter 1. Touch controls are listed
under Later in the specification because they change the platform without
changing the loop.

**Is this a copy of a well-known console shooter?** No. It is inspired by
the feel of that genre, which is a loop, not a property. Every name,
shape, colour, font and note in Ringfall is original, and
[ADR-0003](../adr/0003-original-ip-only.md) makes that a rule.

**What are judges meant to look at?** The first thirty seconds, the
moment the shield breaks, and the moment a strider dies and the skimmers
run. Those three beats are the product.

**Does it have an ending?** Yes. Clearing the final wave freezes the fight
and tilts the camera to the ring while the score resolves. We end on the
image and the sound, not a menu.

## Internal FAQ

**Why a browser?** Because a link is the lowest-friction demo there is,
and a static host with no backend is the cheapest thing to keep alive. The
cost is a WebGL 2 ceiling and a frame budget on integrated graphics, both
of which are accepted in [ADR-0001](../adr/0001-typescript-three-vite.md).

**Why procedural everything?** It removes the asset pipeline from the
critical path of a three hour build, keeps the bundle near the size of
three.js itself, and makes the licensing question disappear. Every sound
is synthesised from the same event stream the renderer reacts to, so audio
and picture can never disagree.

**Why no franchise material at all?** Inspiration is the mechanics and the
mood. Names, logos, glyphs, melodies and models are someone else's
property, and using them would turn a portfolio piece into a liability.
The rule is written down in ADR-0003 and enforced by the brand checklist.

**What is the MLP cut?** The fourteen numbered items in the
[specification](../spec.md), each tied to a moment a first-time player
would describe to a friend. The loop-changing items come first: the shield
break as an event, enemy theatre, grenade dives, firing points, five named
waves with a tableau. Melee, a second weapon, a third enemy, mobile and
co-op are explicitly Later.

**What is the risk?** That the demo laptop is slower than the targets, or
that the title and Deploy choreography is not finished and the first thirty
seconds fall flat. The mitigation for the first is a measured frame budget
gate; for the second, the title screen is scheduled ahead of any later
wave content.

**What does success look like for a five to ten minute demo?** A judge who
has never seen it clicks Deploy, clears wave one without being told how,
loses a shield and understands why it came back, and sees the ring. The
playtest bot clears wave one on most seeds, the Playwright smoke test is
green, and a seeded recording exists that can be shown if the room's GPU
cannot.

**How do we know it is fair?** The simulation is a pure function with a
seeded random source, so a headless bot plays thousands of games and
reports win rate, accuracy and shield breaks per wave. See
[test-plan.md](../test-plan.md).
