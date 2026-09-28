# complete battery red: regression-optimistic-clobber

**Status:** Open
**Reopened by battery run:** `local.20260928T150340Z.ea7ecc896c16`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9fa99a49e8cf2fb0222211afa533a397b70586e1`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:6e69948d2a0950986353de078cfa87b6ff89e81b04e6d9781c7e3ae14c386af3`
**First observed run:** `local.20260831T005527Z.2ab5c5c6641e`
**Last observed run:** `local.20260928T150340Z.ea7ecc896c16`
**Last processed run:** `local.20260928T150340Z.ea7ecc896c16`
**Detected at revision:** `2ab5c5c6641ebe33f1a8281f71ffe7d8b0b1e306`
**Last observed revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
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
