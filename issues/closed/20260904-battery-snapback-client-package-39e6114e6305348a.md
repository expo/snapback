# complete battery red: snapback-client-package

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-04
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:39e6114e6305348a0df60f646d3399f24716b5e7ef46e83030ec00cfffac9cbd`
**First observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last observed run:** `local.20260904T003052Z.cc497048cd8c`
**Last processed run:** `local.20260904T085756Z.70e71e5c39fe`
**Detected at revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
**Last observed revision:** `cc497048cd8c7958b640479eb79ae068c93e56c4`
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
