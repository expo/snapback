# main drift: deployment-identity has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-24
**Drift gate:** `deployment-identity`
**Outcome:** `STALE`
**Failure signature:** `sha256:4594e462a13811612a880d4dc49b8a3e3bb0bfa6cbc42230f7a507cd0b527c11`
**Causal landing:** `1e0c43b343a235818155022d6bf69bb2b9abbd4d` (fix(graph): B2 fix round 3 — alias provenance fail-closed, closed nested cost records, shared JS/Rust parity corpus)
**Detected at:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `deployment-identity` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
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
