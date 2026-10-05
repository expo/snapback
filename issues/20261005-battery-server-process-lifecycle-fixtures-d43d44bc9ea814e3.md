# complete battery red: server-process-lifecycle-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-05
**Battery gate:** `server-process-lifecycle-fixtures`
**Failure signature:** `sha256:d43d44bc9ea814e3a93a751e4fc67ef4639e01dfbd34d49dcbb1c622014c7160`
**First observed run:** `local.20261005T101501Z.ce196270d2a4`
**Last observed run:** `local.20261005T101501Z.ce196270d2a4`
**Last processed run:** `local.20261005T101501Z.ce196270d2a4`
**Detected at revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
**Last observed revision:** `ce196270d2a4c13c8aaa1f1c14f510f8485fe0cb`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `server-process-lifecycle-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `server-process-lifecycle-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/server-process-lifecycle.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
