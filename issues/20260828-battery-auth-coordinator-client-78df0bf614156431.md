# complete battery red: auth-coordinator-client

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-08-28
**Battery gate:** `auth-coordinator-client`
**Failure signature:** `sha256:78df0bf6141564313626e39ec43a448e077e898232d74c7ca9810ca93bf9a27f`
**First observed run:** `local.20260828T114709Z.095880f16775`
**Last observed run:** `local.20260829T051119Z.45ebcadce605`
**Last processed run:** `local.20260829T051119Z.45ebcadce605`
**Detected at revision:** `095880f167755431165137247bd51844b8c29e09`
**Last observed revision:** `45ebcadce6052132fd6c69a0487b3c1258bda1f3`
**Consecutive red runs:** `3`
**Escalation:** `pending (3/4)`
**Related:** LLP 0189 D-1, LLP 0175 D2.3

## Summary

The scheduled complete canonical battery reported `auth-coordinator-client` as a root
failure (exit 1). This ticket is keyed by gate plus the normalized
root-failure signature and remains idempotent while open. Dependent `BLOCKED`
results do not create tickets.

## Standing claim cross-references

- `single_table_v1` — `crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

These are the standing published claims whose recorded LLP 0189 D-4 scope
derives `auth-coordinator-client` as claim-relevant for this battery revision.

## Reproduce and repair

```sh
node demos/_kit/tests/auth-coordinator-client.mjs
```

Fix forward, rerun the complete battery, and let the next determinate pass close
this signature. Four consecutive red observations require author escalation.
