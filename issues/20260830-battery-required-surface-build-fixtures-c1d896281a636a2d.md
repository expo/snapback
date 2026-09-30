# complete battery red: required-surface-build-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260930T043534Z.fc8deceab43c`
**Closure:** `determinate PASS`
**Closed at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `required-surface-build-fixtures`
**Failure signature:** `sha256:c1d896281a636a2dad39528d094313dd243c2ba35a807b15edf0ec0bbf5d6aa2`
**First observed run:** `local.20260830T072833Z.94397bad48fa`
**Last observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last processed run:** `local.20260930T043534Z.fc8deceab43c`
**Detected at revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
**Last observed revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `required-surface-build-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `required-surface-build-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/required_surface_builds_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
