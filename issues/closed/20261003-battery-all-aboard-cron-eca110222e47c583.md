# complete battery red: all-aboard-cron

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-03
**Battery gate:** `all-aboard-cron`
**Failure signature:** `sha256:eca110222e47c58309e0719705d9c0480f5bb8bc69af23ac1e123050be613eba`
**First observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last observed run:** `local.20261003T130924Z.f0c7d7a038c4`
**Last processed run:** `local.20261004T072114Z.4353aa735cb1`
**Detected at revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Last observed revision:** `f0c7d7a038c4b315fd21b0b2b5ca1b31e6e810ed`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `all-aboard-cron` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `all-aboard-cron` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/all-aboard/tests/acceptance/cron.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
