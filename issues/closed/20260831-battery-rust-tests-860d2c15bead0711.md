# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:860d2c15bead0711cf52e974b88136b625cf125c544c460b9684268e71445b6a`
**First observed run:** `local.20260831T182234Z.850c161f649c`
**Last observed run:** `local.20260831T182234Z.850c161f649c`
**Last processed run:** `local.20260901T030411Z.6435dc48103e`
**Detected at revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
**Last observed revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
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
