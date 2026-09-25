# complete battery red: forked-parent

**Status:** Closed
**Reopened by battery run:** `local.20260924T233800Z.4619cf3fc2e4`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `forked-parent`
**Failure signature:** `sha256:f23a813876264bad4d717aff5dcdcb3df81dcd9b71b85624a3268bef92a647ac`
**First observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last observed run:** `local.20260924T233800Z.4619cf3fc2e4`
**Last processed run:** `local.20260925T100530Z.da526005226e`
**Detected at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Last observed revision:** `4619cf3fc2e4ca05247e9c0efd55a08ed4e9f335`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `forked-parent` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `forked-parent` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/forked-parent.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
