# Default offline queue double-applies mutations on Cloudflare

**Opened:** 2026-08-12 · **Severity:** P1 (correctness; duplicate writes) · **Area:** client / offline / Cloudflare

## What

`SnapbackClient.mutate()` defaults to `queue: 'auto'` (`packages/snapback-client/index.mjs:8343-8346`). On a connectivity/timeout failure it durably enqueues and later `replayQueuedMutations()` re-POSTs the **same** `clientMutationId`, with the comment that “the server's settlement ledger returns the original result on a duplicate.”

Local SQLite has that ledger (`_snapback_client_mutations`). Cloudflare `kitMutation` does not:

```4926:4948:cloudflare/src/coordinator.js
  // the id is minted per invocation (hosted has no
  // client-mutation replay ledger, so clientMutationId is never echoed),
  ...
      mutationId: `mut_${crypto.randomUUID().replaceAll('-', '')}`,
```

The CF capability manifest lists `offline_mutation_replay` as a gap. The JS client never reads that gap before queueing. Default store is on (IndexedDB / `~/.snapback/rqs`).

## Why it matters

Timeout after a successful CF commit (or any ambiguous transport loss) replays as a second real write. `addNote`, `applyFeedTick`, `applyLiveFeedSnapshot`, etc. duplicate.

## Fix

Client must refuse `queue: 'auto'` / outbox drain unless the target advertises a mutation ledger (inspect/capability). Until then, treat CF as `queue: false`. Longer term, implement the hosted client-mutation ledger.

## Confidence

High. Hosted “no ledger” is documented as a shape/capability gap (`issues/closed/20260808-guide-gap-mutation-settlement-identity.md`), not as this client double-apply bug.

## Resolution (2026-08-12)

Added the closed `offline_mutation_replay` target capability, backed only by
the registered atomic client-mutation settlement ledger. Local SQLite-derived
profiles advertise it through `/inspect`; the Cloudflare target keeps its
existing gap. `SnapbackClient` now requires that positive advertisement before
durable enqueue or drain. Default `queue: 'auto'` degrades to fail-loud
`queue: false` behavior when the fact is absent/unavailable, while explicit
`queue: true` and replay refuse with the typed
`SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED` error. An existing queue is
left unchanged and the automatic drain gates before custody reconciliation or
its freshness barrier.

Coverage exercises ledger-less auto queueing, explicit queue refusal, direct
replay refusal, and the ledger-advertising local payload shape retaining
enqueue/replay behavior. The final affected-suite command reported verbatim:
`tests 128`, `pass 128`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`.
