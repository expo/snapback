# complete battery red: admin-acceptance

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-24
**Battery gate:** `admin-acceptance`
**Failure signature:** `sha256:d2ca3aa4a4c695e916eb712d60ea00987a858d213896ce7bc8994f29a66b2349`
**First observed run:** `local.20260924T025209Z.0388900b82ae`
**Last observed run:** `local.20260924T025209Z.0388900b82ae`
**Last processed run:** `local.20260924T025209Z.0388900b82ae`
**Detected at revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
**Last observed revision:** `0388900b82ae616f55e2ffdab30554df3b64b2fd`
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
