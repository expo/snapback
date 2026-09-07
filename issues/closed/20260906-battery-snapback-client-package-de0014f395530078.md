# complete battery red: snapback-client-package

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-06
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:de0014f3955300786b548ae4464e9758dc43ebdff5ff89c18c1c3a0a08e3949a`
**First observed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Last observed run:** `local.20260906T145321Z.2fd1b33c02f7`
**Last processed run:** `local.20260907T021018Z.6954679b09ae`
**Detected at revision:** `2fd1b33c02f70bb03d0b06116dfd17ccd7be0b26`
**Last observed revision:** `2fd1b33c02f70bb03d0b06116dfd17ccd7be0b26`
**Consecutive red runs:** `1`
**Escalation:** `pending (1/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `snapback-client-package` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `snapback-client-package` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
bun run --cwd packages/snapback-client test
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
