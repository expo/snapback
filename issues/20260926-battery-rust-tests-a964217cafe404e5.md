# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:a964217cafe404e536bd2e133eb1c76a6933384554b539cb1bd3d12e39a21d2b`
**First observed run:** `local.20260926T132126Z.a371edf7769a`
**Last observed run:** `local.20260926T132126Z.a371edf7769a`
**Last processed run:** `local.20260926T132126Z.a371edf7769a`
**Detected at revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
**Last observed revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
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
