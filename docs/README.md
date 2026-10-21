---
type: readme
title: "Ringfall documentation shelf"
status: draft
authors:
  - name: "Ringfall hackathon team"
created: 2026-10-21
---

# Ringfall documentation shelf

> [Ringfall](../README.md) > Documentation

Every document under `docs/` carries frontmatter validated against
[frontmatter.schema.json](frontmatter.schema.json) by `pnpm lint:docs`.
The root [README.md](../README.md) repeats the first rows of this table
for readers arriving from GitHub; this file is the complete shelf.

| Document | What it holds |
| -------- | ------------- |
| [spec.md](spec.md) | Chapter 1 specification, Minimum Lovable Product versus Later, mastery goals, easter eggs |
| [product/](product/) | Concept proposal (PR/FAQ), product requirements with traceability, text storyboard and demo-reel cut list, art direction |
| [design-doc.md](design-doc.md) | Architecture and every gameplay number with its rationale |
| [brand.md](brand.md) | Palette, typography, geometry language, audio identity, feel values, PR checklist |
| [test-plan.md](test-plan.md) | Static, unit, playtest, balance gate, browser, visual, and recording layers |
| [threat-model.md](threat-model.md) | Trust boundaries, assets, threats by boundary with controls and gaps, admin items, residual risk and review cadence |
| [risks.md](risks.md) | Risk register with triggers, mitigations and owner roles |
| [launch-checklist.md](launch-checklist.md) | Go or no-go items read aloud before a tag, each with the disaster it prevents |
| [runbook.md](runbook.md) | Run, build, deploy, test, film, and fix |
| [metrics.md](metrics.md) | Balance and playtest numbers and how they are measured |
| [evolution.md](evolution.md) | How intent is proven in code, how regressions are prevented, how the product evolves with agents |
| [decisions.md](decisions.md) | Append-only decision index |
| [glossary.md](glossary.md) | Terms used across the documents |
| [audit.md](audit.md) | Adversarial audits of the repository and what was done about each finding |
| [research/](research/) | Sourced research on the reference console shooter's design, browser WebGL prior art, and product management |
| [journey/](journey/) | Time-indexed build log with captured frames |
| [adr/](adr/) | Architecture decision records |
| [diagrams/](diagrams/) | PNG renders of the Mermaid diagrams kept as text in the documents above |
