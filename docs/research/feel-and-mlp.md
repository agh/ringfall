---
type: research
title: "What S-tier console-shooter feel in a browser actually requires"
status: approved
authors:
  - name: "Ringfall research agent (Claude), reviewed by the hackathon team"
created: 2026-10-21
---

# What "S-tier console-shooter feel in a browser" actually requires

This is a research note produced during the hackathon by a delegated
research agent, then reviewed and lightly edited. Every claim carries a
source. It informs [the specification](../spec.md) and the backlog; it is
not itself a commitment.

## The thesis in three sentences

The reference console shooter's magic is not content volume; it is a **3-second loop inside a
30-second loop inside a 3-minute loop** where enemies are legible actors in
a theater the player directs ([Griesemer, Engadget 2011][griesemer]). A 5
to 10 minute demo therefore needs exactly **one** great 30-second loop,
varied four or five times, wrapped in one unforgettable image (the ring)
and one unforgettable sound (the chant register). Everything else is
"later".

## Why the reference shooter's opening lands (primary sources)

**The loop, not the level.** Griesemer: "there was maybe 30 seconds of fun
that happened over and over... you can pretty much stretch that out to be
an entire game", but the half everyone forgets is "in different
environments, with different weapons, different vehicles, against different
enemies... No 30 second stretch of [the game] is ever repeated." His canonical
example is melee on an unaware enemy, grenade into a group, clean up
stragglers ([Engadget][griesemer]). The studio called the
weapons-grenades-melee triad the "Golden Triangle"
([Halopedia][wiki-weapons]).

**Shield rhythm is a pacing contract with the AI.** Griesemer: when your
shields drop and you take cover, the enemies back off and let you catch
your breath, and they do not usually flush you out of cover (paraphrased). Charging in "guns
blazing" gets hard pushback ([Engadget][griesemer]). The shield recharges
after a brief damage-free window; health beneath it needs a medkit, which
removes the "1% health" problem while keeping stakes
([Film Stories][filmstories]). **Design consequence for Ringfall:** enemy
aggression must drop when the player's shield pops. That is the single most
genre-defining AI rule and it costs ten lines.

**AI as theater.** The GDC 2002 deck lists the design goals as
*Intelligible, Interactive, Unpredictable*; "Transparent thought process";
"Communication of Intent... Language, Posture, Gesture, Focus of Attention";
"Things to Avoid: Subtlety, Looking Broken"; and a "Thwarted / Breaking
point: Flee in Terror, Berserk, Retreat" ([Butcher & Griesemer][gdc2002]).
The famous fleeing-minion story: "Initially nobody noticed so we had to keep adding
clues... every single [minion] run away every single time a [leader] is
killed... outrageously exaggerated panic run... I would still estimate that
less than a third of our users made the connection" ([DU lecture][du]).
Isla: "subtlety flies straight over the player's head... you really have to
crank it to 11" ([Game Developer][isla-subtlety]). The studio's behavior
list includes a "Dive impulse: if I'm in immediate danger from a vehicle or
grenade... dive away", an "Evasion impulse: hop to the side", and
"self-preserve" when shields are low ([behavior list][bungie-ai]).

**Encounter shape.** Isla's canonical encounter: "Enemies occupy a
territory; pushed to 'fallback' point; pushed to 'last-stand' point; player
'breaks' them; player finishes them off... plus a little 'spice'"
([Isla, Building a Better Battle][isla-battle]).

**The ring and the open sky.** Stepping out of the lifepod: "pine trees and
scattered green grass", a cliff over ocean, and looking up, the far side of
the ring overhead: "Everything feels simultaneously familiar and alien"
([Game Informer][gameinformer]). The whole game's AI and encounter design
was prototyped on one sandbox level ([Wikipedia][wiki-ce]). One arena is
the reference shooter's way.

**Music.** O'Donnell chose "Gregorian chant, string orchestra, percussion,
and just a bit of a 'Qawwali voice'", written in under a week
([HBO 1999 Q&A][hbo1999]). In-game: "The music of [the game] is designed so that
the player feels that their personal game experience was scored. They
should never be aware of what they did to cause it to be scored"
([halo.bungie.org/music][hbo-music]).

## What a 2026 browser can really do

**Renderer choice: stay on WebGL 2.** WebGPU is at roughly 88% global usage
([caniuse][caniuse]), but Firefox on Linux and Chrome on Linux are still
"in progress" ([web.dev][webdev-webgpu]). `EffectComposer` and the
`jsm/postprocessing` stack do not run on `WebGPURenderer`
([migration guide][utsubo-migrate]). A demo on a Linux laptop in a
conference room will hit the fallback path.

**Effects, ranked by wow-per-millisecond:**

1. Bloom at reduced resolution on emissive plasma, shield flare and muzzle.
2. Juice, not passes: camera kick, 50 to 100 ms hit-stop on a shield pop,
   short eased screenshake, enemy hit-flash. Near-zero cost
   ([screenshake breakdown][screenshake]).
