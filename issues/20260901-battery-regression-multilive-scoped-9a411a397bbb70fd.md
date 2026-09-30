# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20260930T133254Z.763535814fd9`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:9a411a397bbb70fd9735ed127f0e0c685c48dc6e9928e8c34e1e370ef20c3ef0`
**First observed run:** `local.20260901T114752Z.293de46f68b1`
**Last observed run:** `local.20260930T133254Z.763535814fd9`
**Last processed run:** `local.20260930T133254Z.763535814fd9`
**Detected at revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Last observed revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
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
