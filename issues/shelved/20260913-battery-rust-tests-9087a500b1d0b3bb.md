# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-13
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:9087a500b1d0b3bb45ee7fb318f07804eeb9c30ed7bc4bbd3eb628777a7e6837`
**First observed run:** `local.20260913T092549Z.58251b46dce8`
**Last observed run:** `local.20260913T092549Z.58251b46dce8`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Last observed revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
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