3. One directional sun with a tight shadow frustum; three or fewer dynamic
   lights ([utsubo tips][utsubo-tips]).
4. Instanced particles and props.
5. SSAO (N8AO) only if frame time allows ([N8AO][n8ao]).
6. God rays: raymarched and shadow-map dependent; fake with a sun sprite
   and additive shafts.
7. Motion blur, DOF, SSR: skip.

**Frame budget to hold on an integrated-GPU laptop at 1080p (targets, not
measurements):** 16.7 ms total; scene under 7 ms; bloom under 2 ms; feel
pass under 0.5 ms; shadow map static after bake.

## Minimum Lovable Product for Chapter 1

The MLP lens: start with the one feature that makes the product
indispensable; spreading effort dilutes everything; a bare MVP tests a
broken version of the idea ([First Round Review][firstround]). The "one
feature" for Ringfall is **the shield-driven 30-second loop against
theatrical enemies**.

| Priority | Item | Why it is lovable, not merely functional |
| -------- | ---- | ---------------------------------------- |
| MLP 1 | Shield pop and recharge as a full audiovisual event; enemies back off while the shield is down | The reference shooter's contract. The player feels the game letting them breathe. |
| MLP 2 | Skimmers flee when a strider dies, with exaggerated animation and a bark | Fewer than a third of players noticed even at 11; the demo must crank to 12. |
| MLP 3 | Striders dive from grenades and sidestep fire; seek cover on low shield | Makes bouncing grenades a conversation. |
| MLP 4 | Weapon juice: camera kick, recoil, tracer, hit-flash, distinct chimes | Cheapest wow available. |
| MLP 5 | Firing points: enemies choose scored positions rather than beelining | "Transparent thought process" needs positioning. |
| MLP 6 | The ring overhead, sun, fog | The single image everyone remembers. |
| MLP 7 | Procedural title chant plus scored stingers | Audio identity is what the audience hums in the lift. |
| MLP 8 | Five-wave arc with scripted beats and a victory tableau | A demo needs an ending. |
| Later | Vehicles | A whole second game. |
| Later | Second weapon, weapon swap, melee | Melee may slip in; a second weapon will not. |
| Later | Third enemy type, snipers, dropships | Isla's spice is additive. |
| Later | Campaign, second arena, co-op, mobile, WebGPU, SSAO, god rays | Multipliers with no new loop. |

## Pacing a 5 to 10 minute demo

Opdahl: the "biorhythm" is action and emotion moving in opposite
directions; find where the player "feels like they're winning, reinforce
that, and then ask why the situation turns" ([iTWire][itwire]).

- **0:00 to 0:30 Arrival.** Chant only.
- **0:30 to 1:30 Wave 1, "Scouts":** three skimmers. Teaches hitscan and
  recharge. First kill triggers a percussion stinger.
- **1:30 to 2:45 Wave 2, "The Leader":** one strider plus skimmers. The
  strider arrives last with a horn stinger and an idle posture. When it
  dies, all skimmers flee. This is the first spectacle; it must land before
  minute three.
- **2:45 to 4:30 Wave 3, "Fallback":** two-stage fallback behavior.
- **4:30 to 6:30 Wave 4, "The Push":** chant returns under percussion.
- **6:30 to 8:00 Wave 5, "Last Stand":** an armored strider; on its death,
  slow motion, the survivors flee, the music resolves, the camera tilts to
  the ring. End on the image and the sound, not a menu.

One developer's account argues the first 30 seconds decide whether a
player stays ([Game Developer, "The 30-second hook"][hook]).

## Audio identity in WebAudio

Copy the register, not the melody: monophonic male chant, Dorian or Aeolian
mode, long cathedral tail, then strings and a drum pulse.

- Chant voice: detuned sawtooths through parallel bandpass formants. Male
  "oo" is roughly 300 / 870 / 2240 Hz; "ah" is 730 / 1090 / 2440 Hz
  ([Peterson and Barney][formants]).
- Melody: an original four-phrase Dorian line in D, unison, stepwise.
- Space: a `ConvolverNode` with a synthesized impulse response (exponentially
  decaying noise, 4 to 6 s, low-passed over time)
  ([MDN ConvolverNode][convolver]).
- Percussion: filtered noise bursts plus a 60 Hz sine thump.
- Stingers from `GameEvent`s, so the player is "never aware of what they
  did to cause it".

## First 30 seconds, shot by shot

