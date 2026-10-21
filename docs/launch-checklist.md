---
type: checklist
title: "Ringfall launch checklist: go or no-go before tagging v2026.10.0"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall launch checklist

> [Ringfall](../README.md) > [Specification](spec.md) > Launch checklist

This list is read aloud before the release owner tags `v2026.10.0`. It is
written in the spirit of the launch checklists in the Google SRE book:
every item names the disaster it prevents, so an item can be struck out
when the disaster no longer applies and nobody has to remember why it was
there. An item is ticked only with evidence attached, a link to a run, a
frame, or a command transcript, as [AGENTS.md](../AGENTS.md) requires of
every verification claim. Any unticked item is a no-go.

## The list

**Pages is live and playable.** Open <https://agh.github.io/hack/> in a
clean browser profile, click Deploy, and play into wave 2. This prevents
tagging a release whose public link shows a blank canvas because the Pages
source was never set to GitHub Actions or the deploy job failed quietly
after the CI jobs passed. The deploy workflow is separate from CI, so a
green CI badge proves nothing about the site.

**CI is green on the exact commit to be tagged.** The lint, unit, browser
smoke, and build jobs in `.github/workflows/ci.yml` must all pass on the
head of `main`, not on an earlier commit. This prevents a tag pointing at a
commit that was pushed after the last green run, which is how a release
ships with a type error nobody saw.

**No secret and no known high-severity advisory ships.** The
`Security and workflow hygiene` job in `.github/workflows/ci.yml` must be
green on the same commit: `pnpm audit --audit-level=high` with every ignore
under `pnpm.auditConfig` in `package.json` re-read and still justified,
gitleaks over the working tree and the pushed history with
`.gitleaks.toml`, and actionlint and zizmor over the workflows. This
prevents tagging a release whose history carries a token or whose
toolchain carries a published high-severity advisory, which a green build
job says nothing about.

**A person has played through to the final wave.** Someone plays the
deployed page from the title card to the victory tableau on wave 8 with a
mouse and keyboard, and records the time taken against the five to ten
minute target in [spec.md](spec.md). This prevents shipping a game the bot
can win but a human cannot, which the playtest layer is explicitly not
designed to catch, as [test-plan.md](test-plan.md) says under "What is
deliberately not tested".

**The bot balance assertions are green.** Run `pnpm balance` and attach the
output. The four tests in `tests/unit/bot.test.ts` must pass: determinism
for a seed, first-wave clearance with accuracy above 30 percent and at
least three kills on seed 3, a summary across six seeds with at least one
wave cleared on average, and the reckless profile taking at least half the
shield breaks of the steady one. This prevents a tuning change from making
wave 1 unwinnable or the shield loop irrelevant without anyone noticing.

**The brand checklist is ticked.** Walk the twelve items in
[brand.md](brand.md) under "Consistency checklist" against the deployed
page: palette tokens only, warm colors semantic, no Beacon on enemies and
no Rose in the world, Slate borders on every panel, no text under 14 px,
no exclamation marks, thin trim on the datum, bloom threshold above 1.0
with ACES tone mapping, no external audio, music ramps rather than cuts,
and the shake cap respected. This prevents the demo reel and the live page
disagreeing with each other and with the banner.

**Screenshots come from a clean profile with metadata stripped.** Every
image under `docs/journey/images/` and anything attached to the release
was captured from a fresh browser profile with synthetic data, and its
metadata was removed before it was committed, as [AGENTS.md](../AGENTS.md)
requires under "Public output". A quick check is `exiftool` reporting no
maker, software, or GPS fields; re-exporting the image is an alternative
when that tool is absent. This prevents a screenshot disclosing a machine
name, an account, or a session.

**CHANGELOG.md and VERSION agree.** `VERSION` reads `2026.10.0` and
`CHANGELOG.md` must carry a `## [2026.10.0] - 2026-10-21` section that
describes what the tag contains, with an empty `[Unreleased]` above it.
Today the unreleased section still holds renderer v2, the score, the
playtest bot, the recorder, and the personal bests, so the release owner
must either move those entries under the version being tagged or tag a
later version; tagging as things stand would publish release notes that
omit most of the product. This prevents a tag whose notes describe a
different build from the one deployed.

**No franchise words in code or copy.** [ADR-0003](adr/0003-original-ip-only.md)
rules out the inspiring franchise's names in code, metadata, and marketing
copy. Run the grep below with the names from that ADR's context in place
of the placeholder; the research reports under `docs/research/` are
excluded because they cite their sources by name, and that is the only
place such names are allowed. The grep must print nothing.

```bash
git grep -n -i -E '<names from ADR-0003>' -- src tests scripts public index.html README.md CHANGELOG.md AGENTS.md package.json docs ':!docs/research'
```

This prevents a public MIT repository and a public URL redistributing a
trademark.

**The demo film is regenerated from the tagged commit.** Check out the
commit to be tagged, run `pnpm build` and `pnpm demo`, and review the
resulting `demo.mp4` with a row in the playtest reviews table of
[journey/README.md](journey/README.md) that names the seed and the frame
range. This prevents the reel showing a build that differs from the one
people will play, which is the first thing a judge will notice.

## After the tag

Push the tag, confirm the Pages deploy for that commit finished, and add
the reviewed film to the release. Nothing in this list is a promise of a
date or a schedule; it is the order in which the evidence is collected.
