# complete battery red: snapback-client-package

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-26
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:8b6b17e2f4d3dca3612f23ad94f1552d5ac37801a6f68367508defb8fcc4da38`
**First observed run:** `local.20260926T223620Z.3b21178b41db`
**Last observed run:** `local.20260926T223620Z.3b21178b41db`
**Last processed run:** `local.20260926T223620Z.3b21178b41db`
**Detected at revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
**Last observed revision:** `3b21178b41dbd0a8efad2e944048be55107dd31a`
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
