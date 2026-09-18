# complete battery red: all-aboard-cron

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-18
**Battery gate:** `all-aboard-cron`
**Failure signature:** `sha256:17ea2406c6845868e774ec2ffe38b9e1dd48e2f98464f82e846f207af2b5dc76`
**First observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last observed run:** `local.20260918T081626Z.dc1abf6b7394`
**Last processed run:** `local.20260918T081626Z.dc1abf6b7394`
**Detected at revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Last observed revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
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
