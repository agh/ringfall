---
type: research
title: "What a product manager would produce for Ringfall, and what docs/ must hold"
status: reference
authors: ["Ringfall research agent (Claude), reviewed by the hackathon team"]
created: 2026-10-21
---

# What a product manager would produce, and what docs/ must hold

A research note produced during the hackathon by a delegated agent and
reviewed by the team. It led directly to `docs/product/` and to the
operational documents listed in the shelf table below.

## Verdict

The engineering shelf (design doc, ADRs, test plan, changelog, journey)
was unusually complete for a morning. The product shelf was not: the
specification was doing the job of a concept pitch, a requirements
document, and a scope cut at once. The highest-value hour was to split it
into a PR/FAQ and a PRD with numbered, testable requirements, add a text
storyboard, treat the brand document as the art bible, and add the small
operational documents a release needs.

## Concept proposal

Amazon's PR/FAQ is written before any code exists, fits on one page, and
pairs customer questions with internal ones; the press release "serves as
our North Star" and teams then ship minimum lovable products
([AWS Executive Insights][aws]). Marty Cagan's opportunity assessment asks
ten questions ending in go or no-go ([SVPG][svpg]). Basecamp's Shape Up
pitch, with its "appetite" and "rabbit holes", is the best fit for a
time-boxed build ([Shape Up][shapeup]). On game pitches, Finji's Rebekah
Saltsman warns that lore-first pitches bore publishers and that a vertical
slice is a polished seven to thirteen minute playthrough
([Game Developer][saltsman]). Stone Librande's one-page designs argue the
page limit forces the cuts ([Game Developer][librande]); Ian Schreiber's
four one-pagers are vision, pillars, loops, resource flow
([GDC Vault][schreiber]). Valve's counter-example is the Cabal's
200-page document edited by 200 playtests ([Birdwell][cabal]). Hackathon
judges want the project stated in the first sentence and one complete path
demoed ([judge notes][judges]).

Applied: `docs/product/concept-proposal.md` in the crefft PR/FAQ form.

## Requirements specification

Lenny Rachitsky's template roundup favours Square's PRD for its Non-Goals
and Steve Morin's one-pager for success criteria ([Lenny][lenny]). Google
design docs cover context, goals and non-goals, design, alternatives, and
cross-cutting concerns ([Ubl][google]). Pillars are "for settling
arguments, not for decoration" ([Allo][allo]). Acceptance criteria tie to
tests by tagging scenarios with the requirement ID
([Fowler][gwt]; [TestQuality][tq]). A PRD states the what; an ADR records
why X over Y and is superseded, never edited ([Cognitect][nygard]). For
coding agents, Addy Osmani's rules apply: exact versions, commands, a
success section with tests, boundaries, no step-by-step plans that go
stale ([Osmani][osmani]; [GitHub][spec-driven]).

Applied: `docs/product/requirements.md` with stories S1 to S10, each with
acceptance criteria that name the test layer, and a traceability table.

## Storyboards

Beat sheets list beats in order; thumbnails come before an animatic
([UW CSE 456][uw]; [Gnomon][gnomon]). Trailer structure per Derek Lieu:
hook in the first five seconds, core loop to twenty-five, escalation to
forty-five, title last ([presskit.gg][lieu]; [PC Gamer][pcgamer]). The
first thirty seconds decide retention ([Game Developer][hook]). Because
Ringfall's recorder steps the simulation per frame, each beat can carry an
exact frame index, which is a stronger animatic than a drawing. Mermaid
timelines render on GitHub ([Mermaid][mermaid]); Storyboarder is overkill
when the game films itself ([Wonder Unit][storyboarder]).

Applied: `docs/product/storyboard.md`.

## Art direction

