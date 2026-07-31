---
title: Offline retention and mutation replay
id: sync.offline-and-retention
order: 1
audience: agent-first
capabilities: [sync.offline, sync.offline-js-arm]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0052-contract-update-economy-and-host-state.rfc.md, llp/0055-agent-principals-and-scoped-grants.rfc.md, llp/0129-local-first-program.plan.md, packages/snapback-contract/index.mjs, packages/snapback-contract/offline-replay.test.mjs, packages/snapback-client/index.mjs, packages/snapback-client/outbox-store.test.mjs]
examples: [demos/card-game, demos/todo-v2/surfaces/contract, demos/public-dashboard, packages/snapback-contract/agent-authority-contract.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-31
reviewed-commit: 8299c6ddb1c9019c08a72545c8e74998aeb2b5f5
---

# Offline retention and mutation replay

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The Contract adapter can retain the last authoritative query snapshot, render
derived optimistic changes while offline, and replay a durable mutation outbox
in order after reconnect. It reports this as `Parity` only when every
required proof is present; otherwise the surface stays honestly `Online`.

## The JS/React arm: default persistence and the offline queue

Since LLP 0129 Phase 0, `@expo/snapback-client` (and the LLP 0114 React hooks
riding it) persists its cache **by default**: the client resolves an
IndexedDB store in browsers, a durable file store on node, and an in-memory
fallback elsewhere, reporting the resolved implementation and durability on
`client.rqsStoreInfo` (pass `rqsStore: null` or set
`SNAPBACK_CLIENT_RQS_STORE=off` to opt out). What that buys, each proven by
`demos/public-dashboard/tests/acceptance/offline-local-first.mjs`:

- **Cold-boot retained render for the rqsEligible subset.** A relaunch —
  including with the backend unreachable — renders the persisted rows of
  authority-independent live queries first, marked
  `freshness: 'retained'`, then settles to `'current'` on reconnect
  (LLP 0090 Channel B). Protected/auth-scoped and opaque queries are NOT
  retainable on this arm: the handle's `retention` fact names the refusal
  (`SNAPBACK_RETENTION_NOT_RETAINABLE`,
  `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE`) instead of silently acting
  local-first — LLP 0053's retainability invariant is the boundary, and
  lease-bounded protected retention remains the Contract arm's.
- **A durable LLP 0043 M2 outbox.** A mutation refused by connectivity is
  queued durably under a client-minted `clientMutationId` (protocol-lane
  identity) with a monotonic local sequence, and returns
  `{ queued: true, clientMutationId, sequence }`.
- **Ordered exactly-once replay.** After reconnect completes a fresh
  authoritative snapshot (full resync first — LLP 0008 §Mutation Replay),
  the client drains the queue in sequence order; the server's settlement
  ledger returns the original result on duplicate delivery, and a refused
  replay is dropped and marked failed, visible in `outboxRecords()`.
- **No `Parity` claim.** This arm runs no local execution, so the queued
  path is Online-class retention/replay under LLP 0043's proof rule; a
  relaunch with pending intent renders nothing ahead of the full resync
  (LLP 0090's outbox rule).

```js source=packages/snapback-client/outbox-store.test.mjs
  // Offline: fetch refuses at the transport (TypeError, like undici).
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  assert.equal(queued.queued, true);
```

```js source=packages/snapback-client/outbox-store.test.mjs
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [queued.clientMutationId, queuedUpdate.clientMutationId],
    'replay is ordered by sequence and keeps the minted durable identity',
  );
```

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

For `AgentAuthorityFence`, the durable authority key is a canonical SHA-256
identity over the actor, credential id and generation, and grant id. Token id,
bearer bytes, and carrier generation are deliberately excluded: rotating a
token for that same tuple can replay its existing queue, while changing any
durable tuple coordinate advances the authority epoch and deletes predecessor
work. Every replay still resolves and validates a current scoped token before
the server acts. Agent authority does not enable retained service-principal
reads in v1.

Production CLI and daemon replay requires both a durable Contract
`clientStore` and a filesystem-backed `AgentAuthorityFence`; the in-memory
custody adapter is test-only. Construct the Contract surface before manually
synchronizing the fence. Surface construction registers the physical store as
a barrier participant before it performs the strict server handshake, so a
restart that finds an interrupted `clearing` transition replays that store's
epoch-bound deletion before custody can settle. Reversing that order can leave
predecessor queue data outside the recovered authority barrier and is refused
by the supported construction path.

The surface re-synchronizes durable custody before client-store reads,
retained publication, enqueue/acknowledgement, and final replay dispatch. A
missed process-local or BroadcastChannel wakeup therefore cannot expose or
settle predecessor rows and queued writes under a peer successor. The visible
surface blanks at the authority cut; durable predecessor work remains owned by
the barrier until its exact deletion/transition settles rather than being
silently acknowledged or discarded.

Terminal replay is explicit, not inferred from a null browser principal scope
(Agent successors also have no browser principal scope). An exact-current
nonterminal Agent successor preserves its already-committed store bytes. An
exact-current terminal replay verifies or reapplies deletion. If terminal B
finds that shared primary custody now belongs to A, Snapback leaves A's primary
row and any A-keyed local store untouched, but purges and unbinds a local store
still keyed to B so stale retained/queued B data cannot survive behind the
terminal witness.

Client-store write generations do not wrap. The maximum safe integer is
reserved for the terminal privacy cut; an already-exhausted bound store exposes
no retained or queued data even if durable replacement fails. A clean marker at
that final identity can be replayed without another write, but requires explicit
store replacement before any successor bind.

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

## Migration boundaries: quarantine, don't fail

A schema publication can refuse a replay with one of two stable codes, and
neither is a mutation failure — the surface quarantines the write instead of
settling it `failed`, and exposes the state for rendering via
`surface.migrationBoundary()` (`null` in normal operation):

- `SNAPBACK_MIGRATION_RESYNC_REQUIRED` — the record's read baseline predates
  a successor-only publication and its row changed. The record stays
  pending; the next `reconnect()` resyncs first, re-presents the **same**
  `clientMutationId` with baselines refreshed from the successor snapshot,
  and the server settles it exactly once.
- `SNAPBACK_MIGRATION_UPGRADE_REQUIRED` — this client's artifacts predate a
  successor-only publication. The state is stable for the lifetime of the
  artifact-bound surface: the queue stays intact, nothing retries blindly,
  and the app can render "update required".

```js source=packages/snapback-contract/migration-quarantine.test.mjs
  // Quarantine, not failure: the record is still pending, nothing entered
  // the failed ledger, and the boundary state is app-renderable.
  assert.equal(surface.pendingCount(), 1);
  assert.deepEqual(await surface.failedMutations(), []);
  const boundary = surface.migrationBoundary();
  assert.equal(boundary?.kind, 'resync-required');
  assert.equal(boundary?.code, 'SNAPBACK_MIGRATION_RESYNC_REQUIRED');
```

Across the artifact upgrade itself, payload custody follows the client
store's privacy boundary: a write authored under predecessor artifacts is
never blindly replayed under successor artifacts — the successor surface
receives an explicit redacted `SNAPBACK_CLIENT_ARTIFACT_STALE` entry in
`failedMutations()` (identity preserved, args discarded) for the app to
re-enter, while the server keeps the refused `clientMutationId` fresh.

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
- **Do not key an agent outbox by token id.** Tokens are live carriers; the
  server-issued descriptor and durable grant tuple own replay identity.
