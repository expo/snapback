# complete battery red: regression-optimistic-clobber

**Status:** Closed
**Reopened by battery run:** `local.20260905T203247Z.810fbda46e64`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:dd41466b4536bc02bcccf426851391a247eed965a3382eec99cd4af762122316`
**First observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last observed run:** `local.20260905T203247Z.810fbda46e64`
**Last processed run:** `local.20260906T052615Z.c519d102c963`
**Detected at revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
**Last observed revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-optimistic-clobber` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-optimistic-clobber` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-optimistic-clobber.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
