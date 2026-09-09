# complete battery red: regression-optimistic-clobber

**Status:** Closed
**Reopened by battery run:** `local.20260908T224830Z.9a54d1ce69e0`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2b8ec71c667f7f1a72bb1ff6c3097e4f662e2148`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:c7041174bae28dbc3bc64ade592664538539394716b0a5c254688545ee208a67`
**First observed run:** `local.20260901T114752Z.293de46f68b1`
**Last observed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Last processed run:** `local.20260909T074306Z.2b8ec71c667f`
**Detected at revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Last observed revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-optimistic-clobber` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-optimistic-clobber` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-optimistic-clobber.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
