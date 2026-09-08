# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:a00e8129c92c8f9497a3cd5c30dc7550b26e7d14fa68b2d4a56ffc4c6664062a`
**First observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last processed run:** `local.20260908T125200Z.e6c89816b6d2`
**Detected at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Last observed revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
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
