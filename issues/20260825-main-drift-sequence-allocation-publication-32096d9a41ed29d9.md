# main drift: sequence-allocation-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-08-25
**Drift gate:** `sequence-allocation-publication`
**Outcome:** `STALE`
**Failure signature:** `sha256:32096d9a41ed29d9ec0b513a7f6d4bdcd119506dea25a0ea128dcc4d726f239f`
**Causal landing:** `0597c4e7c3ed5d01afcedcb772e879904c308b25` (fix(ephemeral): pin membership projection axes to the declaration; restore the corrupt-row proof)
**Detected at:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
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
