# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:f18133c3b091a2d6791fe093dd5dc9f25da28591f38de7631379e338bb32b989`
**First observed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Last observed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Last processed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Detected at revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
**Last observed revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
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
