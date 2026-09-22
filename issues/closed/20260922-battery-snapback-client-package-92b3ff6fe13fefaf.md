# complete battery red: snapback-client-package

**Status:** Closed
**Closure:** `signature absent from determinate FAIL`
**Closed at revision:** `50782b08ec432f5829644b2376245e937485fb7a`
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, CI
**Date:** 2026-09-22
**Battery gate:** `snapback-client-package`
**Failure signature:** `sha256:92b3ff6fe13fefaf3b55bac72a7dbe273c1ca19567c1c31286afc103e02614c0`
**First observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last observed run:** `local.20260922T004103Z.6841e7dc8d89`
**Last processed run:** `local.20260922T102119Z.50782b08ec43`
**Detected at revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
**Last observed revision:** `6841e7dc8d89aa57907fa6bd9a43142cd9c7344f`
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
