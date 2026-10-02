# complete battery red: admin-acceptance

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `0f516b3241200321d073861c75a3f1a9311ae04d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-30
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:db95bd416dabdaa05d53afbce04d1b443159745c7e745c1f194cb8aea5073117`
**First observed run:** `local.20260930T133254Z.763535814fd9`
**Last observed run:** `local.20260930T133254Z.763535814fd9`
**Last processed run:** `local.20261002T052302Z.0f516b324120`
**Detected at revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
**Last observed revision:** `763535814fd9732bd76a0a782df67fc6db0323f0`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `admin-acceptance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `admin-acceptance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bash -lc cd\ admin-ui\ \&\&\ ./build.sh\ \&\&\ bun\ run\ test\ \&\&\ bun\ run\ test:browser-security\ \&\&\ bun\ run\ audit:production
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