| t | Player sees | Hears | Does |
| - | ----------- | ----- | ---- |
| 0 to 3 s | Black. "RINGFALL" fades in. | Silence, then the chant's first phrase. | Nothing. |
| 3 to 6 s | "Chapter 1". "Click to begin". | Second phrase. | Clicks; pointer lock engages. |
| 6 to 9 s | Fade from black looking down at the floor; dust motes. | Chant continues; wind. | Looks up. |
| 9 to 13 s | Camera reveals the ring arcing over the dome, sun behind it. **The screenshot.** | Low string drone. | Walks. |
| 13 to 16 s | Rifle raises with recoil settle; shield bar draws in with a tick. | Rifle click. | Fires one shot: kick, tracer, bloom. |
| 16 to 20 s | Three drop-pods streak onto the ridge; "WAVE 1". | Impact thuds, horn stinger. | Readies. |
| 20 to 26 s | Skimmers emerge posture-first before firing. | First bark; plasma whine. | Shoots; first hit shows a flare. |
| 26 to 30 s | First kill: flash, tilt, 60 ms hit-stop, kill chime. | Chime, first drum. | Grins; throws first grenade. |

## Sources

[griesemer]: https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
[wiki-weapons]: https://www.halopedia.org/Weapons_(gameplay)
[filmstories]: https://filmstories.co.uk/features/killer-feature-halo-and-halo-2s-regenerating-shields/
[gdc2002]: https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf
[du]: https://www.cs.du.edu/~sturtevant/s13-ai/lecture2.pdf
[isla-subtlety]: https://gamedeveloper.com/programming/abandoning-subtlety-to-create-immersive-ai-encounters
[bungie-ai]: https://learn.microsoft.com/en-us/halo-master-chief-collection/h2/ai/aibehaviorlist
[isla-battle]: https://web.cs.wpi.edu/~rich/courses/imgd4000-d11/lectures/halo3.pdf
[gameinformer]: https://gameinformer.com/b/features/archive/2012/12/25/places-the-halo-ring.aspx
[wiki-ce]: https://en.wikipedia.org/wiki/Halo:_Combat_Evolved
[hbo1999]: https://halo.bungie.org/music_interviews/hbo_qanda_1999.html
[hbo-music]: https://halo.bungie.org/music.html
[caniuse]: https://caniuse.com/webgpu
[webdev-webgpu]: https://web.dev/blog/webgpu-supported-major-browsers
[utsubo-migrate]: https://www.utsubo.com/blog/webgpu-threejs-migration-guide
[utsubo-tips]: https://www.utsubo.com/blog/threejs-best-practices-100-tips
[n8ao]: https://github.com/N8python/n8ao
[screenshake]: https://dkliao.itch.io/the-art-of-screenshake-recreation/devlog/451576/quick-breakdown-of-all-the-effects
[firstround]: https://review.firstround.com/dont-serve-burnt-pizza-and-other-lessons-in-building-minimum-lovable-products
[itwire]: https://itwire.com/opinion-and-analysis-sp-481/radioactive-it/designing-halo-reach-was-like-filming-titanic
[hook]: https://www.gamedeveloper.com/design/the-30-second-hook
[formants]: https://www.cs.princeton.edu/courses/archive/spr99/cs325/formants.html
[convolver]: https://developer.mozilla.org/docs/Web/API/ConvolverNode

- <https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html>
- <https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf>
- <https://www.cs.du.edu/~sturtevant/s13-ai/lecture2.pdf>
- <https://gamedeveloper.com/programming/abandoning-subtlety-to-create-immersive-ai-encounters>
- <https://web.cs.wpi.edu/~rich/courses/imgd4000-d11/lectures/halo3.pdf>
- <https://learn.microsoft.com/en-us/halo-master-chief-collection/h2/ai/aibehaviorlist>
- <https://www.halopedia.org/Weapons_(gameplay)>
- <https://en.wikipedia.org/wiki/Halo:_Combat_Evolved>
- <https://filmstories.co.uk/features/killer-feature-halo-and-halo-2s-regenerating-shields/>
- <https://gameinformer.com/b/features/archive/2012/12/25/places-the-halo-ring.aspx>
- <https://halo.bungie.org/music_interviews/hbo_qanda_1999.html>
- <https://halo.bungie.org/music.html>
- <https://itwire.com/opinion-and-analysis-sp-481/radioactive-it/designing-halo-reach-was-like-filming-titanic>
- <https://www.gamedeveloper.com/design/the-30-second-hook>
- <https://web.dev/blog/webgpu-supported-major-browsers>
- <https://caniuse.com/webgpu>
- <https://www.utsubo.com/blog/webgpu-threejs-migration-guide>
- <https://www.utsubo.com/blog/threejs-best-practices-100-tips>
- <https://github.com/N8python/n8ao>
- <https://dkliao.itch.io/the-art-of-screenshake-recreation/devlog/451576/quick-breakdown-of-all-the-effects>
- <https://review.firstround.com/dont-serve-burnt-pizza-and-other-lessons-in-building-minimum-lovable-products>
- <https://www.cs.princeton.edu/courses/archive/spr99/cs325/formants.html>
- <https://developer.mozilla.org/docs/Web/API/ConvolverNode>

Caveat: the frame-budget numbers are engineering targets, not published
measurements. The two GDC decks were read from the fetched PDFs.
