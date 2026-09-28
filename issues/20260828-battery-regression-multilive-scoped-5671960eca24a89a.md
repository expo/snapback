# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20260928T150340Z.ea7ecc896c16`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:5671960eca24a89a65583119c11837d91a70c62323bd33bd4a1a3c7bd153a244`
**First observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last observed run:** `local.20260928T150340Z.ea7ecc896c16`
**Last processed run:** `local.20260928T150340Z.ea7ecc896c16`
**Detected at revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Last observed revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-multilive-scoped` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-multilive-scoped` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-multilive-scoped.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
