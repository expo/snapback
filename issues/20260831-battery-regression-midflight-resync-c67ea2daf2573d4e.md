# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-31
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:c67ea2daf2573d4e783cd8a5fd8fe2038c79b3279d5d9a38f8491216aa2d6d95`
**First observed run:** `local.20260831T182234Z.850c161f649c`
**Last observed run:** `local.20260831T182234Z.850c161f649c`
**Last processed run:** `local.20260831T182234Z.850c161f649c`
**Detected at revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
**Last observed revision:** `850c161f649c35283d9ecfef1b5a97baf4e98167`
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
