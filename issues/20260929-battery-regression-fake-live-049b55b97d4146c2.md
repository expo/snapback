# complete battery red: regression-fake-live

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-29
**Battery gate:** `regression-fake-live`
**Failure signature:** `sha256:049b55b97d4146c2300aa13d3cb50ea5f1f41b8fb3b495e30becf97e75f2f4e7`
**First observed run:** `local.20260929T185743Z.aee02735615b`
**Last observed run:** `local.20260929T185743Z.aee02735615b`
**Last processed run:** `local.20260929T185743Z.aee02735615b`
**Detected at revision:** `aee02735615b08a07096228bf60ae540fe9f5a5b`
**Last observed revision:** `aee02735615b08a07096228bf60ae540fe9f5a5b`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-fake-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-fake-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-fake-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
