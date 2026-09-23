# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:c5c464c1b5ec5289b2bcdf2a6a7de63e45e8aa3f86ee65dc3c08961f32367674`
**First observed run:** `local.20260922T201104Z.e7c955d366a5`
**Last observed run:** `local.20260922T201104Z.e7c955d366a5`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `e7c955d366a57ba7005f500d2a396c63e92be141`
**Last observed revision:** `e7c955d366a57ba7005f500d2a396c63e92be141`
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
