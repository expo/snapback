---
title: Mutations
id: backend.mutations
order: 2
audience: agent-first
capabilities: [backend.query-semantics]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, llp/0108-inline-handlers-and-result-contracts.spec.md, llp/0174-authoring-incidents-at-security-fences.research.md, src/server.rs, src/result_contract.rs, schemas/mutation.output.schema.json, packages/snapback-codegen/define.mjs, demos/signal-desk/snapback/functions.mjs, demos/todo/tests/acceptance/headless.mjs]
examples: [demos/todo, demos/todo-v2, demos/signal-desk]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-05
reviewed-commit: 4a6000ac6f17a8c94bc2aecf573c0654e850b758
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

The paved JS form colocates its direct handler expression with arguments,
result contract, and possible writes:

```js source=demos/signal-desk/snapback/functions.mjs
export const createIncident = defineJsMutation({
  args: {
    title: v.string(),
    severity: v.string(),
    actorId: v.string(),
    now: v.integer(),
  },
  result: results.value(v.id('incidents')),
  writes: ['incidents', 'activity'],
  handler: async (ctx, args) => {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('incident title is required');
    if (!new Set(['SEV-1', 'SEV-2', 'SEV-3']).has(args.severity)) {
      throw new Error('invalid severity');
    }
    const incidentId = await ctx.db.insert('incidents', {
      title,
      summary: 'Investigation started. Add tasks and field notes as evidence arrives.',
      severity: args.severity,
      status: 'investigating',
      commanderId: args.actorId,
      createdAt: args.now,
      updatedAt: args.now,
    });
    await ctx.db.insert('activity', {
      incidentId,
      actorId: args.actorId,
      sourceTable: 'incidents',
      sourceId: incidentId,
      operation: 'insert',
      effectiveSubject: args.actorId,
      actualActor: args.actorId,
      actorKind: 'human',
      mutationDigest: 'explicit-js-handler.v1',
      kind: 'incident.created',
      detail: `${args.severity} incident opened`,
      createdAt: args.now,
      sortKey: args.now,
    });
    return incidentId;
  },
});
```

The handler writes only through `ctx.db`. Server-owned ids, row versions, and
storage timestamps are never authored by the handler. An inline handler
captures no imports or top-level `const` bindings; statically reachable
same-file function declarations are resolved and spliced in with it. The legacy
`{ source, exportName }` form remains compatible but cannot be mixed with
`handler`; it also reads one closed script, supports same-file helpers, and
refuses imports with `BUNDLE_UNSUPPORTED_IMPORT`. Imported helpers, third-party
packages, and multi-file graphs are not admitted by that compatibility lane.

`defineMutation` is the declarative twin: compose `insert`, `patch`,
`delete`, conditions, and a declared return binding without running a JS
handler.

Set-oriented deletion is `deleteWhere(table, filter)`. The filter argument is
required; omitting it refuses generation with
`SNAPBACK_DELETE_WHERE_FILTER_REQUIRED`. An explicitly authored empty array,
`deleteWhere(table, [])`, retains the clear-table IR and therefore means
"delete every row" deliberately. Never derive or substitute that empty array
for an absent filter.

Two transactional effects beyond `ctx.db` writes commit or roll back with the
same mutation and have their own pages: a declared `sequences` counter
allocated through `ctx.sequence.allocate`
([sequences](./sequences.md)) and durable follow-up work enqueued through
`ctx.jobs.enqueue` ([one-off durable jobs](./jobs.md)).

A mutation that declares a write to a `permissionBacking` table is generated
with `authorityCreating: true`. Authors may explicitly mark an opaque mutation
conservatively, but cannot clear a derived marker. Under the partial local
agent-auth slice this requires grant consent at admission, and the host still
enforces the exact permission-backing write dynamically.

## Consume the structured result

Successful direct mutations return one closed envelope:
`version`, `changed_count`, `result`, the server-derived
`authorityDescriptor` (persisted with the ACK proof; it grants no authority),
an optional deterministic `ctx_ledger`, nullable server-derived `attribution`
and `facts` (the active artifact generation), and the terminal `receipt`. The
todo acceptance proves the
created id, changed count, and server-owned row fields together:

