# complete battery red: regression-handshake-loss

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:e8bbb466b4918e458248d2e165e3e57cd7a79822d55b5cf296c410f90d038db0`
**First observed run:** `local.20260905T022830Z.0c1beadd1257`
**Last observed run:** `local.20260905T022830Z.0c1beadd1257`
**Last processed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Detected at revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Last observed revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
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
