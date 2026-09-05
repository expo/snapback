# complete battery red: todo-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0c1beadd1257f59ca2315942e137f11fdd04007b`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `todo-headless`
**Failure signature:** `sha256:f951519b7b93e8a655516ccbf6c29fdc78d23a4cb95ae8b875a7bed7d5970a0e`
**First observed run:** `local.20260904T174537Z.37281c059a09`
**Last observed run:** `local.20260904T174537Z.37281c059a09`
**Last processed run:** `local.20260905T022830Z.0c1beadd1257`
**Detected at revision:** `37281c059a09e560ab1cae613ed5a4a96487ce7c`
**Last observed revision:** `37281c059a09e560ab1cae613ed5a4a96487ce7c`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-headless` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-headless` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/headless.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
