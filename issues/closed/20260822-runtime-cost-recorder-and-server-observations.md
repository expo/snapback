# Implement the bounded runtime-cost recorder and server observations

**Status:** Closed — 2026-08-24
**Opened:** 2026-08-22
**Systems:** Query evaluation, Mutations, Live queries, Diagnostics
**Governing:** LLP 0267 §§7.1–7.3; LLP 0295 W5
**Source:** `issues/closed/20260821-app-boundary-runtime-cost-diagnostics-design.md`

## Scope

- Build the three byte-accounted ring families (512 records each, at most
  4 MiB total), truncation/drop accounting, capped exact counter maps, and
  dev-on/serve-off recorder posture.
- Emit per-function authorization/execution/commit phase counters and the
  bounded `QueryCostObservationInspectV1` projection.
- Emit `LiveDeliveryWaveV1` and maintain the exact subscription registry
  facts and total transition table defined by LLP 0267 §7.3.
- Preserve the value-free/pseudonym rules and leave `PublicInspect` unchanged.

## Exit

Targeted Rust tests prove bounds, recorder-off no-op behavior, hosted-default-
off, redaction, phase nullability, wave cause precedence, compare-and-clear
delivery, every named LLP 0200 exit, and retirement/reconnect behavior.

## Resolution

Closed 2026-08-24 after the landed recorder/server slice was joined to the
production declarative-query producer through validated branch-and-drop
ingestion. Physical collection failure cannot fail the product query, recorder
contention drops instead of waiting, and result-byte accounting reuses the
result-contract serialization. The SQLite producer reports only representable,
value-free best-effort physical facts and keeps `complete: false`; it does not
claim an exact physical consultation ledger. Bounded/redacted retention,
recorder-off behavior, the live transition table, hosted/direct default-off,
and the unchanged public projection remain focused owner-test receipts, not one
cross-process fixture.
