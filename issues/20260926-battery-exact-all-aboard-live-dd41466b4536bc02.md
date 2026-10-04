# complete battery red: exact-all-aboard-live

**Status:** Open
**Reopened by battery run:** `local.20261004T072114Z.4353aa735cb1`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `fc8deceab43cacacd6355534001045aa003bb806`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:dd41466b4536bc02bcccf426851391a247eed965a3382eec99cd4af762122316`
**First observed run:** `local.20260926T223620Z.3b21178b41db`
**Last observed run:** `local.20261004T072114Z.4353aa735cb1`
**Last processed run:** `local.20261004T072114Z.4353aa735cb1`
**Detected at revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Last observed revision:** `4353aa735cb1c752d08993268da9fa8a75f26c5c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-all-aboard-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-all-aboard-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/all-aboard/tests/acceptance/contract-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
