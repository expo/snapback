# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-28
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:ae4b8c0819fc8072cde33935226054341cb4df6fc1a04105372212caa7d43577`
**First observed run:** `local.20260928T042704Z.b8400c29128e`
**Last observed run:** `local.20260928T042704Z.b8400c29128e`
**Last processed run:** `local.20260928T150340Z.ea7ecc896c16`
**Detected at revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
**Last observed revision:** `b8400c29128e21b6367ba8d420296bedf108dff5`
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
