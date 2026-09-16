# complete battery red: regression-fake-live

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `fbf2c6042249ffb1b8b21cea660939688718671f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:c79de5b50b0b7aeea4fda6e2985b0d452b0a92f65b2fca5a0473153a4282d41f`
**First observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last processed run:** `local.20260916T051524Z.fbf2c6042249`
**Detected at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Last observed revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-fake-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-fake-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-fake-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
