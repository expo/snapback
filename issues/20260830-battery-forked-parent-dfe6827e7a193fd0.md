# complete battery red: forked-parent

**Status:** Open
**Reopened by battery run:** `local.20260917T113035Z.46f47983a1ce`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-30
**Battery gate:** `forked-parent`
**Failure signature:** `sha256:dfe6827e7a193fd03ac7a088aaebfc047bb87db1734f4137a1ab70ef5afe10dc`
**First observed run:** `local.20260830T072833Z.94397bad48fa`
**Last observed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Last processed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Detected at revision:** `94397bad48fae267548eb0547316a8267dcd1f66`
**Last observed revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
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
