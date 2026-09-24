# complete battery red: drift-prone-gate-fixtures

**Status:** Open
**Reopened by battery run:** `local.20260924T130725Z.942753a689cd`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `81bd5e61eb1ada23d6d00618afd0fb020be3eafc`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-14
**Battery gate:** `drift-prone-gate-fixtures`
**Failure signature:** `sha256:ab0a84c5e6746dc989f7fd5ed51e44c1ae30df0ccf27d17d4f98f23a1ea99577`
**First observed run:** `local.20260914T214631Z.8f56e50f6d78`
**Last observed run:** `local.20260924T130725Z.942753a689cd`
**Last processed run:** `local.20260924T130725Z.942753a689cd`
**Detected at revision:** `8f56e50f6d78cad0378c07114505a0eac5752580`
**Last observed revision:** `942753a689cd474aeff0cc571b2b4336ca4fe9f4`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `drift-prone-gate-fixtures` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `drift-prone-gate-fixtures` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node --test tests/drift_prone_gates_v0.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
