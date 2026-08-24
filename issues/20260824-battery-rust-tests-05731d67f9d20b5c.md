# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:05731d67f9d20b5c45824a0cfcb4c384c52e21295292dda4d2fd0539c8da5c95`
**First observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last observed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Last processed run:** `local.20260824T183807Z.0dd1f3c9f73c`
**Detected at revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Last observed revision:** `0dd1f3c9f73ce89366de8c84bfc3f91f331b4b90`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `rust-tests` as a root
failure (exit 101). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `rust-tests` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
env SNAPBACK_EXPECT_WORKERD=1 cargo test --workspace --no-fail-fast -- --test-threads 4
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
