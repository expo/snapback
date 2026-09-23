# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-23
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:83c396f7f2222b8f848eb86f03cf927a3533a16dd1091f67b18c1d6b0935228e`
**First observed run:** `local.20260923T123621Z.d34227259c10`
**Last observed run:** `local.20260923T123621Z.d34227259c10`
**Last processed run:** `local.20260923T123621Z.d34227259c10`
**Detected at revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
**Last observed revision:** `d34227259c10034bf21325a9847fb907a63f15a3`
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
