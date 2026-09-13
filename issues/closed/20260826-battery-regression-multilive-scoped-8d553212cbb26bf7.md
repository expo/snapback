# complete battery red: regression-multilive-scoped

**Status:** Closed
**Reopened by battery run:** `local.20260912T231718Z.9e930482fe75`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `58251b46dce85b379bbf02f94b1ddad308b41a5d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:8d553212cbb26bf7d018175953c4fd24559e92fd7f770e03f829e2b93f92541a`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260912T231718Z.9e930482fe75`
**Last processed run:** `local.20260913T092549Z.58251b46dce8`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `9e930482fe7538d1a5dc3bda71dcfd870744790e`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-multilive-scoped` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-multilive-scoped` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/_kit/tests/regression-multilive-scoped.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
