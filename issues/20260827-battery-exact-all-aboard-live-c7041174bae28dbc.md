# complete battery red: exact-all-aboard-live

**Status:** Open
**Reopened by battery run:** `local.20261002T052302Z.0f516b324120`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `aee02735615b08a07096228bf60ae540fe9f5a5b`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:c7041174bae28dbc3bc64ade592664538539394716b0a5c254688545ee208a67`
**First observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last observed run:** `local.20261002T052302Z.0f516b324120`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Last observed revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
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
