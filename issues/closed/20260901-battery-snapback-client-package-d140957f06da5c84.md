# complete battery red: snapback-client-package

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `2ad65fb5912ca2567874030decdcc4c47733969d`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-01
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:d140957f06da5c8498a9af9d1e43abf51ab768e02d690a68405e9f91286a02ef`
**First observed run:** `local.20260901T114752Z.293de46f68b1`
**Last observed run:** `local.20260901T114752Z.293de46f68b1`
**Last processed run:** `local.20260901T203053Z.2ad65fb5912c`
**Detected at revision:** `293de46f68b17c798cb59287def8568b4baa5706`
**Last observed revision:** `293de46f68b17c798cb59287def8568b4baa5706`
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
