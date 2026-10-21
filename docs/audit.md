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
| High | `Math.round(60 / 24) = 3` steps per frame: a 40 s film held 48 s of play and the offline score drifted by 8 s | Fixed in part: `pnpm demo` films at 30 fps, but the recorder still rounds `60 / fps` and does not refuse rates that do not divide 60 (second audit); the film already captured at 24 fps is encoded at 20 fps so it plays in real time |
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
module's tolerant design, the GPU particle pool, and a journey log that names the squash and
the overruled calls.

## The tics to watch for, in this project

Present tense for unbuilt features. Numbers copied into prose instead of
read from constants. Test names that promise more than the assertion.
Thresholds chosen because they pass. "Source of truth" sentences on
documents that are not. Self-approval in frontmatter. Research notes that
grade their own client. These are the patterns the next audit should grep
for first, and the pull request template now asks for the evidence that
prevents most of them.

## Second audit

> Reviewers: five, one per dimension, against `main` at `ba1fa99` at
> 17:33 UTC on 2026-10-21, after an afternoon of agents writing in parallel.
> The full checklist with every finding and outcome is on issue #54.

### Verdict

Two and a half, the same as the first audit. The kinds of slop changed;
the density did not fall. The lexical tics are still absent and most
numbers in prose matched the constants when checked (a long list of
gameplay numbers, ports, script defaults, pitfalls, commit hashes and
issue numbers all verified). The slop was again structural, and it came
from three places. Documents lagged the code by an afternoon: the spec
still called the rout and the balance gate unbuilt hours after both
merged, the changelog listed one of the six merges of the day, and the
metrics and launch checklist described bot tests that no longer exist.
The first audit itself claimed a fix that was never made: the recorder
has no frame-rate guard, only the demo's frame rate changed. The research
notes contained three quotations whose words are not in their sources,
five citations used for claims the sources do not make, two documents
grading the project's own work, and one dead and one soft-dead link. One
reviewer ran every command in AGENTS.md and the runbook; all run, and the
findings there were stale descriptions (which script `pnpm balance` runs,
24 against 30 fps, "three" query parameters) rather than broken
procedures.

### Findings and outcomes

| Severity | Finding | Outcome |
| -------- | ------- | ------- |
| High | Spec rows called the rout (#40) and the balance gate (#39) unbuilt, and listed the second weapon as Later while six weapons and a swap key are shipped; the design doc's non-goals excluded weapons and pickups; the concept proposal and glossary repeated the Later claim | Fixed: rows updated, a sixteenth MLP row added, NG3 is vehicles |
| High | The first audit recorded a recorder frame-rate guard as fixed; `scripts/record-demo.mjs` still rounds `60 / fps` with no check, and the runbook and journey repeated the claim | Fixed in all three; logged as a wrong call in the journey |
| High | A shake accessibility toggle was described as built in the brand document, the art direction and the requirements while no toggle existed at `ba1fa99` | Overtaken: the settings panel with the switch merged (#48, #65) during the audit; the four passages now point at `src/core/settings.ts` |
| High | Metrics and the launch checklist described four bot tests with assertions that do not exist (3 kills on seed 3, ratio above 0.3, reckless at least half of steady); the suite has twelve tests with different assertions, and `pnpm balance` runs `tests/balance`, not `bot.test.ts` | Fixed: the actual assertions are stated and the checklist points at `tests/balance/gate.ts` |
| High | Changelog Unreleased omitted #34, #36, #39 and #42 | Fixed |
| High | README docs index omitted seven top-level documents, four of which no document linked to | Fixed |
| High | Three quotations not in their sources (Opdahl, instagib-arena, drift-arena) and five citations that do not support their claims (Overwatch silhouettes, art bible as constraint set, art-bible contents, Infinitown size, Dwasm size) | Fixed with the sources' own words |
| High | The README Play-now domain has no DNS record and the launch checklist says Pages is live; the repository is private with Pages off | Fixed: both marked not yet live, dated |
| High | AGENTS.md said `pnpm lint` is Biome only; it also runs markdownlint | Fixed |
| Medium | Future tense for #12 and #5 in risks and evolution; "will be" tested for the sound table that #42 tested; a test-plan baseline that `main` no longer printed (steady 20%, reckless 5% after #40, gate passes) | Fixed; the baseline was re-derived on `main` at `84a835b` by #47 while the audit ran, and that table is kept |
| Medium | Runbook: `pnpm check` does not use port 4173; `?atmo` and `?weather` undocumented; no reel procedure though the script points at the runbook; wrong claim about Chromium builds; `pnpm test:e2e` deletes the balance report the launch checklist asks to attach | Fixed in prose; the Playwright `outputDir` change is code and deferred |
| Medium | Journey: wrong-calls list missing two calls the log narrates; "an hour and a half left" at 16:05; "thirty-three by the end"; PR #1 times off by a minute; three film frames never embedded; decisions index claimed a tag that does not exist | Fixed |
| Medium | Brand document still said "source of truth"; two research notes graded the project's own work; concept proposal said the demo has an ending | Fixed |
| Medium | Dead screenshake devlog and quakejs.com links | Fixed: removed, attribution kept |
| Medium | Riot VFX guide redirects to a homepage, a UW course link needs a login, three bungie.org and Princeton pages reset the connection from the sandbox | Deferred: needs verification or a Wayback capture from an unproxied network |
| Medium | Every document fails the crefft frontmatter schema; four carry `approved:` with no reviewers on a draft | Deferred to #43, which owns the schema |
| Low | Command comments, controls table, "two research reports", research MLP numbering, Griesemer row dropping the cover condition, misattributed trailer structure and requirement tagging, the Grunt quotation's speakers, "every claim carries a source" | Fixed |
| Low | Journey images named `1535-*` for frames committed at 15:29; a brand sentence on ringworld width the citations do not support; the complexity rule still at warn (seven warnings) | Open |

Seventy findings, fifty-six fixed in the pull request for #54, fourteen
deferred or verified as not needing a change.

### The tics to add to the list

A status column that is not re-read after a merge. A "Fixed" that names
a change nobody made; grep the fix commit for the file. A quotation that
reads better than the source. A link that was live when the agent read
it and is not when a reader does; fetch every URL before a release.
Twenty agents writing in parallel make the first two certain unless one
agent's job is to re-read.
