# complete battery red: regression-optimistic-clobber

**Status:** Closed
**Reopened by battery run:** `local.20260901T030411Z.6435dc48103e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:460f36132a3b81ddc59c99df451a946ceb46d7633966db82fddf364337de9624`
**First observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last observed run:** `local.20260901T030411Z.6435dc48103e`
**Last processed run:** `local.20260901T114752Z.293de46f68b1`
**Detected at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Last observed revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
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
