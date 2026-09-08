# complete battery red: forked-parent

**Status:** Closed
**Reopened by battery run:** `local.20260908T030804Z.a75c98406a26`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `forked-parent`
**Failure signature:** `sha256:dfe6827e7a193fd03ac7a088aaebfc047bb87db1734f4137a1ab70ef5afe10dc`
**First observed run:** `local.20260830T072833Z.94397bad48fa`
**Last observed run:** `local.20260908T030804Z.a75c98406a26`
**Last processed run:** `local.20260908T125200Z.e6c89816b6d2`
**Detected at revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
**Last observed revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `forked-parent` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `forked-parent` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/forked-parent.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
