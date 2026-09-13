# main drift: contract-meta has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-24
**Drift gate:** `contract-meta`
**Outcome:** `STALE`
**Failure signature:** `sha256:22d74de6008cd97858f33142cd40d249c33550cdd6c30366cdac61e848d54450`
**Causal landing:** `none — record-epoch-not-green`
**Detected at:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Attribution:** `record-epoch-not-green`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `contract-meta` independently of path selection on
`main` and found the committed record stale, but record-epoch-not-green prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `non-generated demos/**/*.contract-meta.ts pure-parameter mirrors`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/check-contract-meta.mjs
```

Regenerate/reconcile:

```sh
node scripts/update-contract-meta.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
