# complete battery red: demo-materialization

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `demo-materialization`
**Failure signature:** `sha256:e0358e5e41c038fa89fcf0a54715f7731ff01a0c952f8ecaffcb18cd9b2bc6bb`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260912T024408Z.7d09e3124e2e`
**Last processed run:** `local.20260912T024408Z.7d09e3124e2e`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Consecutive red runs:** `38`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `demo-materialization` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `demo-materialization` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/demo_setup_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
