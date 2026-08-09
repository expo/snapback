# main drift: auth-invalidation-report has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-09
**Drift gate:** `auth-invalidation-report`
**Causal landing:** `4091c63a18438960dbe104418ec3e771c93d5460` (refactor(0199): broaden contract/types leaf — 35 more types out of manifest.rs)
**Detected at:** `4091c63a18438960dbe104418ec3e771c93d5460`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `auth-invalidation-report` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `tests/acceptance/auth-invalidation-v1-composed-receipt.json`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/acceptance/auth-invalidation-v1-report.mjs
```

Regenerate/reconcile:

```sh
node tests/acceptance/auth-invalidation-v1-report.mjs --print > tests/acceptance/auth-invalidation-v1-composed-receipt.json
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
