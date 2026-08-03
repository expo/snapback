# LLP 0104 metadata and trailing Status section disagree

**Status:** Closed
**Date:** 2026-08-02
**Resolved:** 2026-08-02
**Systems:** LLP corpus, Metering, Observability
**Related:** LLP 0104, LLP 0154 OQ1,
`issues/20260802-obs-02-operation-class-registry-and-fixtures.md`

## Observation

LLP 0104's metadata header says `**Status:** Accepted`
(`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md`, line 4 on
2026-08-02 main), and its `Revised` history records Charlie Cheever's
2026-07-28 acceptance after dual-READY convergence. The trailing
[`## Status`](../../llp/0104-expo-hosted-metering-and-commercial-contract.spec.md#status)
section instead began `Draft.`.

Those two status authorities disagreed inside one document. This was corpus
hygiene, not a substantive conflict in LLP 0104's metering identity or
`operation-class.v1` contract. It did not block LLP 0154 OQ1 reconciliation or
obs-02 implementation; the accepted metadata header and dated acceptance
history remained the operative status evidence.

## Resolution scope

Reconcile the trailing Status section with the Accepted metadata and acceptance
history without changing any commercial candidate, measurement gate, launch
recheck, or chargeability rule. Preserve the distinction between an accepted
specification and the gate-pending prices and limits it explicitly contains.

## Resolution

Resolved on 2026-08-02. LLP 0104's trailing Status section now reports
`Accepted`, explicitly says that acceptance does not ratify gate-pending
commercial or provider values, and retains the launch-time recheck requirement.
The dated `Revised` history records the reconciliation.

## Closure acceptance

- The metadata header, revision history, and trailing Status section all report
  a mutually consistent document status.
- The edit records a dated `Revised` note and does not silently ratify a price,
  quota, provider fact, or other gate-pending value.
- `./ref-check --verbose` passes.
- The resolution is recorded here and this ticket moved to `issues/closed/`
  with its landing commit.
