# complete battery red: regression-handshake-loss

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-07
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:11c30d6dd16059cb37ca6d1e8815f84ace43cf6909d15aa945fbc647a3c0d879`
**First observed run:** `local.20260907T124933Z.1936eaddbea3`
**Last observed run:** `local.20260907T124933Z.1936eaddbea3`
**Last processed run:** `local.20260908T030804Z.a75c98406a26`
**Detected at revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
**Last observed revision:** `1936eaddbea3621777c9df9c145f90a7fe92d9db`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-handshake-loss` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-handshake-loss` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-handshake-loss.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
