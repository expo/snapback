# complete battery red: guide

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-08
**Battery gate:** `guide`
**Failure signature:** `sha256:ff91a048a939a0bd87a2cb66e43cc3bb17bd4283b536b21679cb39aa19d1e4f2`
**First observed run:** `local.20261008T085745Z.82992ad634f1`
**Last observed run:** `local.20261008T085745Z.82992ad634f1`
**Last processed run:** `local.20261009T061135Z.d3eee62f477a`
**Detected at revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Last observed revision:** `82992ad634f187cb9fd66a61006b3ccf15d51eb0`
**Consecutive red runs:** `0`
**Escalation:** `pending (0/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `guide` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `guide` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-guide.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
