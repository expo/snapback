# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-21
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:f1ba0b2306107e2fbe00bf2654cbd54a977a9f58a077086d49adeaa02cfec944`
**First observed run:** `local.20260921T053735Z.66fc10578f22`
**Last observed run:** `local.20260921T053735Z.66fc10578f22`
**Last processed run:** `local.20260921T053735Z.66fc10578f22`
**Detected at revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
**Last observed revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
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
env SNAPBACK_EXPECT_WORKERD=1 NEXTEST_TEST_THREADS=4 scripts/run-cargo-nextest --profile local-proof --workspace --no-fail-fast
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
