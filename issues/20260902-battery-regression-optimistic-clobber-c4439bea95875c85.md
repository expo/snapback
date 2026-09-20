# complete battery red: regression-optimistic-clobber

**Status:** Open
**Reopened by battery run:** `local.20260919T040853Z.0168b46b0c20`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-02
**Battery gate:** `regression-optimistic-clobber`
**Failure signature:** `sha256:c4439bea95875c859480fa4e09069233d5ec81a3f542104509213bf8625d5247`
**First observed run:** `local.20260902T222959Z.21867fec6d93`
**Last observed run:** `local.20260919T140917Z.e116b8324d19`
**Last processed run:** `local.20260919T140917Z.e116b8324d19`
**Detected at revision:** `21867fec6d938b0a0b27076ffab22c23232b7672`
**Last observed revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-optimistic-clobber` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-optimistic-clobber` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-optimistic-clobber.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
