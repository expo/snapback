# complete battery red: fork-parallel-dispositions

**Status:** Open
**Reopened by battery run:** `local.20260903T154459Z.afba645047a6`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `08643f8b0ad31cf0374055527f7234e3867b4cff`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `fork-parallel-dispositions`
**Failure signature:** `sha256:03f88bfebb6bf18feb1e105cbde624462bdccd230cb4500062c4bdbef0896477`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260904T085756Z.70e71e5c39fe`
**Last processed run:** `local.20260904T085756Z.70e71e5c39fe`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `70e71e5c39fe4e19aecbbf72f4e4fc8619490674`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `fork-parallel-dispositions` as a root
failure (exit 2). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `fork-parallel-dispositions` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo/tests/acceptance/fork-parallel-dispositions.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
