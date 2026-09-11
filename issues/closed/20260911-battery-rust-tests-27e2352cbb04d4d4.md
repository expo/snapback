# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-11
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:27e2352cbb04d4d4e40a94402e867f7c05ab4849b10a9ab1286e9ba98962eb9b`
**First observed run:** `local.20260911T062045Z.15c134d056d0`
**Last observed run:** `local.20260911T062045Z.15c134d056d0`
**Last processed run:** `local.20260911T162046Z.dd629ae33ad8`
**Detected at revision:** `15c134d056d084448d7db766b03df5b47db9a40c`
**Last observed revision:** `15c134d056d084448d7db766b03df5b47db9a40c`
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
