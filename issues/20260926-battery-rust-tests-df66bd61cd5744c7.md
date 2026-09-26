# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:df66bd61cd5744c7fe64ddf6f804a6ca69c47b0a529a8270996f35e04d362ff5`
**First observed run:** `local.20260926T223620Z.3b21178b41db`
**Last observed run:** `local.20260926T223620Z.3b21178b41db`
**Last processed run:** `local.20260926T223620Z.3b21178b41db`
**Detected at revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Last observed revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
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
