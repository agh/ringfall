# Research

Sourced notes produced during the hackathon by delegated research agents
and reviewed by the team. They inform the specification and the backlog;
they are not commitments. Each report ends with its full source list.

| Report | Question it answers | Fed into |
| ------ | ------------------- | -------- |
| [halo-feel-and-mlp.md](halo-feel-and-mlp.md) | What makes the first thirty seconds of a classic console shooter land, what a 2026 browser can do, and what the Minimum Lovable Product cut is | `docs/spec.md`, issues #4 to #9, the wave pacing, the audio register |
| [prior-art.md](prior-art.md) | Which browser WebGL games are worth learning from, what their architectures got right, which three.js pieces give the most wow per hour, and the known failure modes of browser FPS demos | ADR-0002, renderer v2 (Sky, PMREM, composer, particles), the idle-render throttle, pointer-lock handling |
| [product-management.md](product-management.md) | What a product manager would produce for a game like this and what `docs/` must hold | `docs/product/` |

## How the research was used

The decisions below trace directly to a source in one of the reports or in
[brand.md](../brand.md).

| Decision | Source | Report |
| -------- | ------ | ------ |
| Stay on `WebGLRenderer`; keep `EffectComposer` | three.js post-processing is WebGL-only; Linux WebGPU support uneven ([web.dev](https://web.dev/blog/webgpu-supported-major-browsers), [migration guide](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)) | both |
| Enemies ease off while the shield is down and the player is in cover (#4) | Griesemer on the shield pacing contract ([Engadget](https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html)) | halo-feel-and-mlp |
| Skimmers flee on a strider death, cranked past subtle (#5) | Bungie's Grunt lesson and Isla on subtlety ([DU lecture](https://www.cs.du.edu/~sturtevant/s13-ai/lecture2.pdf), [Game Developer](https://gamedeveloper.com/programming/abandoning-subtlety-to-create-immersive-ai-encounters)) | halo-feel-and-mlp |
| Grenade dives and firing points (#6, #7) | Bungie behaviour list and the GDC 2002 deck ([behaviour list](https://learn.microsoft.com/en-us/halo-master-chief-collection/h2/ai/aibehaviorlist), [slides](https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf)) | halo-feel-and-mlp |
| Five named waves instead of eight uniform ones (#8) | Opdahl on biorhythm and Isla's encounter shape ([iTWire](https://itwire.com/opinion-and-analysis-sp-481/radioactive-it/designing-halo-reach-was-like-filming-titanic), [Isla](https://web.cs.wpi.edu/~rich/courses/imgd4000-d11/lectures/halo3.pdf)) | halo-feel-and-mlp |
| Chant register, formant synthesis, synthesised reverb | O'Donnell on the theme; formant tables; Moorer's decaying-noise room ([HBO 1999](https://halo.bungie.org/music_interviews/hbo_qanda_1999.html), [Peterson and Barney](https://www.cs.princeton.edu/courses/archive/spr99/cs325/formants.html), [ReverbGen](https://github.com/adelespinasse/reverbGen)) | halo-feel-and-mlp, brand |
| Pure core validated by shipped games | instagib-arena and drift-arena share one sim between client and server ([instagib](https://github.com/8tp/instagib-arena), [drift](https://github.com/dc3344/drift-arena)) | prior-art |
| `Sky` plus PMREM, bloom threshold above 1.0, particles as one draw call | three.js docs and examples ([Sky](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Sky.js), [UnrealBloomPass](https://threejs.org/docs/pages/UnrealBloomPass.html), [RoomEnvironment](https://threejs.org/docs/pages/RoomEnvironment.html)) | prior-art |
| Clamp the frame delta; pause on lock loss; one gesture unlocks audio and pointer | Gaffer's accumulator; MDN pointer lock; Chrome autoplay policy ([Gaffer](https://gafferongames.com/post/fix_your_timestep/), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API), [Chrome](https://developer.chrome.com/blog/autoplay/)) | prior-art |
| Palette roles, fonts, feel values | WCAG contrast, OFL metadata, Swink and the juice talks ([WCAG](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [Chakra Petch](https://raw.githubusercontent.com/google/fonts/main/ofl/chakrapetch/METADATA.pb), [Nijman](https://www.youtube.com/watch?v=AJdEqssNZ-U)) | brand |
