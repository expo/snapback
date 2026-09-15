# complete battery red: path-migration-stragglers

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-15
**Battery gate:** `path-migration-stragglers`
**Failure signature:** `sha256:d458cb48fcc28dd1ec27eba1188ae1a77d19559c5bed01a9470964fe40219ffd`
**First observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last observed run:** `local.20260915T190403Z.ca4844fb29ff`
**Last processed run:** `local.20260915T190403Z.ca4844fb29ff`
**Detected at revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
**Last observed revision:** `ca4844fb29ff71c92ad531a4bc2fa0e53b20d5fe`
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
