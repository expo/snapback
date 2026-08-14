---
title: Compose generated data transactions
id: data.transactions
order: 30
audience: agent-first
capabilities: [data.transactions-v1]
authorities: [llp/0255-tiny-data-surface-v1-api.spec.md, llp/0043-offline-replay-retention.rfc.md, llp/0133-local-settlement.spec.md, llp/0218-outbox-settlement-contract.rfc.md, packages/snapback-codegen/data-transaction.mjs, packages/snapback-client/data-client.mjs, packages/snapback-client/index.mjs, src/storage/settlement.rs, src/local.rs]
examples: [packages/snapback-codegen/data-transaction.test.mjs, packages/snapback-client/data-client.test.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
unreleased: true
reviewed: 2026-08-14
reviewed-authorities-digest: sha256:f06376ae32dc1b30918d0a2fbde52c9440a9809edf86437e9429d1645dbcc1e7
---

# Compose generated data transactions

> **Unreleased.** Generated data transactions and their headless contributor
> client are newer than the newest published closure, 0.1.20. Use contributor
> source until a later closure publishes the Phase 4 package doorway.

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use **db.tx** to construct inert, exactly typed write chunks and pass all of
them to one **db.transact(...)** call. Constructing a chunk does no I/O and
paints no optimistic state. Dispatch begins only when the complete, statically
catalogued transaction is admitted.

    const handle = db.transact(
      db.tx.todos.create({ title: "Ship Phase 3" }),
      db.tx.todos.update({ id: todoId, title: "Shipped" }),
    );

    const dispatch = await handle.dispatched;
    const settlement = await handle.settled;

The grammar admits 1–16 ordered create, update, and delete chunks emitted for
generated data resources. Arguments must satisfy each chunk's exact generated
contract. Chunk order, resource, operation, and result shape are static;
runtime values fill only generated argument slots. A shape absent from
**semanticInput.dataSurface.transactionCatalog** is refused rather than
compiled dynamically.

One chunk uses that generated mutation's ordinary function reference. Two or
more chunks resolve to one ordinary **data.tx_<16hex>** mutation. Its HostPlan
sequences all writes in one SQLite commit, renames intermediate bindings and
arguments by position, performs post-write reads, and returns a closed
**{ c0, c1, ... }** record that the client projects to the positional result
tuple. There is one optimistic layer and one authoritative settlement: partial
server writes and partial client paint are not states of this API.

## Custody and prediction are separate

Every transaction declares one custody class at generation:

- **queue-eligible** enters durable replay custody and may dispatch later.
- **online-only** is durably recorded but never enters replay ordering. Before
  transport its boundary is **not-crossed**; immediately before the request it
  atomically becomes **possibly-crossed**.

Callers cannot override this with queue, and the data doorway strips operation
issuance. Every data write requires a durable client store and a target
advertising **offline_mutation_replay**.
**SNAPBACK_DATA_CUSTODY_UNAVAILABLE** distinguishes the next action: configure
or repair the durable store, or choose a target with the settlement ledger
capability.

After a connectivity loss, a possibly-crossed intent reports:

    {
      "status": "pending",
      "blockedReason": "outcome-unknown"
    }

It is never redelivered. **refreshSettlement()** polls the server's bounded
settlement ledger using the original intentId (which is byte-for-byte the
clientMutationId). Both a commit and a server refusal become durable,
ACK-capable terminal rows. A crash before the boundary proves non-acceptance.

Generated-exact prediction may be available for either custody class. All
chunks compose or the entire prediction is withheld; reconciliation uses the
settlement mint claims and then rebases later layers. Prediction being
unavailable does not weaken custody, and online-only custody does not forbid
an exact local prediction.

## Observe and recover

**DataTransactionHandleV1** keeps independent presentation, custody, dispatch,
settlement, and observation axes. subscribe is notify-only: read the current
value with snapshot(). dispose() stops observation but never cancels durable
custody. **db.transaction(intentId)** recovers the same lifecycle from the
canonical mutation-status owner after reload.

**DataQueryStateV1.pendingWrites** is a payload-free intersection between the
query materialization's tables and unresolved transaction reach. Entries
contain only intentId, state, and presentation, ordered first by durable outbox
sequence and then by intent id. Arguments and row values are never projected.

## Refusals and ceilings

| Code | Next action |
| --- | --- |
| SNAPBACK_DATA_TRANSACTION_INVALID | Restore generated chunks, exact contracts, binding identity, or the closed composition grammar. |
| SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED | Make the whole ordered shape static and regenerate, or use a named mutation. |
| SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED | Reduce the first reported dimension: chunks, resources, reads/writes, descriptor/result/durable bytes, or generated HostPlan size/steps. |
| SNAPBACK_DATA_CUSTODY_UNAVAILABLE | Follow the diagnostic's split next action for local durable storage or target settlement capability. |

The public @expo/snapback and framework-specific doorways are Phase 4.
Relationship nodes, retained queries, and dynamic transaction shapes remain
outside this surface.
