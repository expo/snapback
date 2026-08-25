# complete battery red: cargo-audit

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `64e70df1e088d492cde44c9693463a2d052bbd7a`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `cargo-audit`
**Failure signature:** `sha256:0c61ae5a13a143955a4c878c9481dfbd83d9162ae6d52a958a18e268d37a846d`
**First observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last processed run:** `local.20260825T115521Z.64e70df1e088`
**Detected at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Last observed revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `cargo-audit` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `cargo-audit` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
cargo audit --deny unmaintained
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
