# Design bounded runtime-cost diagnostics at the application boundary

**Status:** Open — design packet; no ambient telemetry implementation yet
**Opened:** 2026-08-21
**Systems:** Query evaluation, Mutations/outbox, Live queries, React/provider
clients, Assets, Diagnostics, Telemetry
**Governing:** LLP 0295 W5; LLP 0267
**Related:** `issues/20260808-live-query-reevaluation-cost-at-scale.md`;
`issues/20260808-p1-write-priority-scheduling.md`;
`issues/20260820-familiar-live-subscription-contention.md`

## Problem

Reactive write/read amplification becomes visible today only when unrelated UI
operations slow down: unconditional receipt patches, durable per-keystroke
writes, per-conversation scans, repeated equivalent effects, and asset hooks on
every card. Existing authoring guardrails catch some static N+1 shapes but do
not explain queue wait, auth wait, reevaluation cause, subscriber multiplicity,
or delivery latency at the application boundary.

## Design requirements

- Define a bounded local diagnostic record for mutation queue/auth/execution/
  commit/live-delivery phases.
- Define query examined-row, rerun-cause, fan-out, subscriber, snapshot, and
  owner facts without exposing row contents or secrets.
- Decide which repeated equivalent writes/effects and React/provider/asset
  multiplicity the framework can identify without guessing application intent.
- Specify redaction, retention, storage/overhead budgets, sampling, and the
  local-versus-hosted posture before emitting new telemetry.
- Reuse stable diagnostics/inspection surfaces; do not create an always-on
  benchmark-only trace protocol.
- Show how one delayed foreground send and one stalled live projection become
  attributable without source inspection or empirical retry delays.

## Exit

An accepted amendment to LLP 0267 or a narrower owning LLP defines the record,
privacy/overhead contract, local inspection surface, hosted nonclaim, and
acceptance fixtures. Independently closable implementation tickets are filed
for server phases, client subscription ownership, and framework multiplicity.
No implementation begins by collecting unbounded ambient telemetry.

## Design proposal drafted 2026-08-21 — LLP 0267 §7 (proposed; owners to accept)

The W5 design packet is written as the dated amendment **LLP 0267 §7**
("Runtime cost visibility at the app boundary"), marked *Proposed per
LLP 0295 W5; owners to accept* — LLP 0267 for server/query phases,
LLP 0095/LLP 0114 for client inspection and provider multiplicity, LLP 0278
for subscription-budget interactions. Summary:

- **Posture settled first (LLP 0295 open question 5 — recommendation: yes).**
  Local developer diagnostics only in v1; hosted telemetry is an explicit
  nonclaim (no export, no upload, no wire protocol; hosted recorder off by
  default; instance-local operator inspection is not telemetry). Lifting the
  nonclaim requires a new dated amendment with its own privacy review.
- **Redaction:** LLP 0267 §1.1 / LLP 0108 value-free discipline, with two
  local-only extensions: client-visible correlation ids (clientMutationId,
  subscription/connection id, D0.5 owner label) and a non-reversible args
  hash for equivalence counting. Raw args, row contents/ids, principals,
  tokens, endpoints remain forbidden everywhere.
- **Bounded storage:** fixed-capacity per-family rings (default 512 records,
  ≤4 MiB total, overwrite-oldest with a visible `droppedRecords` counter),
  monotone O(1) counters, no durable persistence, counters-exact /
  details-sampled sampling rule, pull-only snapshot, recorder default on in
  `snapback dev` and off in serving.
- **Mutation phases:** consumes LLP 0059 ruling 6 (D0.2) fields unchanged;
  adds only the derived vocabulary (`queueWaitMs`, `authWaitMs`,
  `executionMs`, `commitMs`, `deliveryLagMs`) and a bounded
  `MutationPhaseCostV1` retention.
- **Query/live:** bounded retention of `QueryCostObservationV1` (examined
  rows already there) plus new `LiveDeliveryWaveV1` — closed `rerunCause`
  enum, observed subscriberCount/distinctEvaluationGroups, deliveredFrames,
  dedup-suppression count, §1.5 timing reuse; absorbs the deferred
  `LiveCoalesceStats` exposure from
  `issues/20260808-live-query-reevaluation-cost-at-scale.md`.
- **Subscriptions:** consumes the D0.5 inspection floor (owner label,
  readiness, snapshot version, auth-barrier, suspension reason) and adds the
  cost join plus a closed missed-delivery vocabulary (suspension/blocked
  reasons, version-guard/dedup suppression with counter, terminal
  quarantine, bounded transport recovery) so every missed fan-out delivery
  names exactly one cause.
- **Repeated equivalent writes/effects:** only provable equivalences —
  no-op commits (empty row-image delta), identical (function, args-hash)
  enqueues in a window, housekeeping-supersession counts. Warnings/counters
  only, never refusals; no semantic-intent guessing.
- **React/provider/asset multiplicity:** consumes the D0.5 budgets/
  diagnostics unchanged; adds duplicate-subscription facts (same function +
  args hash + tuple under one manager, owner labels named) and
  asset-issuance multiplicity per (asset id, owner) window. Warning-class
  only.
- **Attribution obligations closed:** delayed foreground send via
  `outboxStatus()` + phase record; stalled live projection via inspection
  row + missed-delivery vocabulary + wave record. Acceptance fixtures
  enumerated in §7.7 (attribution, redaction, bounds, multiplicity,
  hosted-off posture).

### Implementation checklist (graduate each lane to its own ticket on owner acceptance)

- [ ] Owner acceptance: LLP 0267 (this §7), LLP 0095/0114 client half,
      LLP 0278 budget interactions — flip §7's marker from Proposed on
      acceptance.
- [ ] Recorder core: per-family rings, monotone counters, sampling rule,
      `droppedRecords`, dev-on/serve-off default, hosted-off proof.
- [ ] Server phases: authorization/execution/commit spans in the ruled
      vocabulary; bounded `QueryCostObservationV1` retention.
- [ ] `LiveDeliveryWaveV1` emission at the §1.5 boundaries, including
      coalesced-flush and memo-delivery causes; `LiveCoalesceStats` onto the
      snapshot surface.
- [ ] Client: `MutationPhaseCostV1` from the ruling-6 fields (after W2 lands
      the carriers); derived-duration vocabulary in one place.
- [ ] D0.5 inspection cost join + closed missed-delivery vocabulary
      (client + provider surfaces).
- [ ] Repeated-equivalent-write counters (no-op commit, equivalent enqueue,
      housekeeping supersession).
- [ ] React/provider duplicate-subscription and asset-issuance multiplicity
      facts with owner labels.
- [ ] Inspection snapshot surface (CLI/dev-server spelling) — pull-only.
- [ ] Warning-code spellings through the generated diagnostics register.
- [ ] Guide: extend `guide/backend/query-costs.md` (or a sibling page) with
      reading the cost snapshot and the two worked attributions.
- [ ] Acceptance fixtures per §7.7 (attribution ×2, redaction, bounds,
      multiplicity, posture).
