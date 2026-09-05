# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20260905T112905Z.e32b5b7d5d32`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:6e69948d2a0950986353de078cfa87b6ff89e81b04e6d9781c7e3ae14c386af3`
**First observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last observed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Last processed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Detected at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Last observed revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
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
