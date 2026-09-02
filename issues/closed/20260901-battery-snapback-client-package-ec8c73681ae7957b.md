# complete battery red: snapback-client-package

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `69c95613ab978630f3a6af58e35a449374161f36`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:ec8c73681ae7957ba8a73698ec8658b6753483ae6090f65347709ad0411c03b9`
**First observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last processed run:** `local.20260902T051222Z.69c95613ab97`
**Detected at revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Last observed revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `snapback-client-package` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `snapback-client-package` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun run --cwd packages/snapback-client test
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
