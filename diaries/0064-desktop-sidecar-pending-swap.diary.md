# 0064 — Desktop sidecar pending-work swap

**Date:** 2026-08-06
**Systems:** `@expo/snapback-sidecar`, `@expo/snapback-client`, file RQS store,
SQLite settlement ledger, desktop real-child acceptance
**Related:** LLP 0129 Phase 2b,
`tests/acceptance/fixtures/desktop-sidecar/hot-swap-design.2026-08-06.v1.md`,
`tests/acceptance/desktop-sidecar-v1.mjs`

## What changed

The desktop sidecar can now preserve and drain a durably pending mutation
while replacing its runtime process. The embedding app owns one explicit file
store for the sidecar database rather than accepting the client's ordinary
per-origin default. A fresh candidate client uses the new ephemeral URL and
that shared store, proves a fresh snapshot, store writer custody, the captured
`clientStoreId`, and exact app/schema/function generation, then adopts the
existing record. The record keeps its original `clientMutationId`; the shared
SQLite settlement ledger remains the exactly-once authority.

## What felt good

- The root cause was pleasantly narrow once the landed design and PoCs were
  treated as authority. No record migration, origin rewrite, or global store
  policy change was needed. The record was already store-owned and replay
  already selected transport from the fresh client's `baseUrl`.
- The existing server ledger did the hard correctness work. The sidecar only
  had to preserve identity and refuse ambiguity; it did not need a second
  duplicate-suppression protocol.
- The old cold-swap safety state machine remained useful. Every new adoption
  check funnels into the same candidate-stop and predecessor-reattach path.
  Keeping v1 valid only for an authoritatively empty queue made backwards
  compatibility explicit instead of weakening the hot receipt.
- The listener-free package double exercised the full stop/start/journal
  state machine quickly, while focused client tests could prove writer and
  identity failure behavior without a runtime process.

## What felt bad or surprising

- The existing non-writer replay result said `remaining: 0` even when a reader
  could see a pending record. That was harmless for advisory reconnect but
  dangerous as a swap commit receipt. Fixing it to read the authoritative
  unresolved count was small and materially improved the API's honesty.
- Generic replay intentionally marks server-refused work failed. That is right
  for ordinary reconnect, but wrong for a reversible candidate trial: an
  identity-divergent candidate must not destroy the predecessor's chance to
  recover. The adoption path therefore uses the same ordered replay machinery
  with terminal failure preserved as pending; the ordinary path is unchanged.
- A “fresh snapshot barrier” is necessarily application-owned in the current
  headless client. The checked API can require and receipt the barrier, but it
  cannot infer which application query constitutes a complete screen snapshot.
  The sidecar acceptance uses the todo app's complete list query, making that
  ownership visible.
- Listener blocking means the most valuable journey cannot run in this
  sandbox. The test is structured to fail loudly with the exact outside command
  and writes a retained digest-bound receipt only after a real run.

## Comparison

Compared with React plus Convex or Supabase, a hosted stable endpoint avoids
the ephemeral-origin handoff entirely. Snapback's local desktop process buys
single-file custody and offline-first operation, but makes lifecycle identity
an application concern. The checked URL/nonce/store/generation receipt is more
ceremony than reconnecting to a stable hosted URL, while the durable local
SQLite ledger makes cross-process exactly-once recovery unusually direct and
inspectable.

## Honest boundary

This is pending-work-preserving stop/start. The predecessor stops before the
candidate starts, so requests have a gap. Literal zero-request-downtime would
need a stable front door or overlapping runtime ownership and is not claimed.
The managed sandbox has not executed the listener-bound success/failure matrix;
the orchestrator must run the retained acceptance command outside it before
promoting the evidence rung.
