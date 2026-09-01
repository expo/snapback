# complete battery red: regression-ephemeral-wiring

**Status:** Closed
**Reopened by battery run:** `local.20260901T030411Z.6435dc48103e`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `regression-ephemeral-wiring`
**Failure signature:** `sha256:c4439bea95875c859480fa4e09069233d5ec81a3f542104509213bf8625d5247`
**First observed run:** `local.20260826T121823Z.f69e9b16cbe8`
**Last observed run:** `local.20260901T114752Z.293de46f68b1`
**Last processed run:** `local.20260901T203053Z.2ad65fb5912c`
**Detected at revision:** `f69e9b16cbe835a3d99d598bc739acccb27365d1`
**Last observed revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
