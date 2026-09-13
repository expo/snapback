# main drift: client-bundle-metrology has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-24
**Drift gate:** `client-bundle-metrology`
**Outcome:** `STALE`
**Failure signature:** `sha256:26df30c8723f11a2a23c9c840af31c0d9d34605304d19cf8fca93e9c6c520c3a`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `client-bundle-metrology` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

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
