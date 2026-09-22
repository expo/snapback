# main drift: sequence-allocation-publication has a stale committed record

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Tooling, CI
**Date:** 2026-09-20
**Drift gate:** `sequence-allocation-publication`
**Outcome:** `STALE`
**Failure signature:** `sha256:713c55c0278c436e328d25c5da5eccda35be387879be2f0bbcb909b2bd1f2217`
**Causal landing:** `912145dac676fd06605c57d35ebf21a863381183` (fix(auth): bound settlement test observers)
**Detected at:** `cca6a2d0b1fc14f337f592c880e260242b97fd9b`
**Last observed:** `e7c955d366a57ba7005f500d2a396c63e92be141`
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
