# complete battery red: todo-v2-headless

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `todo-v2-headless`
**Failure signature:** `sha256:a81d638a8f375e1a1192373bb1f8f892ed5e2c36d0daca3c80ae8eb2a7ee6701`
**First observed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Last observed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Last processed run:** `local.20260918T081626Z.dc1abf6b7394`
**Detected at revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Last observed revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `todo-v2-headless` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `todo-v2-headless` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/todo-v2/tests/acceptance/headless.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
