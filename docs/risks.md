---
type: risk-register
title: "Ringfall risk register"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall risk register

> [Ringfall](../README.md) > [Specification](spec.md) > Risks

Each row is a risk that the existing documents already name, with the
condition that would show it has happened and the mitigation that is in
place or planned. Impact and probability are judged on a three point scale
of low, medium, and high. The owner is a role, not a person, because the
project is a hackathon team and the role may pass between people and
agents. Where an issue number is given, that issue carries the acceptance
criteria.

## Register

| ID | Description | Impact | Probability | Trigger | Mitigation | Owner role |
| -- | ----------- | ------ | ----------- | ------- | ---------- | ---------- |
| R1 | The frame time on an integrated GPU at 1080p has never been measured; the 16.7 ms budget with the scene under 7 ms, bloom under 2 ms, and the feel pass under 0.5 ms in [requirements.md](product/requirements.md) is a target, not a number. | High | Medium | The demo stutters on the laptop in the room, or a player reports the page is unplayable. | Spec item 11 and issue #11 add a per-frame measurement on real hardware; until then the release owner plays the deployed page on an integrated GPU before every tag. | Render owner |
| R2 | CI and sandboxes render with SwiftShader, which takes hundreds of milliseconds per frame and has lower depth precision than hardware, so the browser layer can pass in CI and fail on a real GPU, or the reverse. | Medium | High | A smoke test that is flaky only on CI, or a depth artifact visible on hardware that the captured frames never showed. | No test is timed against the wall clock; the smoke test waits on simulation time; large static geometry is separated in depth (the terrain under the arena is sunk 6 m); films are reviewed by a person. | CI owner |
| R3 | Pointer lock is refused in headless browsers, iframes without the right `allow` attribute, and during the browser's cool-down after Esc, so a player can press Deploy and get a game with no mouse look. | Medium | Medium | A report that the game started but the view does not turn, most often right after an Esc. | `InputController.lock()` swallows the rejection and the `pointerlockchange` handler returns to the overlay so the player can click again; the copy on the overlay says Esc releases the mouse. | Input owner |
| R4 | Bloom is the most expensive pass in the stack and the only one whose cost scales with resolution; the first playtest review found the sun behind a slab blooming hard enough to hide the reticle. | Medium | Medium | The frame budget in R1 is missed with bloom on and met with it off, or a review logs the reticle lost in glare. | The threshold stays above 1.0 so only emitters bloom; a radius reduction is recorded as a candidate in [journey/README.md](journey/README.md); exposure 0.38 is the lever in `src/render/scene.ts`. | Render owner |
| R5 | Two playtest thresholds were lowered when first written so the tests would pass, and [evolution.md](evolution.md) records that they are not tuned targets; a balance regression can hide beneath them. | Medium | Medium | A tuning change passes `pnpm balance` while a human finds wave 1 noticeably harder or easier than before. | `tests/balance/gate.ts` derives thresholds from a baseline and CI publishes the `balance-report` artifact (#39); the launch checklist still requires a human playthrough. | Design owner |
| R6 | There is no automated visual regression check, so a renderer change can alter the look of the game and pass every gate. | Medium | High | A pull request touching `src/render/` merges with no frame attached, and a later review finds the dawn sky or the trims changed. | The pull request template asks for a journey entry whenever a frame was captured; the recorder makes a film per seed; item 5 of the "Next" list in [evolution.md](evolution.md) proposes deterministic frame comparison on software GL. | Render owner |
| R7 | The code, the documents, and the deploy settings were all made by one contributor in one morning, so the bus factor is one. | High | Medium | A question about why something was done that no document answers, or a repository setting nobody else can reach. | [AGENTS.md](../AGENTS.md) carries the commands and pitfalls, the ADRs the reasons, [decisions.md](decisions.md) the index, and [runbook.md](runbook.md) the procedures; `CODEOWNERS` names the owner so the gap is visible. | Maintainer |
| R8 | three.js tracks browser APIs closely and removes options between releases; ADR-0001 notes `PCFSoftShadowMap` was already gone at 0.186.1. A Dependabot bump can break the scene without a type error. | Medium | High | A `three` upgrade pull request whose build passes but whose captured frame differs. | Exact pins in `package.json`; every upgrade of `three` is reviewed with a fresh film or frame before merge, as ADR-0001 requires. | Render owner |
| R9 | The GitHub Pages source must be set to GitHub Actions once by hand; the workflow cannot do it, and a fork or a new repository starts with the setting absent. | High | Low | The deploy job fails at `configure-pages`, or the public link returns a 404 while CI is green. | The setting is documented in [runbook.md](runbook.md) and the launch checklist opens the live page before any tag. | Release owner |
| R10 | Browser autoplay policy decides when an `AudioContext` may start, and the policy has changed before; a future change could silence the title drone or the Deploy sting on first click. | Low | Low | The score is silent after a click in a current browser, with no error logged. | Audio is unlocked only inside user gestures (the Deploy click and the first pointer down on the overlay); no action in the game depends on a sound cue alone, per the accessibility requirement in [requirements.md](product/requirements.md). | Audio owner |

## Review cadence

The register is reviewed at every release tag and whenever a row's trigger
fires, whichever comes first, and the review is recorded as a line in
[decisions.md](decisions.md) saying which rows changed. A row is retired
only when its mitigation has made the trigger impossible, not when it has
merely not fired for a while. New rows are added in the same pull request
as the change that introduces the risk, with the issue that would close it
if one exists.
