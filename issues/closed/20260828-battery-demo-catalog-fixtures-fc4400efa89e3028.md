# complete battery red: demo-catalog-fixtures

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `demo-catalog-fixtures`
**Failure signature:** `sha256:fc4400efa89e3028ea52db1bde1bf03842eb952992e4594d9d6ce0bd2feaffb0`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20260828T114709Z.095880f16775`
**Last processed run:** `local.20260828T203031Z.1b23bca7239e`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `095880f167755431165137247bd51844b8c29e09`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `demo-catalog-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `demo-catalog-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/check-inventories.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
