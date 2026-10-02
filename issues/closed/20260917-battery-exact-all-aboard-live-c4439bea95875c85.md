# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260930T133254Z.763535814fd9`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:c4439bea95875c859480fa4e09069233d5ec81a3f542104509213bf8625d5247`
**First observed run:** `local.20260917T013752Z.61a3a6fa6021`
**Last observed run:** `local.20260930T133254Z.763535814fd9`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `61a3a6fa60211153b439fc57ea6cd49ed0d17455`
**Last observed revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
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
