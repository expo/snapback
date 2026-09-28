# complete battery red: demo-materialization

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `demo-materialization`
**Failure signature:** `sha256:e0358e5e41c038fa89fcf0a54715f7731ff01a0c952f8ecaffcb18cd9b2bc6bb`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260927T175940Z.8112f4ef6400`
**Last processed run:** `local.20260927T175940Z.8112f4ef6400`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
**Consecutive red runs:** `10`
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
