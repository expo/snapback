# main drift: workspace-graph has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-25
**Drift gate:** `workspace-graph`
**Outcome:** `STALE`
**Failure signature:** `sha256:9d515c7cfafa01443ead65b2dd95195072df29dc93c3ce4c61b33601b6473cc6`
**Causal landing:** `9159d5e3a60048924a19eb1fbe1f790a57b4f90c` (feat(engine,server): W5 runtime-cost recorder and server observations)
**Detected at:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Last observed:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `workspace-graph` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
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
