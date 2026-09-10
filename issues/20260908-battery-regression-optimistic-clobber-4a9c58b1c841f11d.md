# complete battery red: regression-optimistic-clobber

**Status:** Open
**Reopened by battery run:** `local.20260910T020125Z.c971a88a5bb1`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:4a9c58b1c841f11dc1c4308cfa1aacd686bb299cf08129c73fe5ea0d562c9162`
**First observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last processed run:** `local.20260910T020125Z.c971a88a5bb1`
**Detected at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Last observed revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
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
