# Give headless clients a default outbox-drain lifecycle

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Headless client, Offline outbox, Lifecycle, Settlement
**Date:** 2026-08-16
**Governing:** LLP 0218 §4.3, LLP 0270
**Related:** LLP 0043, LLP 0053, LLP 0129, LLP 0155;
`issues/20260815-local-first-defaults-audit.md`

## Problem

Headless queueing is already default-capable: `SnapbackClient` uses
`offlineQueue: 'auto'`, `mutate()` uses `queue: 'auto'`, and a qualified
durable store records connectivity failures
(`packages/snapback-client/index.mjs`). Settlement is not default. A host must
call `client.startOutboxDrain()` once per client/store lifecycle and stop the
returned controller (`guide/clients/headless.md`). React owns that lifecycle
for the application; a plain headless client does not.

This means an ordinary headless client can durably accept work that remains
pending after connectivity returns unless the host knows about an additional
controller opt-in.

## What default means

A headless client with automatic queueing, a qualified durable writer store,
and a target settlement ledger should own one automatic drain controller from
client readiness until `client.close()` (or an equivalent explicit lifecycle
end). It should scan restored work at start, wake on connectivity/readiness,
writer, and custody changes, and preserve LLP 0218's barriers and capped
backoff.

The opt-out should be an explicit constructor policy such as
`outboxDrain: 'manual'`/`false`, aligned with React vocabulary. Manual hosts
must retain `drainNow()`/`replayQueuedMutations()` control and diagnostics.
Multiple clients sharing a store must still have one effective lifecycle
owner.

## Consequence classification

**Semantic consequences — not SAFE as a wiring-only flip.** Starting the
controller creates background timers/listeners and network dispatch, and it
causes previously queued mutations to settle without a host's explicit start
call. Resource teardown, process/worker lifetime, test determinism, authority
transitions, and multi-client store ownership need a deliberate compatibility
cut under LLP 0270 and LLP 0218.

## Acceptance

- An ordinary headless client automatically settles restored and newly
  queued work after connectivity returns.
- `close()` stops timers/listeners and no replay occurs after teardown.
- Manual mode is explicit, typed, observable, and does not disable the safety
  barriers around a requested drain.
- Two clients sharing a writer store do not produce concurrent replay owners;
  authority replacement, quarantine, strand, and result-gone cases retain LLP
  0218 semantics.
