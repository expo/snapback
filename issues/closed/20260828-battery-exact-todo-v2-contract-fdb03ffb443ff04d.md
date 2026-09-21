# complete battery red: exact-todo-v2-contract

**Status:** Closed
**Reopened by battery run:** `local.20260920T195819Z.92d678d5700d`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `66fc10578f220d2f07d42820f927c5fb80887d96`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `exact-todo-v2-contract`
**Failure signature:** `sha256:fdb03ffb443ff04dc7dce6ae0d7cfad349edab64b26d1b2ff62b841feb3709c7`
**First observed run:** `local.20260828T203031Z.1b23bca7239e`
**Last observed run:** `local.20260920T195819Z.92d678d5700d`
**Last processed run:** `local.20260921T053735Z.66fc10578f22`
**Detected at revision:** `1b23bca7239ee7627153e7422a55cc3080329948`
**Last observed revision:** `92d678d5700d5a95303f12bb69ba8537fb9d977f`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-todo-v2-contract` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-todo-v2-contract` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/todo-v2/tests/acceptance/contract.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
