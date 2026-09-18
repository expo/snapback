# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:b23628b5c7ef92091bb83badc99a92554a9021072b2284b05aaf2944afa8871b`
**First observed run:** `local.20260917T113035Z.46f47983a1ce`
**Last observed run:** `local.20260917T113035Z.46f47983a1ce`
**Last processed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Detected at revision:** `46f47983a1ce793a934981413c32c64382872d9d`
**Last observed revision:** `46f47983a1ce793a934981413c32c64382872d9d`
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
