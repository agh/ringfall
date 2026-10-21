---
type: research
title: "Adversarial audit: how much of this is slop, and what was done about it"
status: approved
authors:
  - name: "Ringfall audit agent (Claude), acted on by the hackathon team"
created: 2026-10-21
---

# Adversarial audit

> [spec](spec.md) · [evolution](evolution.md) · [journey](journey/README.md)

Late in the morning an unanchored reviewer was given the whole repository
and asked to find the tics, shortcuts, and hollow patterns that mark
agent-generated work, and every place a document claimed something the
code did not do. The brief was to be harsh and specific. This page keeps
the verdict, the findings that mattered, and what was done with each, so
the next audit can measure drift from here.

## Verdict

Two and a half on a one-to-five slop scale, where five is all slop. The
code is real and the core is genuinely pure. The prose has none of the
lexical tics (no em-dashes outside the house boilerplate, no exclamation
marks, consistent spelling). The slop was structural: documents written in
the present tense for features that did not exist, four non-goal lines
contradicting a shipped feature, tests named for more than they asserted,
self-approved frontmatter, and a rounding bug that made the recorder's
headline promise (a frame-exact film with a synchronized score) false at
the frame rate the demo script used.

## Findings and outcomes

| Severity | Finding | Outcome |
| -------- | ------- | ------- |
| High | `Math.round(60 / 24) = 3` steps per frame: a 40 s film held 48 s of play and the offline score drifted by 8 s | Fixed: the recorder refuses frame rates that do not divide 60; `pnpm demo` films at 30 fps; the film already captured at 24 fps is encoded at 20 fps so it plays in real time |
| High | Four documents said "no persistence of any kind" while personal bests were shipped and listed as done | Fixed in all four |
| High | A bot test titled "reckless dies sooner" asserted the opposite with a 0.5 factor chosen to pass | Tests renamed to what they assert; a printed balance report replaces the claim |
| High | The bot read enemy health and targeted enemies beyond sight and tracker range while documents said it sees what a player sees | Fixed: candidates are visible or within 28 m, health is not used; documents now say exactly that |
| High | Spec claimed a five-to-ten-minute demo ending on a tableau and "thousands of games a minute"; measured: no wins in 40 games, a few hundred games a minute | Spec reworded with measured numbers; the tableau is marked as not built (#8) |
| High | Brand document called itself the source of truth while CSS used other fonts and off-token colors | HUD v2 applied the fonts and tokens; status set to draft |
| High | Product documents described hit-stop, a shake cap, and a toggle in the present tense | Hit-stop and the cap were built in the HUD pass; the toggle is still unbuilt and the requirement says so |
| High | Three documents said the smoke test waits for a wave to spawn; it stopped doing so deliberately | Fixed |
| Medium | Hard-coded coverage figures and test counts in three places | Replaced with thresholds and the command that prints the actuals |
| Medium | Journey review dated after its own commit; "flags removed" while three remained | Timestamp corrected; the remaining diagnostics are named |
| Medium | Design doc contradicted itself on strider aiming and misquoted effect timings | Fixed from the constants |
| Medium | Changelog presented a release with no tag | Folded under Unreleased |
| Medium | Two dead citations, one paraphrase shown in quotation marks, one citation that argued the opposite | Removed, reworded, corrected |
| Medium | Three copies of the sound design across live, music, and offline modules with different gains | Fixed (#33): `src/audio/sounds.ts` holds every voice, the charge hum, and the choir as data; the live bank and the offline score schedule from it, differing only in the live pitch jitter and the documented offline effects-bus gain; `tests/unit/sounds.test.ts` fails if a `GameEvent` type is in neither the table nor `SILENT` |
| Medium | Complexity rule set to warn and tolerated on nine functions | Open: enforce or delete the rule |
| Low | Unused export with `x - x`, an unused canvas hook, a no-op gain, a duplicate death check, snake_case shim, vestigial range tracking | Removed except the shim and range tracking, which are cosmetic |

## What the audit found genuinely good

The pure core (verified by grep), the draft-and-freeze step with a
passed-in random source, tests that exposed real behavior, the storage
module's tolerant design, the GPU particle pool, accurately quoted
decision-bearing citations, and a journey log that names the squash and
the overruled calls.

## The tics to watch for, in this project

Present tense for unbuilt features. Numbers copied into prose instead of
read from constants. Test names that promise more than the assertion.
Thresholds chosen because they pass. "Source of truth" sentences on
documents that are not. Self-approval in frontmatter. Research notes that
grade their own client. These are the patterns the next audit should grep
for first, and the pull request template now asks for the evidence that
prevents most of them.
