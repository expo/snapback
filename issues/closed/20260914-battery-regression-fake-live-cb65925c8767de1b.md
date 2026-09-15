# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0c6b0c03cfea21d65eab728035ef87776a4144a3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:cb65925c8767de1b9ed4475a0daa904b9c7e2e1db106d36fdd2fa400e9faa39b`
**First observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last processed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Detected at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Last observed revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
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
