# complete battery red: admin-acceptance

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `4b2b32e6865b17e725068e3b75d18f5b3d281461`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-10
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:18dd4380802b594b2da0e2a850935e2db634cbf5d4823223dbbd2fb7925a1131`
**First observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last observed run:** `local.20260910T020125Z.c971a88a5bb1`
**Last processed run:** `local.20260910T111530Z.4b2b32e6865b`
**Detected at revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
**Last observed revision:** `c971a88a5bb194ee997597c08faa8477da3fdca0`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `admin-acceptance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `admin-acceptance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bash -lc cd\ admin-ui\ \&\&\ ./build.sh\ \&\&\ bun\ run\ test\ \&\&\ bun\ run\ test:browser-security\ \&\&\ bun\ run\ audit:production
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
