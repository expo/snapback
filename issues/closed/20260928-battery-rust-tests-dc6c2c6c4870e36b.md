# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-28
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:dc6c2c6c4870e36bac03677b95bb33eed217afd9f1412254ddc20f2a237829b1`
**First observed run:** `local.20260928T150340Z.ea7ecc896c16`
**Last observed run:** `local.20260928T150340Z.ea7ecc896c16`
**Last processed run:** `local.20260929T091155Z.f56e8048aa9f`
**Detected at revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
**Last observed revision:** `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`
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
