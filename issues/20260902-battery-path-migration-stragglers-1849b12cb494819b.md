# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:1849b12cb494819b0d9d7c31b837628b5bb075b8963719c794779e58f379a74b`
**First observed run:** `local.20260902T051222Z.69c95613ab97`
**Last observed run:** `local.20260902T051222Z.69c95613ab97`
**Last processed run:** `local.20260902T051222Z.69c95613ab97`
**Detected at revision:** `69c95613ab978630f3a6af58e35a449374161f36`
**Last observed revision:** `69c95613ab978630f3a6af58e35a449374161f36`
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
