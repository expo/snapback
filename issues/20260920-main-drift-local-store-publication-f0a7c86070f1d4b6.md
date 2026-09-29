# main drift: local-store-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-20
**Drift gate:** `local-store-publication`
**Outcome:** `STALE`
**Failure signature:** `sha256:f0a7c86070f1d4b63b4543297c992c904deaa86b7984e7543396ca1126727ce9`
**Causal landing:** `6abe83b639ae602d7d6ad5e001e0558b1322484a` (Park Snapback 1-3 tickets and keep Snapback 4 as the working set)
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Last observed:** `f56e8048aa9f1c9dc50f29991bd3c96be79044dc`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `local-store-publication` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `crates/snapback-engine/src/local-persistent-store-publication.v1.json and crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/local-persistent-store-publication-v1.mjs
```

Regenerate/reconcile:

```sh
scripts/finalize-local-persistent-store-publication
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
