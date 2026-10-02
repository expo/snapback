# main drift: workspace-graph has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-14
**Drift gate:** `workspace-graph`
**Outcome:** `STALE`
**Failure signature:** `sha256:dbf34edef3cd3b7c2793726256cd13b7e6e9a1f1a98face41d54ecd317874d3f`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Last observed:** `995b1c26694246b7a2c183b0f2ee65fe09947549`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `workspace-graph` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `crates/allowed-dependencies.v1.json workspace owner/rank matrix, external confinement, engine residue denylist, and named membership exceptions`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/check-workspace-graph.mjs
```

Regenerate/reconcile:

```sh
node scripts/check-workspace-graph.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
