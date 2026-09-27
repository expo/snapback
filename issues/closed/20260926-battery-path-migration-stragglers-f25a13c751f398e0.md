# complete battery red: path-migration-stragglers

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `3a1f8b55d22cbe2f79c58b0eb19e452fd02569a5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:f25a13c751f398e086e1c2a44cbdb555c8305ae277bbe76c8f0e2dcdb3c1e000`
**First observed run:** `local.20260926T223620Z.3b21178b41db`
**Last observed run:** `local.20260926T223620Z.3b21178b41db`
**Last processed run:** `local.20260927T084919Z.3a1f8b55d22c`
**Detected at revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Last observed revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
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
