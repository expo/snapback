# complete battery red: regression-ephemeral-wiring

**Status:** Open
**Reopened by battery run:** `local.20260911T162046Z.dd629ae33ad8`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:9a411a397bbb70fd9735ed127f0e0c685c48dc6e9928e8c34e1e370ef20c3ef0`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last processed run:** `local.20260911T162046Z.dd629ae33ad8`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
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
