# complete battery red: path-migration-stragglers

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `a371edf7769a3e89328e19e655c458526dbd4cb3`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:5ae232d33cbfbe6792fe4a9986abd5b914b0961c49057614cab2231b4c7e3a5f`
**First observed run:** `local.20260926T040309Z.024d180ac262`
**Last observed run:** `local.20260926T040309Z.024d180ac262`
**Last processed run:** `local.20260926T132126Z.a371edf7769a`
**Detected at revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Last observed revision:** `024d180ac262670966806aa6bd050daf38f99f03`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `path-migration-stragglers` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `path-migration-stragglers` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-path-migration-stragglers.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
