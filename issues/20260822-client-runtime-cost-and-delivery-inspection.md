# Implement client runtime-cost and stalled-delivery inspection

**Status:** Open
**Opened:** 2026-08-22
**Systems:** Client SDK, Outbox, Live queries, Provider inspection, Diagnostics
**Governing:** LLP 0267 §§7.2, 7.4; LLP 0095; LLP 0114; LLP 0295 W5
**Source:** `issues/closed/20260821-app-boundary-runtime-cost-diagnostics-design.md`

## Scope

- Add typed `MutationPhaseCostV1` projection from the existing LLP 0059
  ruling-6 carrier, with one derived-duration vocabulary.
- Extend subscription inspection with delivery lag, dedup suppression, and
  the bounded/redacted D0.5 ownership projection.
- Implement the inspect-time join deriving `pendingDeliveryReason` from the
  client and server snapshots using LLP 0267 §7.4's ordered four-outcome
  decision procedure; store the result on neither side.

## Exit

Targeted client/provider tests prove delayed foreground-send attribution,
join uniqueness, all six reason classes, neutral/defect/snapshot-skew outcomes,
composite invalidation-during-evaluation, commitless restoration, both skew
directions with reread, and caller-influencable-id pseudonymization.
