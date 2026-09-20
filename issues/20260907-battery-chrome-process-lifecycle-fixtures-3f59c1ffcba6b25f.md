# complete battery red: chrome-process-lifecycle-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260919T140917Z.e116b8324d19`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-07
**Battery gate:** `chrome-process-lifecycle-fixtures`
**Failure signature:** `sha256:3f59c1ffcba6b25f3b70a7c92a09fe24e17550d46fea7a866a6bfff79f3cbcf2`
**First observed run:** `local.20260907T021018Z.6954679b09ae`
**Last observed run:** `local.20260919T140917Z.e116b8324d19`
**Last processed run:** `local.20260919T140917Z.e116b8324d19`
**Detected at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Last observed revision:** `e116b8324d196d3f799ac8d570c156cd73ee18f6`
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
