# complete battery red: rust-tests

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:f4e08d73f20c93a4c2306f493568fa0c767ac87594da06a11b407c020426df78`
**First observed run:** `local.20260924T130725Z.942753a689cd`
**Last observed run:** `local.20260924T130725Z.942753a689cd`
**Last processed run:** `local.20260924T130725Z.942753a689cd`
**Detected at revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Last observed revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
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
