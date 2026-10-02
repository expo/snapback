# complete battery red: guide

**Status:** Closed
**Reopened by battery run:** `local.20260930T043534Z.fc8deceab43c`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `guide`
**Failure signature:** `sha256:59b69d2cbe4ed116618fb47ff4093fa18fc064b5dc9abe23268ad5a802dc1fd4`
**First observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last observed run:** `local.20260930T133254Z.763535814fd9`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Last observed revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-guide.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
