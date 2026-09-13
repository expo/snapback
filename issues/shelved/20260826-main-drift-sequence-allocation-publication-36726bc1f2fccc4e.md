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
**Failure signature:** `sha256:36726bc1f2fccc4ec4a182b72d3b7f314512b18dc9927c382fd6f7d53d0778bd`
**Causal landing:** `6364729feb221b6b482d1451ca3c2810f4f4e447` (Add invalidation boot reservation checks)
**Detected at:** `ad53ab3d97c07bee4446f03187164167c2c0d034`
**Last observed:** `784babd50de1f9f66ac3f9b155a8105f2886e6ac`
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
