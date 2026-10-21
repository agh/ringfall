External pull requests are closed in favour of
[issue forms](https://github.com/agh/ringfall/issues/new/choose), so the
evidence and scope are settled before code is written. Dependabot pull
requests continue. This checklist is for pull requests by the maintainer
and the agents the maintainer runs.

## Summary

One paragraph: what changed and which loop in `docs/spec.md` it makes
better.

## Related issues

Fixes #

## Verification

Paste the commands run and their results. A claim without a transcript is
reported as unverified, per `AGENTS.md`.

```text
pnpm check
pnpm test:e2e
pnpm balance
```

## Checklist

- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] Gameplay numbers changed in `src/core/` are updated in `docs/design-doc.md` in this pull request
- [ ] Visuals changed: the twelve-item consistency checklist in `docs/brand.md` is ticked below
- [ ] A frame or film was captured: a dated entry with seed and frame range is added to `docs/journey/README.md`
- [ ] Screenshots come from a clean profile with metadata stripped (`AGENTS.md`, "Public output")
- [ ] No franchise names, assets, audio, or lore (ADR-0003)

## Brand checklist (only when visuals changed)

Copy the twelve items from `docs/brand.md` here and tick each one, or
write "no visual change".
