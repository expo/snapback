# complete battery red: diagnostics-registry-fixtures

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `diagnostics-registry-fixtures`
**Failure signature:** `sha256:fa300213ab52d27b5a3f69c33f947a44f111e5216ad02585d1e358fbcf0759c0`
**First observed run:** `local.20260914T104118Z.86928d068765`
**Last observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last processed run:** `local.20260914T214631Z.8f56e50f6d78`
**Detected at revision:** `86928d068765e3d57c68747e4f2359950b8ff7d1`
**Last observed revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `diagnostics-registry-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `diagnostics-registry-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test scripts/generate-diagnostics-registry.test.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
