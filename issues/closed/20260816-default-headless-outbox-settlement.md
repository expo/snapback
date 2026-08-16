# Give headless clients a default outbox-drain lifecycle

**Status:** Closed (2026-08-16)
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

## Resolution

OQ2 is resolved as **readiness-anchored**. A qualified durable outbox installs
its client-owned controller in the microtask after construction and inline boot
binding settle, then retains that ownership through `close()`. This avoids
constructor re-entrancy and prevents a restored-work scan from racing the
client's own boot metadata installation, while still scanning restored intent
without an application call. A synchronous explicit `startOutboxDrain()` made
before that cut is joined rather than duplicated.

The constructor policy is `outboxDrain: 'auto' | 'manual'`, defaulting to
`'auto'`; boolean `false` is rejected at runtime and by TypeScript so headless
and React use one vocabulary. Manual mode installs the same controller and
changes scheduling only. Its policy/effective mode remain observable through
`client.outboxDrainPolicy`, `outboxStatus().drainMode`, and queued diagnostics.

Within one realm, clients sharing the same store object lease one WeakMap-keyed
controller. The earliest active automatic participant owns transport; if none
is automatic, the earliest active manual participant owns it. Closing that
client stops and settles its engine before deterministically transferring to
the next participant, which establishes a fresh barrier. Distinct store
handles over one durable domain continue to use the store's writer lock, so
only the durable writer can replay.

---

**Closed 2026-08-16.** Implemented and landed via the LLP 0270 wave-1
orchestration: default readiness-anchored drain lifecycle with
`outboxDrain: 'manual'` typed opt-out, realm-local single-owner coordination,
close() teardown fencing, and React provider policy inheritance. Dual-family
code review (codex + grok, xhigh) ran three rounds: round 1 caught a
foreground double-replay race, a lost-wake stall, a fence-pause with no
custody wake edge (permanent silent stop on ordinary fenced clients), and a
React provider default that defeated the constructor opt-out; round 2 caught
the latched-wake-lost-on-pause residual; round 3 verified converged READY.
All settle/teardown/ownership acceptance cases have regression tests
(outbox-drain 20/20, client suite green outside sandbox, inventory 299).
The react package full-suite pretest red (prepare-type-fixtures.mjs, node 25)
is inherited — reproduced byte-identical at pristine base.
