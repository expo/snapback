# Integrate, document, and prove runtime-cost diagnostics

**Status:** Open — implementation landed; full §7.7 assembly remains
**Opened:** 2026-08-22
**Systems:** Diagnostics, CLI/inspection, Guide, Acceptance testing
**Governing:** LLP 0267 §7.7; LLP 0031 D3; LLP 0295 W5
**Depends on:** `issues/closed/20260822-runtime-cost-recorder-and-server-observations.md`;
`issues/closed/20260822-client-runtime-cost-and-delivery-inspection.md`;
`issues/closed/20260822-equivalent-work-and-framework-multiplicity-diagnostics.md`

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

## Progress — 2026-08-24 fix round

The existing authenticated LLP 0031 D3 pull exposes the bounded instance-local
snapshot without a new protocol. The fix-round receipt starts a real managed
server, establishes a real client subscription, pulls `app.inspect` through the
ready-file-authenticated host operation, serializes that envelope, and feeds
the parsed `data.runtimeState` into the client join. A JS-handler observation is
retained with `complete: false`, positive result facts, no physical
consultations, and no application values, so physical zeros cannot be mistaken
for measured zero work. The production declarative-query producer separately
proves value-free best-effort index facts and branch-and-drop collection
failure.

This does **not** claim that multiplicity and hosted/direct posture were
reassembled into that cross-process fixture. Those facts remain proven only by
their focused A/C/server owner tests. The §7.7 full integrated acceptance line
therefore remains open; LLP 0267 and LLP 0295 record source implementation and
the narrower receipt without claiming complete W5 acceptance or hosted
telemetry/export.
