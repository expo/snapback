# complete battery red: chrome-process-lifecycle-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260912T132006Z.195ccc9b90d5`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `7d09e3124e2ea43e4e53d5f26460b04f6aa4bf82`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `chrome-process-lifecycle-fixtures`
**Failure signature:** `sha256:030d614735ee74b193ad9fccba4cdcf4246574d4a6fe1ae8d8ede67367461788`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last processed run:** `local.20260912T132006Z.195ccc9b90d5`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `chrome-process-lifecycle-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `chrome-process-lifecycle-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/chrome-process-lifecycle.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
