# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-03
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:106b44c73fdb23ec0999db2a9b0a980416640d7d2c1b96842fa49e326c23e199`
**First observed run:** `local.20260903T154459Z.afba645047a6`
**Last observed run:** `local.20260903T154459Z.afba645047a6`
**Last processed run:** `local.20260903T154459Z.afba645047a6`
**Detected at revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
**Last observed revision:** `afba645047a6b7e59ac7ba3547cdfb4e23d6be77`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `admin-acceptance` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- None.

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `admin-acceptance` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bash -lc cd\ admin-ui\ \&\&\ ./build.sh\ \&\&\ bun\ run\ test\ \&\&\ bun\ run\ test:browser-security\ \&\&\ bun\ run\ audit:production
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
