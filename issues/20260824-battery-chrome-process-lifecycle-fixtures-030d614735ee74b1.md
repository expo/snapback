# complete battery red: chrome-process-lifecycle-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260907T124933Z.1936eaddbea3`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `chrome-process-lifecycle-fixtures`
**Failure signature:** `sha256:030d614735ee74b193ad9fccba4cdcf4246574d4a6fe1ae8d8ede67367461788`
**First observed run:** `local.20260824T075727Z.59ae1a00e1c4`
**Last observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last processed run:** `local.20260908T125200Z.e6c89816b6d2`
**Detected at revision:** `59ae1a00e1c4cd2323b959586fcadb8395814686`
**Last observed revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
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
