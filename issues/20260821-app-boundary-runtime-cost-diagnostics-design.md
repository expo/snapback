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
for subscription-budget interactions. Revised same day through two review
rounds: LLP 0267 v0.8 (dual xhigh round — codex 5 MAJOR + grok MAJORs 1–5,
MINORs 6–15), v0.9 (codex delta re-review items 1–4 + grok round-4
pins 1–3), and v0.10 (codex round-4 single MAJOR — registry owed-ness
facts). Summary:

- **Posture settled first (LLP 0295 open question 5 — recommendation: yes).**
  Local developer diagnostics only in v1; hosted telemetry is an explicit
  nonclaim (no export, no upload, no new streaming/telemetry protocol; the
  single egress is the gated pull snapshot; hosted recorder off by
  default; instance-local operator inspection is not telemetry). Lifting the
  nonclaim requires a new dated amendment with its own privacy review.
- **Redaction:** LLP 0267 §1.1 / LLP 0108 value-free discipline, with two
  gated-surface-only extensions. Correlation ids split by influencability:
  framework-minted ids (subscription id, server-minted `sct_` connection
  id, opaque asset id, D0.5 owner label constrained to framework surface
  identifiers) appear verbatim; caller-influencable ids (caller-suppliable
  `clientMutationId`, trusted-local caller-suggested connection ids per
  LLP 0031 D3) are projected to stable inspection-only pseudonyms at every
  snapshot boundary. The equivalence/pseudonym hash reuses §5's
  canonical-JSON algorithm (honestly framed: a fingerprint for low-entropy
  inputs, hence gated-only; computed fresh on non-cursor paths). Raw args,
  row contents/ids, principals, tokens, endpoints remain forbidden
  everywhere; query-cost retention is a projection with no
  `fixtureIdentity` field, and the D0.5 tuple projects to authority class
  + instance self, no literal origin. `PublicInspect` gains no cost
  fields.
- **Bounded storage:** three ring families, each bounded by record count
  (512) and byte-accounted per-family budgets (≤4 MiB total) with
  truncation markers and per-family `droppedRecords`; per-key counter maps
  capped (1,024 keys) with `otherKeys` aggregate + `evictedKeys` so totals
  stay exact; no durable persistence; counters-exact/details-sampled;
  gated pull-only snapshot; recorder default on in `snapback dev` and off
  in serving.
- **Mutation phases:** consumes LLP 0059 ruling 6 (D0.2) fields unchanged;
  adds the derived vocabulary (`queueWaitMs`, `authWaitMs`, `executionMs`,
  `commitMs`, null when a phase is unreached) and a typed
  `MutationPhaseCostV1` client ring; delivery lag is subscription-scoped
  only (first covering delivery, client clock) and lives on the inspection
  row, not the mutation record; server contributes per-function phase
  counters.
- **Query/live:** bounded retention as the distinct
  `QueryCostObservationInspectV1` projection (§1.1 scalars verbatim, no
  `fixtureIdentity` field, bounded `consultationSample` + exact
  `totalConsultations` + `consultationsTruncated` — the closed §1.1 record
  is never truncated) plus new **server-owned** `LiveDeliveryWaveV1` —
  process-monotone `waveSeq`, closed trigger-class `rerunCause` with
  precedence, `coalesced` flag, `coveredVersions` range, observed
  subscriber/group counts, real/memo turn counts with max+checked-sum
  timing. Join: subscription id → server registry row → `waveSeq`; the
  registry row carries exact, unsampled per-subscription facts —
  `lastDeliveredWaveSeq`/`lastDeliveredVersion` plus `owedThroughVersion`
  (newest invalidating committed version; advances at matcher charge,
  resets on delivery), `pendingState`
  (`idle`/`queued`/`coalescing`/`evaluating`), and `currentWaveSeq` while
  evaluating; all versions are LLP 0095 §1.3 `LIVE(version)` storage
  commit versions.
  `LiveCoalesceStats` already serialize on `InspectState`/`PublicInspect`
  (`liveCoalesce`); the wave record complements them and is the per-wave
  detail the 20260808 ticket deferred.
