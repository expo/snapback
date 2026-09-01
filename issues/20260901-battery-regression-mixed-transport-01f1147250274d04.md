# complete battery red: regression-mixed-transport

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `regression-mixed-transport`
**Failure signature:** `sha256:01f1147250274d045bd05e918758ef8d1ea516535dec8b45d6b43c204f1e2df8`
**First observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last processed run:** `local.20260901T203053Z.2ad65fb5912c`
**Detected at revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Last observed revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-mixed-transport` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-mixed-transport` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-mixed-transport.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
