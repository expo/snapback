# complete battery red: path-migration-stragglers

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `8112f4ef640058132c1c58fc69f3fbfaa2143de5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-27
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:86676b83861145af46372749830d7e38d28f85645e58f13dda829d1a1d10c35a`
**First observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last observed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Last processed run:** `local.20260927T175940Z.8112f4ef6400`
**Detected at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Last observed revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
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
