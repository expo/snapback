# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-12
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:4b5b0b29f0aa1cb7f8989413ae385e1192efa532fa4d36e921d47afd15ad4516`
**First observed run:** `local.20260912T231718Z.9e930482fe75`
**Last observed run:** `local.20260912T231718Z.9e930482fe75`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
**Last observed revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
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
