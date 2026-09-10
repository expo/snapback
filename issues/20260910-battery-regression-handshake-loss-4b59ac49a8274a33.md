# complete battery red: regression-handshake-loss

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-10
**Battery gate:** `regression-handshake-loss`
**Failure signature:** `sha256:4b59ac49a8274a33a918fd593a726c3e8a753ac1c40e6dc8088ecda1aba315d8`
**First observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last processed run:** `local.20260910T020125Z.c971a88a5bb1`
**Detected at revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
**Last observed revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
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
