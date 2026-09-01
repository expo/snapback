# complete battery red: regression-midflight-resync

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `regression-midflight-resync`
**Failure signature:** `sha256:b34295ff34207a1bc6d65ed0bd8751675047e3436ef021c4fb5f5182dc6b3cd8`
**First observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last observed run:** `local.20260901T203053Z.2ad65fb5912c`
**Last processed run:** `local.20260901T203053Z.2ad65fb5912c`
**Detected at revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Last observed revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `regression-midflight-resync` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `regression-midflight-resync` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/regression-midflight-resync.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
