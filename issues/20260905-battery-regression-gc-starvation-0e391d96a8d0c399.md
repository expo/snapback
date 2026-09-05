# complete battery red: regression-gc-starvation

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `regression-gc-starvation`
**Failure signature:** `sha256:0e391d96a8d0c399cc1e0edc7e8c981247ec35ccedc72b59db3d2ec284c55750`
**First observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last processed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Detected at revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Last observed revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-gc-starvation` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-gc-starvation` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-gc-starvation.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
