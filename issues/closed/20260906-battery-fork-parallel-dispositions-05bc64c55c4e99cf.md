# complete battery red: fork-parallel-dispositions

**Status:** Closed
**Reopened by battery run:** `local.20260925T100530Z.da526005226e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-06
**Battery gate:** `fork-parallel-dispositions`
**Failure signature:** `sha256:05bc64c55c4e99cf8730e671d3d0d0a2e8dc864519499d32cf25378d8c87442f`
**First observed run:** `local.20260906T052615Z.c519d102c963`
**Last observed run:** `local.20260925T100530Z.da526005226e`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Last observed revision:** `da526005226e44c135b46f5f962ff76fefc83720`
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
