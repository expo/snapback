---
title: Mutations
id: backend.mutations
order: 2
audience: agent-first
capabilities: [backend.query-semantics]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, src/server.rs, schemas/mutation.output.schema.json, demos/todo/snapback/functions.mjs, demos/todo/snapback/handlers.mjs, demos/todo/tests/acceptance/headless.mjs]
examples: [demos/todo, demos/todo-v2]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-26
reviewed-commit: HEAD
---

# Mutations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A mutation makes snapshot-atomic logical reads, buffers writes, validates its
captured dependencies, and commits once. It does not hold one SQLite read
transaction across arbitrary asynchronous handler work; commit-time OCC rejects
relevant drift between reads. Every row changed by the commit receives the
same monotonic version. A rejected mutation commits nothing.

## Define the write boundary

The JS form declares arguments, handler source, and its possible writes:

```js source=demos/todo/snapback/functions.mjs
export const createTodo = defineJsMutation({
  args: { title: v.string() },
  source: 'handlers.mjs',
  exportName: 'createTodo',
  writes: ['todos'],
});
```

The handler writes only through `ctx.db`. Server-owned ids, timestamps, and
row versions are not arguments and are never authored by the handler:

```js source=demos/todo/snapback/handlers.mjs
    return await ctx.db.insert('todos', {
      title,
      completed: false,
      userId: ctx.auth.userId,
    });
```

`defineMutation` is the declarative twin: compose `insert`, `patch`,
`delete`, conditions, and a declared return binding without running a JS
handler.

A mutation that declares a write to a `permissionBacking` table is generated
with `authorityCreating: true`. Authors may explicitly mark an opaque mutation
conservatively, but cannot clear a derived marker. Under the partial local
agent-auth slice this requires grant consent at admission, and the host still
enforces the exact permission-backing write dynamically.

## Consume the structured result

Successful direct mutations return one closed envelope:
`version`, `changed_count`, `result`, an optional deterministic
`ctx_ledger`, and the terminal `receipt`. The todo acceptance proves the
created id, changed count, and server-owned row fields together:

```js source=demos/todo/tests/acceptance/headless.mjs
    const created = await db.mutate(api.createTodo, { args: { title: 'Buy milk' }, userId: ADA });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no id returned');
    assertEqual(created.changed_count, 1, 'changed_count');
    const rows = (await db.query(api.listTodos, { userId: ADA })).rows;
```

An error is a structured `SNAPBACK_*` diagnostic. A rejected queued mutation
still has a terminal receipt on the error envelope so the client store can
settle it without guessing. A confirmed receipt always carries a non-null
durable `snapshotVersion`; `null` is allowed only for a rejected invocation
whose durable cursor could not be read safely.

## Preserve invariants with read sets

JS mutation reads are captured by the server. Declarative host-plan mutations
that depend on an earlier client observation carry that explicit
`readSet`. At commit, Snapback validates the exact row or predicate
dependencies. If a concurrent writer changed a dependency, the whole mutation
is rejected as `SNAPBACK_MUTATION_CONFLICT`:

```js source=demos/todo/tests/acceptance/headless.mjs
    const err = await assertThrows(
      () => db.mutate(api.setCompleted, {
        args: { id, completed: false },
        userId: ADA,
        readSet: [{ table: 'todos', id, version: observed }],
      }),
      'SNAPBACK_MUTATION_CONFLICT',
      'expected conflict',
    );
```

Treat that diagnostic as an invariant failure to reconcile, not as permission
to force a last-writer-wins commit. Predicate-shaped captured reads are
validated at predicate granularity, so unrelated writes do not spuriously
conflict.

Authorization-protected writes have one additional pre-transaction conflict:
`SNAPBACK_AUTH_RESERVATION_STALE`. It is HTTP 409 with
`details.retryable: true`, `details.effectCommitted: false`, and
`details.retryStrategy: "short-jitter"`. The standard JavaScript and Swift
clients recognize only that exact closed refusal and retry the complete write
within a bounded short-jitter budget. They do not retry a missing fact, a
different status, an ambiguous outcome, or anything that may have committed.
Every retry remains pinned to the first attempt's exact authority/carrier
generation; logout, user switch, or credential replacement fails the operation
stale instead of replaying predecessor intent as the successor.
Do not add an application retry loop, treat it as backend downtime, or use
service-style exponential backoff.

The JavaScript client defaults to 40 total attempts with 20–80 ms jitter.
Configure `reservationRetryMaxAttempts` (use `1` to disable retries) and
`reservationRetryJitterMilliseconds: [minimum, maximum]` at construction.
Inspect `reservationRetryDiagnostics()` or provide
`onReservationRetryDiagnostic` to retain scheduled, settled, and exhausted
attempt evidence without changing mutation settlement.

Tests for an authorization rule must assert the intended denial code
(`SNAPBACK_AUTH_PERMISSION_DENIED`, for example), not merely that the write
failed. A stale reservation is contention, not evidence that the rule ran.

## Declare structural uniqueness

For one-row-per-key application invariants, declare a true unique index instead
of scanning in the handler:

```js source=demos/shindig/snapback/schema.mjs
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .sync(),
```

Unique indexes may be compound. Every key field must be required in v1 so the
constraint is total across SQLite and Postgres. Duplicate inserts that reach
the serialized write boundary race at the constraint: exactly one wins, every
loser commits nothing and receives `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`. A
larger mutation may still fail earlier at an authorization or stale-reservation
boundary, also without committing. Snapback does not currently ship `upsert`;
keep duplicate-as-error flows as inserts and handle the unique diagnostic.

## One commit, one version

All affected rows share the mutation's `version`; no-op writes do not advance
it. Durable live delivery is produced from the committed write set, so clients
never observe a partial mutation. The version is a logical ordering within one
app database, not a wall-clock timestamp. It is an exact integer in
`0..=Number.MAX_SAFE_INTEGER`. The maximum commit is usable, but an operation
that needs its successor fails before writing with
`SNAPBACK_STORAGE_VERSION_EXHAUSTED`; never round or synthesize a cursor.

## Anti-patterns

- **Do not implement read-then-write invariants as two unrelated requests.**
  Read inside the JS mutation or carry the explicit host-plan baseline.
- **Do not scan to emulate a unique compound key.** Declare a unique index;
  read sets are conflict detection, not a substitute for structural uniqueness.
- **Do not swallow `SNAPBACK_MUTATION_CONFLICT`.** Reconcile or ask the user;
  blind retry may violate the invariant that caused the read.
- **Do not count `SNAPBACK_AUTH_RESERVATION_STALE` as an authorization-rule
  denial.** Let the standard client retry the exact effect-free refusal, then
  assert the rule's exact code.
- **Do not set `_id`, `_version`, `_createdAt`, or `_updatedAt`.**
  They are server-owned.
- **Do not infer success from HTTP status alone.** Consume the result,
  diagnostic, and terminal receipt envelope.
