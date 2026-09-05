# complete battery red: provider-live-conformance

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e32b5b7d5d32cb4dc1735e4598fbdb86639d362f`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-05
**Battery gate:** `provider-live-conformance`
**Failure signature:** `sha256:739ba48a19fa12b4e0c5c7d7c2cf917e30c33b4315cdaec73e06401505340fd4`
**First observed run:** `local.20260905T022830Z.0c1beadd1257`
**Last observed run:** `local.20260905T022830Z.0c1beadd1257`
**Last processed run:** `local.20260905T112905Z.e32b5b7d5d32`
**Detected at revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Last observed revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `provider-live-conformance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `provider-live-conformance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/provider-live-conformance.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
