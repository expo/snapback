# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-11
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:a37a940cfbe2ab5561afd7b7be2b4964d69ed40a3fbadf6116b01c03b814c46b`
**First observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last observed run:** `local.20260911T162046Z.dd629ae33ad8`
**Last processed run:** `local.20260911T162046Z.dd629ae33ad8`
**Detected at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Last observed revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
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
