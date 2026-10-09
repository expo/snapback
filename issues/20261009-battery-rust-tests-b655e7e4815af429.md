# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-09
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:b655e7e4815af42996b1397653636a0a1a48a52fa94ea21e43eb95be1c021ee4`
**First observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last observed run:** `local.20261009T061135Z.d3eee62f477a`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
**Last observed revision:** `d3eee62f477af533f4de12e7cf24253c32ffd6bb`
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
