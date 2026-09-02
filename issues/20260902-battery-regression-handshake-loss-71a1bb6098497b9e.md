# complete battery red: regression-handshake-loss

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:71a1bb6098497b9ec0e5395d121231419079ef363926e7637b115b1f489b90a0`
**First observed run:** `local.20260902T051222Z.69c95613ab97`
**Last observed run:** `local.20260902T051222Z.69c95613ab97`
**Last processed run:** `local.20260902T051222Z.69c95613ab97`
**Detected at revision:** `69c95613ab978630f3a6af58e35a449374161f36`
**Last observed revision:** `69c95613ab978630f3a6af58e35a449374161f36`
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
