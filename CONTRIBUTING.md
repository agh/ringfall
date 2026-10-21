# Contributing to Ringfall

> [Ringfall](README.md) > Contributing

Contribute by opening an issue using the repository's issue forms: a bug
report or a feature proposal. The maintainer, and the coding agents the
maintainer runs, make the changes; external pull requests are closed with
a pointer to those forms. Dependabot pull requests continue.

**Why**: issues let the evidence and the scope be settled before code is
written, and every change still has to clear the same gates.

## Proposing a change

Search the open issues first; the backlog is the MLP epic (#2) and the
Later epic (#3). For a bug, give the seed if the bug is in gameplay,
because the simulation is deterministic and a seed reproduces it exactly.
For a feature, name the player moment and the test layer that would prove
it, as the form asks. Check the problem against the latest release and the
deployed page at <https://agh.github.io/hack/> before filing.

Support is best effort, for the latest release only, with no service
levels, promised response times, or guaranteed fixes.

For security problems use GitHub's private vulnerability reporting as
described in [SECURITY.md](SECURITY.md), not a public issue.

## Maintainer workflow

The house standards are [crefft](https://github.com/agh/crefft); the
project-specific context, commands, and pitfalls are in
[AGENTS.md](AGENTS.md), and the procedures are in
[docs/runbook.md](docs/runbook.md). A change is made on a branch, verified
with `pnpm check` and, where the browser layer is touched, `pnpm test:e2e`,
and opened as a pull request against `main` using the template, which
asks for the commands run, the brand checklist when visuals changed, and a
journey entry when a frame was captured.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
with an imperative subject of at most 72 characters, for example
`feat(core): add flee state on strider death` or
`docs(runbook): add the Pages source setting`. Every user-visible change
adds a line to `CHANGELOG.md` under `[Unreleased]`. `VERSION` is not
edited in a pull request; releases are cut with the
[launch checklist](docs/launch-checklist.md) under calendar versioning.

## Code of conduct

This project follows the
[Contributor Covenant](https://www.contributor-covenant.org/). Be
respectful and constructive.
