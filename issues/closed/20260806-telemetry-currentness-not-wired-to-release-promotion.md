# Telemetry exact-current check is not wired into release or promotion

**Status:** Closed — resolved 2026-08-07
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Testing, Release, Capability maturity, Telemetry
**Date:** 2026-08-06
**Related:** LLP 0154 rolling trailing-head amendment; LLP 0175 D2.4

## Summary

`scripts/verify-telemetry-phase1-proof --require-current` correctly rejects a
retained Phase-1 receipt unless its complete source closure matches the exact
clean candidate revision. Ordinary `--check` deliberately accepts explicit
ancestral `LAGGING` and `OVERDUE` states so continuous `main` development does
not corrupt honest historical evidence.

No repository release or capability-promotion authority currently invokes
`--require-current`. The CLI mode therefore defines the required boundary but
does not enforce it at the operation that needs it. Until a caller is wired and
tested, telemetry evidence must not be cited as authorization for a release or
capability promotion.

## Resolution requirements

1. Identify every repository-owned release and capability-promotion entry
   point that consumes telemetry evidence.
2. Invoke `scripts/verify-telemetry-phase1-proof --require-current` before any
   irreversible release/promotion effect, against the frozen candidate SHA.
3. Add executable fixtures proving `CURRENT` proceeds and
   `LAGGING | OVERDUE | DIVERGED | invalid` all refuse before the effect.
4. Update LLP 0154 and LLP 0175 from “blocked” to the landed authority and cite
   its exact gate.

This is separate from the scheduled `telemetry-latest-main` producer. That
workflow creates source-bound candidates and rolling-health evidence; it does
not itself perform or authorize a release.

## Resolution — 2026-08-07

Repository inspection confirmed the original scope finding: no release or
capability-promotion entry point consumed the retained telemetry receipt, and
no capability-maturity record or maturity validator cited telemetry evidence.

The exact-current gate is now wired into both real release authorities through
`scripts/telemetry-release-gate.mjs`:

- real `scripts/snapback-publish.mjs --publish` assesses the clean checkout's
  qualified candidate revision before the npm publication loop and retains the
  assessment in the candidate ledger; and
- `scripts/snapback-promote.mjs` assesses the candidate ledger's frozen
  revision before publication-authority lease acquisition or any dist-tag
  operation and retains the assessment in the promotion receipt.

The verifier accepts an explicit frozen revision, reads the proof-source list
and bytes from that Git tree, and computes changed-source detail between Git
revisions without consulting the promotion working tree. Executable fixtures
prove `CURRENT` proceeds while `LAGGING`, `OVERDUE`, `DIVERGED`, invalid
evidence, and candidate-head mismatch all refuse before a modeled irreversible
effect. LLP 0154 and LLP 0175 now name the landed callers, exact invocation,
receipt citations, and the honest current capability-maturity scope.
