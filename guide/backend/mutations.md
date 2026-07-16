---
title: Mutations
id: backend.mutations
order: 2
audience: agent-first
capabilities: [backend.query-semantics]
authorities: [llp/0003-local-code-hosting-and-storage-core.rfc.md, llp/0004-application-data-api.rfc.md, llp/0007-storage-portability.spec.md, schemas/mutation.output.schema.json, demos/todo/snapback/functions.mjs, demos/todo/snapback/handlers.mjs, demos/todo/tests/acceptance/headless.mjs]
examples: [demos/todo, demos/todo-v2]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: bcd438bd726db4c9781cc35494e89327e268ba94
---

# Mutations

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A mutation reads a snapshot, buffers writes, validates its dependencies, and
commits once. Every row changed by that commit receives the same monotonic
commit version. A rejected mutation commits nothing.

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
settle it without guessing.

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

## One commit, one version

All affected rows share the mutation's `version`; no-op writes do not advance
it. Durable live delivery is produced from the committed write set, so clients
never observe a partial mutation. The version is a logical ordering within one
app database, not a wall-clock timestamp.

## Anti-patterns

- **Do not implement read-then-write invariants as two unrelated requests.**
  Read inside the JS mutation or carry the explicit host-plan baseline.
- **Do not swallow `SNAPBACK_MUTATION_CONFLICT`.** Reconcile or ask the user;
  blind retry may violate the invariant that caused the read.
- **Do not set `_id`, `_version`, `_createdAt`, or `_updatedAt`.**
  They are server-owned.
- **Do not infer success from HTTP status alone.** Consume the result,
  diagnostic, and terminal receipt envelope.
