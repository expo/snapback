# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-30
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:5a8424311fc1d7b18b2046eb4a7bba59a3279abe15c774a8a33acfb35028b06f`
**First observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last observed run:** `local.20260930T043534Z.fc8deceab43c`
**Last processed run:** `local.20260930T043534Z.fc8deceab43c`
**Detected at revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Last observed revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `path-migration-stragglers` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `path-migration-stragglers` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-path-migration-stragglers.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
