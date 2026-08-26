# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:fbda5ecd505300a9ef3bde46b10e44755a994f09fe5c97b4d12361b4b22a30b9`
**First observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last observed run:** `local.20260826T010040Z.278837ddbcaf`
**Last processed run:** `local.20260826T010040Z.278837ddbcaf`
**Detected at revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
**Last observed revision:** `278837ddbcaf54f9041dec1ef4acb904752e8b6e`
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
