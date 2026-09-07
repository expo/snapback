# complete battery red: regression-multilive-scoped

**Status:** Open
**Reopened by battery run:** `local.20260906T145321Z.2fd1b33c02f7`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `regression-multilive-scoped`
**Failure signature:** `sha256:460f36132a3b81ddc59c99df451a946ceb46d7633966db82fddf364337de9624`
**First observed run:** `local.20260904T174537Z.37281c059a09`
**Last observed run:** `local.20260907T021018Z.6954679b09ae`
**Last processed run:** `local.20260907T021018Z.6954679b09ae`
**Detected at revision:** `37281c059a09e560ab1cae613ed5a4a96487ce7c`
**Last observed revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
