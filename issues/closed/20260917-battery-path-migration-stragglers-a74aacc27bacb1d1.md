# complete battery red: path-migration-stragglers

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `dc1abf6b73943f637964c7e8160ef477f77afa90`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-17
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:a74aacc27bacb1d127e091efd3cdc2fec9b73026ec1651e71438507567b14d82`
**First observed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Last observed run:** `local.20260917T214352Z.81bd5e61eb1a`
**Last processed run:** `local.20260918T081626Z.dc1abf6b7394`
**Detected at revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Last observed revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `path-migration-stragglers` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `path-migration-stragglers` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node scripts/check-path-migration-stragglers.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
