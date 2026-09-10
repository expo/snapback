# complete battery red: regression-ephemeral-wiring

**Status:** Open
**Reopened by battery run:** `local.20260910T111530Z.4b2b32e6865b`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `37281c059a09e560ab1cae613ed5a4a96487ce7c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:5671960eca24a89a65583119c11837d91a70c62323bd33bd4a1a3c7bd153a244`
**First observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last observed run:** `local.20260910T111530Z.4b2b32e6865b`
**Last processed run:** `local.20260910T111530Z.4b2b32e6865b`
**Detected at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Last observed revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-ephemeral-wiring` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-ephemeral-wiring` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-ephemeral-wiring.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
