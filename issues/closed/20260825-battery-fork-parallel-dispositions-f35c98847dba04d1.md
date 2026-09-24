# complete battery red: fork-parallel-dispositions

**Status:** Closed
**Reopened by battery run:** `local.20260923T123621Z.d34227259c10`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-25
**Battery gate:** `fork-parallel-dispositions`
**Failure signature:** `sha256:f35c98847dba04d15442b755e347e8d1b2db337dad021f64bf10f0e93391655b`
**First observed run:** `local.20260825T115521Z.64e70df1e088`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260924T025209Z.0388900b82ae`
**Detected at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `fork-parallel-dispositions` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `fork-parallel-dispositions` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/fork-parallel-dispositions.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
