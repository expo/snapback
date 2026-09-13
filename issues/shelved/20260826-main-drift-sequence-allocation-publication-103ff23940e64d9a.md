# main drift: sequence-allocation-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-26
**Drift gate:** `sequence-allocation-publication`
**Outcome:** `STALE`
**Failure signature:** `sha256:103ff23940e64d9a20ec06ad3dff92a341cac2dbb285eebc7ca931916f100171`
**Causal landing:** `ac20e30a64c706f895987ce8619af7de34f00864` (fix(auth): bind resolved app authority to its producer)
**Detected at:** `625f3bb9845490cb767a81c79debc2bb639ba1f7`
**Last observed:** `625f3bb9845490cb767a81c79debc2bb639ba1f7`
**Attribution:** `first-parent-signature-epoch`
**Related:** LLP 0175 §D2.1

## Summary

The frozen-record backstop ran `sequence-allocation-publication` independently of path selection on
`main` and found the committed record stale. The conservative first-parent-signature-epoch attribution names the landing above. This ticket is keyed by gate plus
normalized failure signature and remains idempotent while open.

## Stale record

- `crates/snapback-engine/src/local-sequence-allocation-publication.v1.json and its pinned readers`

Checker materialization, when available:

- The checker did not materialize a working-tree diff; see its command output.

## Reproduce and reconcile

Check:

```sh
node tests/conformance/sequence-allocation-publication-v1.mjs
```

Regenerate/reconcile:

```sh
node scripts/refresh-publication-carrier.mjs
```

Commit the reconciled record with the measured change, verify the gate, record
the resolution here, and move this ticket to `issues/closed/`.
