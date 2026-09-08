# complete battery red: auth-handshake

**Status:** Open
**Reopened by battery run:** `local.20260908T030804Z.a75c98406a26`
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `6954679b09aedf975783ec04650aa3e7728ba9d5`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-24
**Battery gate:** `auth-handshake`
**Failure signature:** `sha256:c219e5ccf74ae281b3e8f5bae467262848289054dded1f0a59b8c50b9e31a8a5`
**First observed run:** `local.20260824T022619Z.88476b032428`
**Last observed run:** `local.20260908T125200Z.e6c89816b6d2`
**Last processed run:** `local.20260908T125200Z.e6c89816b6d2`
**Detected at revision:** `88476b0324286a5c8bde4b0c1d877ae542cf96e7`
**Last observed revision:** `e6c89816b6d292a5310cf59cdc3a43003b37af29`
**Consecutive red runs:** `2`
**Escalation:** `pending (2/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `auth-handshake` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `auth-handshake` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/auth-handshake.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
