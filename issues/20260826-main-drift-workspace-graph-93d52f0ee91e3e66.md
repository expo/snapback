# main drift: workspace-graph has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-26
**Drift gate:** `workspace-graph`
**Outcome:** `STALE`
**Failure signature:** `sha256:93d52f0ee91e3e66963e0dc99e413a4bc67e802422c7cbc732433fa7bcf552a0`
**Causal landing:** `ac20e30a64c706f895987ce8619af7de34f00864` (fix(auth): bind resolved app authority to its producer)
**Detected at:** `625f3bb9845490cb767a81c79debc2bb639ba1f7`
**Last observed:** `ad53ab3d97c07bee4446f03187164167c2c0d034`
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
