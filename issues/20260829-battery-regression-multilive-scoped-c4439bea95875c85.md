# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20260904T085756Z.70e71e5c39fe`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:c4439bea95875c859480fa4e09069233d5ec81a3f542104509213bf8625d5247`
**First observed run:** `local.20260829T051119Z.45ebcadce605`
**Last observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last processed run:** `local.20260904T085756Z.70e71e5c39fe`
**Detected at revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Last observed revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
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
