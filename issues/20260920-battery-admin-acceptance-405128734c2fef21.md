# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-20
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:405128734c2fef21ad1a4e6198974efb930bfb82ed1f907de108e182769a79f6`
**First observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last observed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Last processed run:** `local.20260920T003721Z.7ef61e81a1bf`
**Detected at revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Last observed revision:** `7ef61e81a1bf922f1a7984fc7c1cadfaeab1854c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `admin-acceptance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `admin-acceptance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bash -lc cd\ admin-ui\ \&\&\ ./build.sh\ \&\&\ bun\ run\ test\ \&\&\ bun\ run\ test:browser-security\ \&\&\ bun\ run\ audit:production
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
