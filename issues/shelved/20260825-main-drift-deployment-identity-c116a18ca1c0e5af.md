# main drift: deployment-identity has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-25
**Drift gate:** `deployment-identity`
**Outcome:** `STALE`
**Failure signature:** `sha256:c116a18ca1c0e5af044271fc7fe7bad8947b23f39c760671e366d034f96bf77a`
**Causal landing:** `none — record-epoch-off-first-parent`
**Detected at:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Last observed:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Attribution:** `record-epoch-off-first-parent`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `deployment-identity` independently of path selection on
`main` and found the committed record stale, but record-epoch-off-first-parent prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `targets/cloudflare/generated/deployment-identity.notes.json`
- `targets/cloudflare/generated/deployment-identity.all-aboard.json`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node targets/cloudflare/scripts/generate-deployment-identity.mjs --check
```

Regenerate/reconcile:

```sh
node targets/cloudflare/scripts/generate-deployment-identity.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
