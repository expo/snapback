# complete battery red: kernel-raw-sql-api

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `kernel-raw-sql-api`
**Failure signature:** `sha256:abf0566fbf4baf45668a23a935c9e4ec0f0a33081256cbc9ef04756e18ca4f1e`
**First observed run:** `local.20260827T191659Z.cf68cae13934`
**Last observed run:** `local.20260827T191659Z.cf68cae13934`
**Last processed run:** `local.20260827T191659Z.cf68cae13934`
**Detected at revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Last observed revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `kernel-raw-sql-api` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `kernel-raw-sql-api` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-kernel-raw-sql-api.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
