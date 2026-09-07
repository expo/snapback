# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-07
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:03a944c05c73fdd7480694f90bc6379efa566115b6a289cf87b9147e373d5cda`
**First observed run:** `local.20260907T021018Z.6954679b09ae`
**Last observed run:** `local.20260907T021018Z.6954679b09ae`
**Last processed run:** `local.20260907T021018Z.6954679b09ae`
**Detected at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Last observed revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-midflight-resync` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-midflight-resync` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-midflight-resync.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
