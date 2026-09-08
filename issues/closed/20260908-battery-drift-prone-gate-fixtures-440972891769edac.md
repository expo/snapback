# complete battery red: drift-prone-gate-fixtures

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `9a54d1ce69e0eea3f7239b11290f4b336fc254c4`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-08
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:440972891769edac261eac15926390cb19d0e483600088668d38c4480276b82e`
**First observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last processed run:** `local.20260908T224830Z.9a54d1ce69e0`
**Detected at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Last observed revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `drift-prone-gate-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `drift-prone-gate-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/drift_prone_gates_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
