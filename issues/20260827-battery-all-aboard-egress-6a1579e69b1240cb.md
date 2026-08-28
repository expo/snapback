# complete battery red: all-aboard-egress

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `all-aboard-egress`
**Failure signature:** `sha256:6a1579e69b1240cbe9dec533ad1d4aa7dbe94974f2d10456e2896129fe83783f`
**First observed run:** `local.20260827T104322Z.04da2f52bd6f`
**Last observed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Last processed run:** `local.20260828T032832Z.2fbb5bd35a5d`
**Detected at revision:** `04da2f52bd6f08bfb8a6767fbb4ce25a610701b3`
**Last observed revision:** `2fbb5bd35a5d7355b5bf9abf3dc6417ea7a02473`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `all-aboard-egress` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `all-aboard-egress` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/all-aboard/tests/acceptance/egress.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
