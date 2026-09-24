# complete battery red: regression-handshake-loss

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:7b258afe01210e35c62f480f089c6f37e3b2336dbc04179ed56770c8a2773edf`
**First observed run:** `local.20260924T025209Z.0388900b82ae`
**Last observed run:** `local.20260924T025209Z.0388900b82ae`
**Last processed run:** `local.20260924T025209Z.0388900b82ae`
**Detected at revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Last observed revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
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
