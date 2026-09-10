# complete battery red: security-boundaries

**Status:** Open
**Reopened by battery run:** `local.20260828T114709Z.095880f16775`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `security-boundaries`
**Failure signature:** `sha256:562f5f3c18d7d4dcffd6c1f37427807ec89ee628628a9734cf63d9e3a7b2998e`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last processed run:** `local.20260910T020125Z.c971a88a5bb1`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
**Consecutive red runs:** `34`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `security-boundaries` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `security-boundaries` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-security-boundaries.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