- **Subscriptions:** consumes the D0.5 inspection floor and budget
  semantics verbatim (>16 per view warns and remains supported; only the
  64-per-connection ceiling refuses) and adds the client-owned cost fields
  (delivery lag — scalar pinned to the most recent covered commit, client
  clock; dedup-suppression counter). `pendingDeliveryReason` is a
  **derived inspect-time join result** computed by tooling over the two
  gated snapshots, stored on neither side — a closed six-member enum with
  a pinned precedence order (terminal-quarantine, auth-barrier,
  custody-unsettled, authority-unavailable, transport-recovery,
  server-pending; candidates 1–5 from the client row, owed-ness and member
  6 from the registry row's `owedThroughVersion`/`pendingState`) over a
  defined owed-delivery condition (`owedThroughVersion` >
  `authoritativeRevision`); value-equal dedup is a completed delivery, not
  a miss.
- **Repeated equivalent writes/effects:** only provable equivalences —
  no-op commits (empty row-image delta), identical (function, args-hash)
  enqueues in a window, housekeeping-supersession counts. Warnings/counters
  only, never refusals; no semantic-intent guessing and no same-function
  rate detector (differing-args-per-keystroke is out of this counter's
  scope by design).
- **React/provider/asset multiplicity:** consumes the D0.5 budgets/
  diagnostics unchanged; adds duplicate-subscription facts (identity =
  function + args hash + connection tuple, explicitly excluding the owner
  label so cross-owner duplicates fire; owner labels are the output) and
  asset-issuance multiplicity per (asset id, owner) window. Warning-class
  only; multiplicity warnings define their own closed register details
  under §4.1's value-free rule.
- **Attribution obligations closed:** delayed foreground send via
  `outboxStatus()` + phase record; stalled live projection via inspection
  row + missed-delivery vocabulary + wave record. Acceptance fixtures
  enumerated in §7.7 (attribution, redaction, bounds, multiplicity,
  hosted-off posture).

### Implementation checklist (graduate each lane to its own ticket on owner acceptance)

- [ ] Owner acceptance: LLP 0267 (this §7), LLP 0095/0114 client half,
      LLP 0278 budget interactions — flip §7's marker from Proposed on
      acceptance.
- [ ] Recorder core: three ring families with byte-accounted admission,
      truncation markers, per-family `droppedRecords`; capped counter maps
      with `otherKeys`/`evictedKeys`; sampling rule; dev-on/serve-off
      default; hosted-off proof.
- [ ] Server phases: per-function authorization/execution/commit phase
      counters in the ruled vocabulary; bounded
      `QueryCostObservationInspectV1` retention (sample + exact totals +
      truncation flag; no `fixtureIdentity` field).
- [ ] `LiveDeliveryWaveV1` emission at the §1.5 boundaries — `waveSeq`,
      primary-cause precedence, `coalesced`/`coveredVersions`, per-group
      max+sum timing; registry rows maintain the exact unsampled
      per-subscription facts (`lastDeliveredWaveSeq`/
      `lastDeliveredVersion`, `owedThroughVersion` advance/reset,
      `pendingState`, `currentWaveSeq`) at the matcher/coalescer/
      evaluation seams (complements the existing `liveCoalesce` inspect
      fields; no second coalesce surface).
- [ ] Client: typed `MutationPhaseCostV1` from the ruling-6 fields (after
      W2 lands the carriers); derived-duration vocabulary in one place;
      subscription-row delivery lag (first covering delivery, client
      clock, scalar = most recent covered commit); snapshot pseudonym
      projection for caller-influencable ids.
- [ ] D0.5 inspection row: client-owned cost fields; inspect-time join
      tooling deriving `pendingDeliveryReason` per the pinned precedence
      and owed-delivery condition over both gated snapshots (client +
      provider surfaces); D0.5 tuple projection (authority class, instance
      self); `LIVE(version)` domain per LLP 0095 §1.3.
- [ ] Repeated-equivalent-write counters (no-op commit, equivalent enqueue,
      housekeeping supersession).
- [ ] React/provider duplicate-subscription and asset-issuance multiplicity
      facts with owner labels.
- [ ] Inspection snapshot surface (gated LLP 0031 D3 path or in-process
      CLI; exact spelling implementation-owned) — pull-only; `PublicInspect`
      unchanged, proven by fixture.
- [ ] Warning-code spellings through the generated diagnostics register.
- [ ] Guide: extend `guide/backend/query-costs.md` (or a sibling page) with
      reading the cost snapshot and the two worked attributions.
- [ ] Acceptance fixtures per §7.7 (attribution ×2, redaction incl.
      adversarial caller-supplied ids, join uniqueness, bounds,
      multiplicity, posture).
