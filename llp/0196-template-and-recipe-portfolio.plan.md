# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Draft
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (W2), LLP 0195 (public examples mirror), diaries
0068-0069, benchmarks/briefs/

## Summary

The five-run series established the knowledge ladder empirically:
**scaffold beats guide beats package source** — knowledge moved into
template defaults (0.1.15's sessions mode, offline registration, upload
wiring) produced the largest single-release wall-clock improvement of
the program (bare lane 41.5→29.6 min). This Plan extends the portfolio
along the measured demand: two new templates matching the committed
benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T1 — CRUD-dashboard template** (`--template crud-dashboard`), matching
`benchmarks/briefs/crud.md`: tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs.

**T2 — media-feed template** (`--template media-feed`), matching
`briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here).

**T4 — recipes** (guide sections with CI-verified snippets, in priority
order from run evidence): the headless-simulator proof kit (plistlib
scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
ticketed), real-auth sign-in flows beyond test personas, the offline
supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
Recipes graduate into template code where a template naturally exercises
them — the ladder says code placement beats prose.

**T5 — template freshness gate:** templates cold-install and pass their
suites against the *published* closure in CI (the staging lane covers
tarball shape; this covers registry reality), so a template can never
teach a drifted surface.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T1
(benchmark brief pairing makes it immediately measurable), T2, with T4
recipes landing alongside whichever surface they document. T5 joins the
release checklist when T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold.
- The next benchmark run on the CRUD brief uses T1 and its lane report
  cites no template gaps.

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).
