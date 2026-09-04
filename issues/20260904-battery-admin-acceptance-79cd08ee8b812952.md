# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:79cd08ee8b812952d76ab38656ebb140debcae158e4a76e5e5c164d0a3751e36`
**First observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last processed run:** `local.20260904T085756Z.70e71e5c39fe`
**Detected at revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
**Last observed revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
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
