# main drift: client-bundle-metrology has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-25
**Drift gate:** `client-bundle-metrology`
**Outcome:** `STALE`
**Failure signature:** `sha256:dbe25d3b183e1533f4cb2c31bb01a76d72a5a54479102d52f290f90a3f6af485`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `057ce5898fcc7217dea8dddd7bd4b02deadb4eb7`
**Last observed:** `0fdfadbe8e67a5c930d282e5efe91a633aa76e35`
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
