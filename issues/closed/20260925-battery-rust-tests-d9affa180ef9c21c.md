# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `d6fdf102a1e67f8b1aef99ce7c7c880c9c48406d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-25
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:d9affa180ef9c21c066466e37dd9c2335c1e52dc25a159c01a1290283a0888b2`
**First observed run:** `local.20260925T100530Z.da526005226e`
**Last observed run:** `local.20260925T100530Z.da526005226e`
**Last processed run:** `local.20260925T191102Z.d6fdf102a1e6`
**Detected at revision:** `da526005226e44c135b46f5f962ff76fefc83720`
**Last observed revision:** `da526005226e44c135b46f5f962ff76fefc83720`
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