An art bible holds per-state mood targets, silhouette readability at
thumbnail size, a semantic palette, and a VFX language
([makko survey][makko]). Valve's TF2 paper is the primary source for
silhouette rules: "Even when viewed only in silhouette with no internal
shading at all, the characters are readily identifiable"
([Valve][tf2]). Riot's VFX style guide sets the effects rules: emphasise
focus, scale matches importance, anticipation then payoff
([Riot][riot]). Overwatch's pillars include big bold silhouettes that skins
must not change ([Game Developer][overwatch]). With procedural art and no
artist, the art bible is the constraint set
([No Man's Sky][nms]; [EA SEED][seed]).

Applied: `docs/product/art-direction.md` complementing `docs/brand.md`.

## The docs/ shelf

| Document | Purpose | Readers | Changes when | Status after this morning |
| -------- | ------- | ------- | ------------ | ------------------------- |
| Concept proposal | Validate the bet; what judges read | Judges, leadership, new agents | Only when the bet changes | `docs/product/concept-proposal.md` |
| PRD | Numbered requirements with thresholds, pillars, loop, non-goals | PM, engineers, agents, test authors | Each release | `docs/product/requirements.md` |
| Storyboard | First 30 s, reel, ending with beat, camera, event, sound | Render and audio owners, reviewers | When choreography changes | `docs/product/storyboard.md` |
| Art bible | Palette, type, silhouettes, VFX language, checklist | Anyone touching visuals | Same PR as any visual change | `docs/brand.md` plus `docs/product/art-direction.md` |
| Design doc | Architecture and every tuning number | Engineers, agents | Living during build | `docs/design-doc.md` |
| ADRs | Permanent why-records | Future team | Superseded, never edited | `docs/adr/` |
| Decision index | One line per decision, where recorded | Everyone | Append on every merge | `docs/decisions.md` |
| Test plan | Layers and gates | Engineers, CI | When a gate changes | `docs/test-plan.md` |
| Evolution | How intent is proven and the product evolves safely | Sceptical engineers, agents | When a gate or practice changes | `docs/evolution.md` |
| Release notes | Per-version changes | Players, maintainers | Every release | `CHANGELOG.md` |
| Runbook | How to run, deploy, film, and fix known faults | Whoever runs the demo | When a procedure changes | `docs/runbook.md` |
| Launch checklist | Go or no-go before a tag | Release owner | Per release | `docs/launch-checklist.md` |
| Risk register | Risks with triggers and mitigations | PM, release owner | Each review | `docs/risks.md` |
| Metrics | Definitions of every reported number | Designers, gate authors | When a definition changes | `docs/metrics.md` |
| Glossary | Ubiquitous language | New humans and agents | When a term is coined | `docs/glossary.md` |
| Journey log | Time-indexed narrative with frames | Judges, retrospective | Append during build | `docs/journey/README.md` |
| Retrospective | What went well, what to change | Team | Once, after the demo | not yet; written last |
| Research | Sourced evidence | Authors of the above | Rarely | `docs/research/` |

Also required by crefft's GitHub templates guide and added alongside:
issue forms, a pull request template, `CODEOWNERS`, `CONTRIBUTING.md`,
`SECURITY.md`.

## How the work was parallelised

Three lanes ran at once on one branch: product documents (concept
proposal, PRD, storyboard, art direction) by one agent; operational
documents and GitHub templates by a second; research and review by a
third. The only sequencing constraint was that the PRD's story IDs exist
before the operational documents cross-link them, which held because the
product lane finished first. Nothing under `src/` changed, so CI for the
documentation commits is lint only.

## Sources

[aws]: https://aws.amazon.com/executive-insights/content/product-management-at-amazon/
[svpg]: https://www.svpg.com/assessing-product-opportunities/
[shapeup]: https://basecamp.com/shapeup/1.5-chapter-06
[saltsman]: https://www.gamedeveloper.com/business/pitching-your-game-with-rebekah-saltsman
[librande]: https://www.gamedeveloper.com/design/video-one-page-designs
[schreiber]: https://gdcvault.com/play/1035510/The-Four-One-Page-Design
[cabal]: https://www.gamedeveloper.com/design/the-cabal-valve-s-design-process-for-creating-i-half-life-i-
[judges]: https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l
[lenny]: https://www.lennysnewsletter.com/p/my-favorite-templates-issue-37
[google]: https://www.industrialempathy.com/posts/design-docs-at-google/
[allo]: https://allo.io/blog/en/game-design-document-template/
[gwt]: https://martinfowler.com/bliki/GivenWhenThen.html
[tq]: https://testquality.com/scaling-gherkin-software-testing-strategies/
[nygard]: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
[osmani]: https://addyosmani.com/blog/good-spec/
[spec-driven]: https://github.blog/ai-and-ml/generative-ai/spec-driven-development-using-markdown-as-a-programming-language-when-building-with-ai/
[uw]: https://courses.cs.washington.edu/courses/cse456/15su/assignments/assignment_3
[gnomon]: https://w.thegnomonworkshop.com/blog/creating-beatboards-for-pre-production
[lieu]: https://presskit.gg/field-guides/game-trailers-screenshots-guide
[pcgamer]: https://pcgamer.com/the-art-of-making-effective-game-trailers
[hook]: https://www.gamedeveloper.com/design/the-30-second-hook
[mermaid]: https://mermaid.js.org/syntax/timeline.html
[storyboarder]: https://wonderunit.com/storyboarder/
[makko]: https://blog.makko.ai/what-public-game-art-bibles-say/
[tf2]: https://www.advances.realtimerendering.com/s2007/Mitchell-IllustrativeRenderingInTF2(Siggraph07%20Course%20Notes).pdf
[riot]: https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/
[overwatch]: https://gamedeveloper.com/art/video-defining-and-evolving-the-art-direction-of-i-overwatch-i-
[nms]: https://www.nomanssky.com/2015/02/no-mans-sky-at-gdc/
[seed]: https://www.ea.com/seed/amp/news/seed-gdc-2018-presentation-slides-creativity-of-rules-and-patterns

- <https://aws.amazon.com/executive-insights/content/product-management-at-amazon/>
- <https://www.svpg.com/assessing-product-opportunities/>
- <https://basecamp.com/shapeup/1.5-chapter-06>
- <https://www.gamedeveloper.com/business/pitching-your-game-with-rebekah-saltsman>
- <https://www.gamedeveloper.com/design/video-one-page-designs>
- <https://gdcvault.com/play/1035510/The-Four-One-Page-Design>
- <https://www.gamedeveloper.com/design/the-cabal-valve-s-design-process-for-creating-i-half-life-i->
- <https://www.lennysnewsletter.com/p/my-favorite-templates-issue-37>
- <https://www.industrialempathy.com/posts/design-docs-at-google/>
- <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>
- <https://addyosmani.com/blog/good-spec/>
- <https://presskit.gg/field-guides/game-trailers-screenshots-guide>
- <https://www.advances.realtimerendering.com/s2007/Mitchell-IllustrativeRenderingInTF2(Siggraph07%20Course%20Notes).pdf>
- <https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/>
- <https://sre.google/sre-book/reliable-product-launches/>
- <https://martinfowler.com/bliki/UbiquitousLanguage.html>

Unverified in the session: GDC Vault pages redirected to maintenance, so
Schreiber's and Saltsman's abstracts come from gdconf.com news and search
snippets; Riot's style guide PDF now redirects, so it is cited through the
article.
