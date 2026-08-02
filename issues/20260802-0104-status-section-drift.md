# LLP 0104 metadata and trailing Status section disagree

**Status:** Open
**Date:** 2026-08-02
**Systems:** LLP corpus, Metering, Observability
**Related:** LLP 0104, LLP 0154 OQ1,
`issues/20260802-obs-02-operation-class-registry-and-fixtures.md`

## Observation

LLP 0104's metadata header says `**Status:** Accepted`
(`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md`, line 4 on
2026-08-02 main), and its `Revised` history records Charlie Cheever's
2026-07-28 acceptance after dual-READY convergence (line 8). The trailing
[`## Status`](../llp/0104-expo-hosted-metering-and-commercial-contract.spec.md#status)
section instead begins `Draft.` (lines 550–552).

Those two status authorities now disagree inside one document. This is corpus
hygiene, not a substantive conflict in LLP 0104's metering identity or
`operation-class.v1` contract. It does not block LLP 0154 OQ1 reconciliation or
obs-02 implementation; the accepted metadata header and dated acceptance
history remain the operative status evidence.

## Resolution scope

Reconcile the trailing Status section with the Accepted metadata and acceptance
history without changing any commercial candidate, measurement gate, launch
recheck, or chargeability rule. Preserve the distinction between an accepted
specification and the gate-pending prices and limits it explicitly contains.

## Closure acceptance

- The metadata header, revision history, and trailing Status section all report
  a mutually consistent document status.
- Any edit records a dated `Revised` note and does not silently ratify a price,
  quota, provider fact, or other gate-pending value.
- `./ref-check --verbose` passes.
- The resolution is recorded here and this ticket moves to `issues/closed/`
  with its landing commit.
