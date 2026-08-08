# main drift: local-store-carrier-receipt has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-08
**Drift gate:** `local-store-carrier-receipt`
**Causal landing:** `b9dd2f216edf9d07ff9d80c0314b8f3dc4fbc11e` (fix(client): export createAssetClient from the package root and pin declared-vs-runtime export parity)
**Detected at:** `7b8df2715264191f63e5efe71f9cc37cf25dd2c9`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `local-store-carrier-receipt` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json`
- `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/acceptance/local-store-carrier-exit-v1.mjs --check
```

Regenerate/reconcile:

```sh
node tests/acceptance/local-store-carrier-exit-v1.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
