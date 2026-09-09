# complete battery red: forked-parent

**Status:** Open
**Reopened by battery run:** `local.20260908T125200Z.e6c89816b6d2`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `a75c98406a2678df2b2247b61481fdea5aac470d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `forked-parent`
**Failure signature:** `sha256:f23a813876264bad4d717aff5dcdcb3df81dcd9b71b85624a3268bef92a647ac`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260909T165632Z.6ffce9c07663`
**Last processed run:** `local.20260909T165632Z.6ffce9c07663`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `6ffce9c076632edab01afe8d4ece43f40770fad6`
**Consecutive red runs:** `4`
**Escalation:** `AUTHOR_ESCALATION_REQUIRED`
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

## Author escalation

This root-failure signature remained red for 4 consecutive scheduled
battery runs. Escalate to the author (Charlie Cheever) before the next run.
