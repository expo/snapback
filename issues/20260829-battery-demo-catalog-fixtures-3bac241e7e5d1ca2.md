# complete battery red: demo-catalog-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-29
**Battery gate:** `demo-catalog-fixtures`
**Failure signature:** `sha256:3bac241e7e5d1ca2698edb5b47aa1428da3849d829c74ed7edf66041e083707c`
**First observed run:** `local.20260829T223616Z.81cc759a07a7`
**Last observed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Last processed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Detected at revision:** `81cc759a07a706300e471f106fe41dc761c39474`
**Last observed revision:** `2fd1b33c02f70bb03d0b06116dfd17ccd7be0b26`
**Consecutive red runs:** `22`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `demo-catalog-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `demo-catalog-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/check-inventories.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
