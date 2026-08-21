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
