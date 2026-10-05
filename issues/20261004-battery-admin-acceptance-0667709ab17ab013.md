# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-10-04
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:0667709ab17ab01324ba0fbcaf71305034f96122df015c3e8e775730b7ea299d`
**First observed run:** `local.20261004T210738Z.f2ec49837937`
**Last observed run:** `local.20261004T210738Z.f2ec49837937`
**Last processed run:** `local.20261004T210738Z.f2ec49837937`
**Detected at revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
**Last observed revision:** `f2ec498379376421ce7f329c9efee972463cedc3`
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
