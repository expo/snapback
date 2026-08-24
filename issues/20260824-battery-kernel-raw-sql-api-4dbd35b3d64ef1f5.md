# complete battery red: kernel-raw-sql-api

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `kernel-raw-sql-api`
**Failure signature:** `sha256:4dbd35b3d64ef1f53becd3cf60ae0f38b490fa2c11dd9d2f9325d80eb8fbd777`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260824T022619Z.88476b032428`
**Last processed run:** `local.20260824T022619Z.88476b032428`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `kernel-raw-sql-api` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `kernel-raw-sql-api` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-kernel-raw-sql-api.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
