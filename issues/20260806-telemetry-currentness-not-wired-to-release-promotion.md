# Telemetry exact-current check is not wired into release or promotion

**Status:** Open
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
