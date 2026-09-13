# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260912T132006Z.195ccc9b90d5`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:5671960eca24a89a65583119c11837d91a70c62323bd33bd4a1a3c7bd153a244`
**First observed run:** `local.20260901T114752Z.293de46f68b1`
**Last observed run:** `local.20260912T231718Z.9e930482fe75`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Last observed revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