```js source=demos/todo/tests/acceptance/headless.mjs
    const created = await db.mutate(api.createTodo, { args: { title: 'Buy milk' }, userId: ADA });
    assert(typeof created.result === 'string' && created.result.length > 0, 'no id returned');
    assertEqual(created.changed_count, 1, 'changed_count');
    const rows = (await db.query(api.listTodos, { userId: ADA })).rows;
```

Use `results.value(validator)` for a direct scalar/object payload or
`results.document(table)` for one complete stored document. The generated
mutation reference carries that exact logical result type. Snapback validates
the post-JSON result against the frozen effective contract before committing
writes or retaining a successful settlement. A mismatch returns
`SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION`; no write, durable version, or
successful settlement survives, and the diagnostic never echoes the rejected
value. The general result ceiling is 4 MiB, while retained mutation output
also keeps its existing 65,536-byte ceiling.

An error is a structured `SNAPBACK_*` diagnostic. A rejected queued mutation
still has a terminal receipt on the error envelope so the client store can
settle it without guessing. A confirmed receipt always carries a non-null
durable `snapshotVersion`; `null` is allowed only for a rejected invocation
whose durable cursor could not be read safely.

Application-semantic refusals get typed codes instead of message prose. A
handler declares a closed set — `refusals: ['STALE_MOVE']` (uppercase
`A-Z0-9_`, never the reserved `SNAPBACK_` prefix, at most 64 per function) —
and throws with `ctx.refuse(code, details?)`. The refusal arrives as the
platform code `SNAPBACK_APP_REFUSAL` with `appCode` and `appDetails` in its
diagnostic details; it never masks a platform denial, and a refusing mutation
commits nothing. The host admits the claimed code only when the invoked
function declared it and folds anything else — undeclared, forged, or bare —
to `SNAPBACK_HANDLER_FAILED`, dropping the app payload. Queries and actions
have the same `ctx.refuse` channel. To make a declared code issue-eligible,
opt it into `trackedRefusals` — see
[error tracking](../operating/error-tracking.md).

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

## Bound and resume bulk work

One mutation may buffer at most **1,024 writes**. The ceiling includes ordinary
`ctx.db` writes and other writes expanded into the same commit, such as
membership commands and maintained-projection effects. Attempting a 1,025th
write rejects the whole mutation with
`SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`; none of its buffered writes commit.

Snapback does not ship a separate bulk-mutation or resumable-mutation API.
Build large jobs from the ordinary bounded primitives:

1. Read a bounded page through a stable unique index and keyset cursor; see
   [safe standard patterns](./standard-patterns.md#generate-keyset-pages).
2. Send that page to one ordinary mutation, sized so its direct writes plus
   generated projection effects remain at or below 1,024.
3. In that same mutation, update an application-owned job row with the last
   completed cursor or stable key.
4. Read that checkpoint before the next page. After interruption, resume after
   the committed checkpoint rather than replaying every earlier page.

Each page is its own atomic commit; the whole multi-page job is not one
transaction. Make each page idempotent under the application's business key or
current status, and advance the checkpoint only in the commit that applied the
page. Keep batches comfortably below the ceiling when one input can expand into
multiple projection or membership writes. If the product invariant requires
more than 1,024 changes to commit all-or-nothing, redesign that invariant rather
than disguising several mutations as one transaction.

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
- **Do not send an unbounded collection to one mutation.** Page by a stable
  key, commit a bounded batch with its application checkpoint, and resume from
  the last committed checkpoint.
- **Do not infer success from HTTP status alone.** Consume the result,
  diagnostic, and terminal receipt envelope.
- **Do not omit a result contract when callers depend on the payload shape.**
  Omission deliberately generates `unknown`.
- **Do not validate a mutation result after committing.** The runtime-owned
  pre-commit validator is what makes result-contract failure atomic.
