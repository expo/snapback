# main drift: diary-identity has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-24
**Drift gate:** `diary-identity`
**Outcome:** `STALE`
**Failure signature:** `sha256:604a3ebbcdeec07f0a8e5832e829dc119a1514e5eb91f5f442924f02f69969ae`
**Causal landing:** `none — record-epoch-off-first-parent`
**Detected at:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Attribution:** `record-epoch-off-first-parent`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `diary-identity` independently of path selection on
`main` and found the committed record stale, but record-epoch-off-first-parent prevents a supported causal-landing claim. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `scripts/check-diary-identity.mjs KNOWN_COLLISIONS (author-ruled historical diary aliases)`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node scripts/check-diary-identity.mjs --strict
```

Regenerate/reconcile:

```sh
node scripts/check-diary-identity.mjs --strict
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
