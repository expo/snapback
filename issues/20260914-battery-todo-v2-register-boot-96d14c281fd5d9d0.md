# complete battery red: todo-v2-register-boot

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `todo-v2-register-boot`
**Failure signature:** `sha256:96d14c281fd5d9d0de6d2f92379c91cc629b602f6e73a514f29ecc849a767b26`
**First observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last processed run:** `local.20260914T214631Z.8f56e50f6d78`
**Detected at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Last observed revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-register-boot` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-register-boot` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/register-boot.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
