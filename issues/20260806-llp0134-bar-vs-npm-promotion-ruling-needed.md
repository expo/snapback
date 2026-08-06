# Author decision: what LLP 0134 evidence must an npm promotion carry?

**Status:** Open — needs Charlie's ruling
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 4
**Systems:** Packaging, Process
**Date:** 2026-08-06
**Related:** `issues/20260803-first-npm-latest-promotion.md` (item 2 names
the bar), LLP 0134 (maturity promotion machinery), LLP 0041 / LLP 0111
(actual owners of npm dist-tags and release ledgers)

## Summary

Found by today's promotion-machinery audit:
`issues/20260803-first-npm-latest-promotion.md` item 2 requires running
"the LLP 0134 machinery for real" before the first npm `latest` promotion,
but that bar is both currently unmeetable and, per 0134's own text, not the
bar that governs npm releases.

- `llp/0134-capability-maturity-promotion.spec.md:339-381` (E6) requires at
  least 14 consecutive UTC days of green soak coverage per
  `targetProfileId × UTC-day` cell, witnessed by conforming
  `MaturitySoakObservationV1` receipts; any uncovered cell fails E6.
  `tests/acceptance/maturity/` holds exactly one soak observation —
  `inline-handler-local-dev-2026-08-03.soak-observation.json` (one profile,
  one day, 2026-08-03). The 14-day window cannot be satisfied today.
- 0134's Non-goals (`llp/0134-capability-maturity-promotion.spec.md:
  1030-1032`) explicitly disclaim packaging and channel policy: "npm
  dist-tags and release ledgers stay with LLP 0041/0111."

So the promotion capstone names a qualification bar that cannot currently
be met and that the bar's own spec says does not govern npm releases.

A second decision is entangled: the target version. At audit time `0.1.9`
appeared only as an inference from guide fences (`<!-- since: 0.1.9
unreleased -->` markers in `guide/backend/mutations.md` and
`guide/auth/sessions-and-principals.md`) — not a recorded decision. Every
`packages/*/package.json` says `0.1.0`, and the version is operator-supplied
at publish time (`scripts/snapback-publish.mjs:81` default `0.1.0`, `:99`
`--version`, `:272` stamps it into the staged manifests).

Same-day update: the Lane D preflight entry (2026-08-06, in
`issues/20260803-first-npm-latest-promotion.md`) has since recorded 0.1.9
executing on the 0.1.8 fast-path shape under LLP 0041's standing
pre-consumer ruling, with the 0134 soak window decoupled as its own 14-day
program. That resolves this release operationally but leaves both questions
below standing for future promotions.

## Ask

Charlie's ruling, recorded here and in the promotion capstone ticket:

1. What LLP 0134 evidence, if any, must an npm promotion carry? Options
   include: none (0134 governs capability maturity, not packaging — item 2
   is rescoped or struck), a reduced bar for the first promotion, or a
   started-but-incomplete soak with the 14-day window as a later gate.
2. Who decides the target version, and where is that decision recorded?
   Confirm or replace the inferred `0.1.9`.
