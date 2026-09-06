# complete battery red: path-migration-stragglers

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2fd1b33c02f70bb03d0b06116dfd17ccd7be0b26`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-06
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:a230d5d34fdaf4b450e47f07d3b4e34ffa0d963aa37cbb2df6d0b80419314f5d`
**First observed run:** `local.20260906T052615Z.c519d102c963`
**Last observed run:** `local.20260906T052615Z.c519d102c963`
**Last processed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Detected at revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
**Last observed revision:** `c519d102c963f1cc4e597feb9d799a5376a4c3eb`
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
