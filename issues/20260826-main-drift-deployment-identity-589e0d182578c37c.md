# main drift: deployment-identity has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-26
**Drift gate:** `deployment-identity`
**Outcome:** `STALE`
**Failure signature:** `sha256:589e0d182578c37cbea71b43d3659fca7d7a2e484bd317a3f7e015861af4f224`
**Causal landing:** `none — record-epoch-off-first-parent`
**Detected at:** `625f3bb9845490cb767a81c79debc2bb639ba1f7`
**Last observed:** `625f3bb9845490cb767a81c79debc2bb639ba1f7`
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
