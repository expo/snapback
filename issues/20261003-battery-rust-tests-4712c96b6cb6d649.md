# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-03
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:4712c96b6cb6d64937f7edaf21aeb1240f87c1a2b00a355d9e07c18410f52c08`
**First observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last processed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Detected at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Last observed revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
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
