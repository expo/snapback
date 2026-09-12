# complete battery red: axis-parity-harness

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-12
**Battery gate:** `axis-parity-harness`
**Failure signature:** `sha256:3ab711cc5f6b67ca4766ab648720bbc37c8b51b92b22c6ba5c2d36bac6c21315`
**First observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last observed run:** `local.20260912T132006Z.195ccc9b90d5`
**Last processed run:** `local.20260912T132006Z.195ccc9b90d5`
**Detected at revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Last observed revision:** `195ccc9b90d5816f4cdc6145b29b5215bd348579`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `axis-parity-harness` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `axis-parity-harness` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/acceptance/axis-parity-harness.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
