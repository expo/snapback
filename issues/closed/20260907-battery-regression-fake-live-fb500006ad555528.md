# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-07
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:fb500006ad555528c615668a1a6cb6d4adc1d3f299eb8545416570b7549d86ea`
**First observed run:** `local.20260907T124933Z.1936eaddbea3`
**Last observed run:** `local.20260907T124933Z.1936eaddbea3`
**Last processed run:** `local.20260908T030804Z.a75c98406a26`
**Detected at revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
**Last observed revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-fake-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-fake-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-fake-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
