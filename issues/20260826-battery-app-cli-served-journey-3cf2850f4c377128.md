# complete battery red: app-cli-served-journey

**Status:** Open
**Reopened by battery run:** `local.20260901T203053Z.2ad65fb5912c`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6435dc48103e90d6732b7e0de709701fda3ba512`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `app-cli-served-journey`
**Failure signature:** `sha256:3cf2850f4c377128fe0609f4721600dc047c753ca1017af3fbec7f0cddc0e8d3`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Last processed run:** `local.20260902T135224Z.0b3a42a3d94b`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `0b3a42a3d94b62aecb87ec9c7f7ba9c30f8a7035`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `app-cli-served-journey` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `app-cli-served-journey` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node tests/acceptance/app-cli-served-journey.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
