# complete battery red: chrome-process-lifecycle-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-13
**Battery gate:** `chrome-process-lifecycle-fixtures`
**Failure signature:** `sha256:1fa7e62eced4240468d6dd5d9784ca48bfe8ebc1cad91ea3d07c8db3bcc78870`
**First observed run:** `local.20260913T092549Z.58251b46dce8`
**Last observed run:** `local.20260913T092549Z.58251b46dce8`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Last observed revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `chrome-process-lifecycle-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `chrome-process-lifecycle-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/chrome-process-lifecycle.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
