# Integrate, document, and prove runtime-cost diagnostics

**Status:** Open — depends on the three implementation slices graduated with it
**Opened:** 2026-08-22
**Systems:** Diagnostics, CLI/inspection, Guide, Acceptance testing
**Governing:** LLP 0267 §7.7; LLP 0031 D3; LLP 0295 W5
**Depends on:** `issues/20260822-runtime-cost-recorder-and-server-observations.md`;
`issues/20260822-client-runtime-cost-and-delivery-inspection.md`;
`issues/20260822-equivalent-work-and-framework-multiplicity-diagnostics.md`

## Scope

- Expose one gated, pull-only local snapshot through the existing LLP 0031 D3
  path or in-process CLI; add no new telemetry protocol.
- Extend the query-cost guide (or a focused sibling) with the delayed-send and
  stalled-live-projection worked attributions.
- Assemble LLP 0267 §7.7's integrated redaction, bounds, attribution,
  multiplicity, posture, and snapshot-join fixtures.

## Exit

The affected proof passes; `PublicInspect` remains unchanged; hosted serving
has the recorder off and no export/upload path; both worked cases are
attributable without source inspection or empirical retry delays; guide and
diagnostic-register checks pass; LLP 0267 and LLP 0295 receive an
implementation-status reconciliation without overstating hosted capability.
