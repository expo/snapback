# complete battery red: app-cli-served-journey

**Status:** Open
**Reopened by battery run:** `local.20260904T003052Z.cc497048cd8c`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-26
**Battery gate:** `app-cli-served-journey`
**Failure signature:** `sha256:3cf2850f4c377128fe0609f4721600dc047c753ca1017af3fbec7f0cddc0e8d3`
**First observed run:** `local.20260826T230829Z.fb14180ba761`
**Last observed run:** `local.20260905T203247Z.810fbda46e64`
**Last processed run:** `local.20260905T203247Z.810fbda46e64`
**Detected at revision:** `fb14180ba761ee0cee2881d4889f4fffa981ae83`
**Last observed revision:** `810fbda46e64ae6865094ccc9e578b1d5781caf5`
**Consecutive red runs:** `6`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
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

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
