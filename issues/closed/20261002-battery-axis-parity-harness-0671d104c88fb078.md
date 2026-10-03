# complete battery red: axis-parity-harness

**Status:** Closed
**Closure:** `determinate PASS`
**Closed at revision:** `1687b58af2d4aa7483575e2421dff70e1d918925`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-02
**Battery gate:** `axis-parity-harness`
**Failure signature:** `sha256:0671d104c88fb0781d8f467c15f5374225e2f33ed610a6093d040a1875dc9e50`
**First observed run:** `local.20261002T052302Z.0f516b324120`
**Last observed run:** `local.20261002T052302Z.0f516b324120`
**Last processed run:** `local.20261002T154654Z.1687b58af2d4`
**Detected at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Last observed revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
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
