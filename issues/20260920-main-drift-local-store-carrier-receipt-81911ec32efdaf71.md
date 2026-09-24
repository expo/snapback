# main drift: local-store-carrier-receipt has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-20
**Drift gate:** `local-store-carrier-receipt`
**Outcome:** `STALE`
**Failure signature:** `sha256:81911ec32efdaf71a39ca910d73fe718ffaefa335a301eec6b7f30fffbdf2c60`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Last observed:** `a746cdf4ec8a7b10c5770f936b9d5c38c5e872fa`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `local-store-carrier-receipt` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json`
- `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-06.v1.json`

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
