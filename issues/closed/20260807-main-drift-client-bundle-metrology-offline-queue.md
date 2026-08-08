# main drift: client-bundle-metrology has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-07
**Drift gate:** `client-bundle-metrology`
**Causal landing:** `55564b1018eb2a5e1c68f74b090e2b912b8253cf` (feat(client): implement LLP 0043 JS-arm sessions-custody offline queue)
**Detected at:** `de41433a49f43dd182e64cb70af6886c8089b153`
**Attribution:** `first-parent-record-epoch-bisection`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `client-bundle-metrology` independently of path selection on
`main` and found the committed record stale. The first-parent record-epoch
attribution names the landing above; this ticket is keyed by gate and remains
idempotent while open.

## Stale record

- `tests/fixtures/client-bundle-metrology/current.v1.json and its active profile/baseline ledgers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/client-bundle-metrology.mjs --check
```

Regenerate/reconcile:

```sh
node scripts/client-bundle-metrology.mjs --write-current
```

For an explicitly reviewed bundle rollover:

```sh
node scripts/client-bundle-metrology.mjs --write-rollover-baseline
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.

## Resolution — 2026-08-07

Reconciled by the Delete-admission lane (which this drift blocked: the rollover
mint pre-check refuses while any un-superseded ceiling fails). The regression
is the landed LLP 0043 JS-arm sessions-custody offline queue itself
(`55564b1018eb1`, `outbox-shared.mjs` +195 lines, `index.mjs` +612 lines), not
an accident: nine closures grew (largest: `public-subpath-rqs-store-default`
minified 57,487 → 62,514; `public-subpath-outbox-shared` minified
18,377 → 21,340; full deltas in the receipt rationale). Reconciled as the
explicitly reviewed rollover
`tests/fixtures/client-bundle-metrology/baseline.sessions-custody-offline-queue.v1.json`
(workload `js-arm-sessions-custody-offline-queue.2026-08-07.v1`) minted via
`--write-rollover-baseline` with the behavior train green; predecessor
receipts remain immutable; no other active ceiling moved. `--check` verified
green on the reconciled record before landing.

**Status:** Closed 2026-08-07.
