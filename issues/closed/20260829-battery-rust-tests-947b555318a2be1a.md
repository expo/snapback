# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:947b555318a2be1a3fad21cb9f42acb883f0cdab51ca11ea21b240c84a362f27`
**First observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last observed run:** `local.20260829T140951Z.cace7b53cf00`
**Last processed run:** `local.20260829T223616Z.81cc759a07a7`
**Detected at revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
**Last observed revision:** `cace7b53cf008e7692e4cb633c14b4c2400fdd5c`
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
