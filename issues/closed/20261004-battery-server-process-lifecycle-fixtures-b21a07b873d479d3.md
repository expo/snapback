# complete battery red: server-process-lifecycle-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-04
**Battery gate:** `server-process-lifecycle-fixtures`
**Failure signature:** `sha256:b21a07b873d479d366ca5e5409d6c119fcff3b97ebafe515d3001ba8792c5399`
**First observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last processed run:** `local.20261004T210738Z.f2ec49837937`
**Detected at revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
**Last observed revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
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
