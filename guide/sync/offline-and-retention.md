---
title: Offline retention and mutation replay
id: sync.offline-and-retention
order: 1
audience: agent-first
capabilities: [sync.offline]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, packages/snapback-contract/index.mjs, packages/snapback-contract/offline-replay.test.mjs]
examples: [demos/card-game, demos/todo-v2/surfaces/contract]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: 1af150e0a1acffb372b7ac64fe32b61f1bf64db2
---

# Offline retention and mutation replay

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The Contract adapter can retain the last authoritative query snapshot, render
derived optimistic changes while offline, and replay a durable mutation outbox
in order after reconnect. It reports this as `Parity` only when every
required proof is present; otherwise the surface stays honestly `Online`.

## Enable the complete client-store contract

Pass a durable `clientStore` (localStorage on web; memory only for tests) and
a complete retained identity: app id, database id, target-profile id, and
version-stream id. The generated Contract data manifest must claim
`offlineReplay`, and every mutation exposed by the surface must have a
derivable declarative plan.

If any identity or replay proof is missing, queued writes and retention are
disabled instead of being rebound to a guessed backend. A changed artifact or
authority scope quarantines/deletes the old privacy-bearing state before the
new scope can inspect it.

## Boot from retained rows honestly

An online boot publishes and stores the authoritative snapshot. If a later
boot cannot reach the same backend, the adapter may publish those retained
rows with `retained() === true` and connection `'stale'`:

```js source=packages/snapback-contract/offline-replay.test.mjs
// New store + new adapter instance models an app reload. The live request
// fails, retained rows boot stale, and the durable create overlay re-applies.
const secondStore = createMemorySnapbackClientStore({ state: sharedState });
const second = await makeSurface(secondStore);
assert.equal(second.retained(), true);
assert.equal(second.connection(), 'stale');
assert.equal(second.boundary.current('todos')[0]._id, todoId);
```

A first run with no retained snapshot fails with the original network error.
Retained data is never relabeled `live`.

For sessions-mode private rows, ordinary retention is insufficient. The server
must issue an authorized lease and the store must delete rows exactly at its
deadline. That stricter subset is taught in
[hidden hands](../recipes/hidden-hands.md).

## Queue one deterministic mutation identity

Before an offline optimistic change becomes visible, the store durably
allocates:

- an opaque `clientMutationId`;
- a monotonic local sequence (ordering never comes from wall-clock time);
- the function and canonical arguments;
- the authority/artifact scope;
- one deterministic `ctxLedger` containing generated time/id answers.

The derived optimistic overlay consumes the **same** ledger, so a replayed
insert uses the id the UI already rendered. If durable enqueue fails, the
optimistic change is rolled back before any server contact.

The test queues create → toggle → delete and proves durable ordering:

```js source=packages/snapback-contract/offline-replay.test.mjs
const queued = await secondStore.pendingMutations();
assert.deepEqual(queued.map((entry) => entry.function), [
  'createTodo',
  'setCompleted',
  'deleteTodo',
]);
assert.deepEqual(queued.map((entry) => entry.sequence), [1, 2, 3]);
```

## Replay and settle without guessing

Reconnect delivers records in sequence with the original mutation id, ledger,
and authority descriptor. The server settles that id atomically with the data
commit. If a response is lost after commit, redelivery returns the stored
result rather than applying the mutation twice:

```js source=packages/snapback-contract/offline-replay.test.mjs
const replay = await second.reconnect();
assert.deepEqual(replay, { replayed: 3, failed: 0 });
assert.deepEqual(client.state.applied, ['createTodo', 'setCompleted', 'deleteTodo']);
assert.deepEqual(client.state.rows, []);
assert.equal(second.pendingCount(), 0);
```

The client retains a successful/rejected settlement until the server proves it
received the acknowledgement. A Snapback-origin terminal receipt proves the
origin saw the request and any piggyback acknowledgements. A receipt-less
proxy/network failure proves neither, so both records remain durable for the
next reconnect.

## Derive, then reconcile optimistic rows

Declarative mutation plans produce the local overlay; avoid a second handwritten
reducer. Server rows remain authoritative:

- success reconciles the optimistic wave with the committed result;
- a structured rejection removes/rebases the prediction and exposes the
  diagnostic;
- a connectivity ambiguity keeps the durable record and marks the surface
  stale;
- an artifact or authority change clears/quarantines old rows and writes before
  publishing the successor scope.

## Anti-patterns

- **Do not call a surface Parity because it has localStorage.** The manifest,
  identities, derivable plans, store, and authority fences must all agree.
- **Do not generate a fresh id or timestamp on replay.** Reuse the captured
  mutation id and deterministic ledger.
- **Do not drop a queued write on a receipt-less 502.** The origin outcome is
  ambiguous.
- **Do not serve retained rows as live.** Render the stale connection axis.
- **Do not cache authorized rows outside the lease-aware store.** Use the
  authorized-retention path or keep the surface online-only.
