# complete battery red: path-migration-stragglers

**Status:** Open
**Reopened by battery run:** `local.20260922T004103Z.6841e7dc8d89`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dac4e3fed7072c5a682d356adb92275ad2d9b5af`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:d60c951050a11125c47bd80b2a3f00ee92c4d4700a48f49d5813e80b2da9846a`
**First observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last observed run:** `local.20260922T102119Z.50782b08ec43`
**Last processed run:** `local.20260922T102119Z.50782b08ec43`
**Detected at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Last observed revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `path-migration-stragglers` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `path-migration-stragglers` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-path-migration-stragglers.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
