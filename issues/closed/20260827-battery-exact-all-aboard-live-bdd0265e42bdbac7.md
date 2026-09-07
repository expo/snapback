# complete battery red: exact-all-aboard-live

**Status:** Closed
**Reopened by battery run:** `local.20260906T145321Z.2fd1b33c02f7`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-27
**Battery gate:** `exact-all-aboard-live`
**Failure signature:** `sha256:bdd0265e42bdbac7bb7ef5fe9ebdddac04c6e4e45727fa4c656d23ae95da2ce1`
**First observed run:** `local.20260827T191659Z.cf68cae13934`
**Last observed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Last processed run:** `local.20260907T021018Z.6954679b09ae`
**Detected at revision:** `cf68cae139349e56a221efac827ac435fc09be73`
**Last observed revision:** `2fd1b33c02f70bb03d0b06116dfd17ccd7be0b26`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `exact-all-aboard-live` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `exact-all-aboard-live` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun demos/all-aboard/tests/acceptance/contract-live.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
