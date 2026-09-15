# complete battery red: guide-capability-link-real-backend

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `guide-capability-link-real-backend`
**Failure signature:** `sha256:3c0917e13516cd5ba45cc15e8f4fdce1d169532c8a63d3840b5f86516345163c`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Last processed run:** `local.20260915T080414Z.0c6b0c03cfea`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `0c6b0c03cfea21d65eab728035ef87776a4144a3`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide-capability-link-real-backend` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide-capability-link-real-backend` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
env SNAPBACK_RUNTIME_BINARY=/Users/ccheever/.snapback-local-proof-backstop/repo/target/debug/snapback node scripts/check-guide-capability-link-example.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
