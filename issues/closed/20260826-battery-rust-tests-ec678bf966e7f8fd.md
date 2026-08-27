# complete battery red: rust-tests

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `rust-tests`
**Failure signature:** `sha256:ec678bf966e7f8fdb8afe792b2fbc5dbbb372deaadaa5d294b55b1a49452a88c`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260826T230829Z.fb14180ba761`
**Last processed run:** `local.20260827T104322Z.04da2f52bd6f`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
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
env SNAPBACK_EXPECT_WORKERD=1 cargo test --workspace --no-fail-fast -- --test-threads 4
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
