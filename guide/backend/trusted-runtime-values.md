---
title: Trusted runtime time and identifiers
id: backend.runtime-values
order: 24
audience: agent-first
capabilities: [backend.runtime-values, backend.mutation-settlement-identity]
authorities: [llp/0043-offline-replay-retention.rfc.md, llp/0051-language-neutral-data-tier.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-codegen/index.mjs, tests/mutation_settlement_identity_v0.rs]
examples: [demos/competitive-checkpoint/snapback/handlers.mjs, demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6919f120fbdc6b257e5c339ef8cdf9bd4ff8d32c498a0befc1c762967f765f26
---

# Trusted runtime time and identifiers

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

When a JavaScript handler needs a creation/update time or a fresh opaque
identifier, derive it inside the handler. Do not accept it from a client and
do not call ambient `Date` or `Math.random`.

## Stamp a write inside the handler

Use `ctx.runtime.now()` for an integer Unix timestamp in milliseconds. The
value is frozen for the invocation, so store one result in a local when several
writes describe the same event. Use `ctx.runtime.id()` for a fresh string on
each call:

```js source=demos/competitive-checkpoint/snapback/handlers.mjs
  const now = ctx.runtime.now();
  const attemptId = ctx.runtime.id();
  await ctx.db.insert('messages', {
    ownerId: ctx.auth.userId,
    conversationId: args.conversationId,
    role: 'user',
    content: args.content,
    status: 'complete',
    attemptId: ctx.runtime.id(),
    idempotencyKey: 'user:' + args.idempotencyKey,
    sequence: 0,
    lastProgressAt: now,
    pageKey: ctx.runtime.id(),
  });
```

The host records these answers and reuses them if it replays the invocation.
That is why ambient clock and randomness APIs are not interchangeable with the
context methods. An `id()` result belongs in a plain required string field; it
is not a principal and does not manufacture a table foreign key. Neither value
yields a dense per-scope ordinal (JOB-42): `id()` is opaque and `now()` is not
gap-free. That is the [scoped sequences](./sequences.md) surface — an
experimental, contributor-local-only publication (`sequence_allocation_v1` on
contributor-source builds of the local target since 2026-08-04); public
runtime packages and hosted targets retain a structured GAP. Do not hand-roll
it from these values either.

For owner-scoped generated CRUD, declare the same policy as
`createDefaults: { createdAt: 'now', pageKey: 'id' }` instead of writing a
handler. The [safe standard patterns](./standard-patterns.md) page covers that
narrow helper profile.

<!-- since: 0.1.15 -->

## Keep effect identity stable across mutation re-entry

`ctx.runtime.id()` is fresh identity for one handler entry. It is not an
effect-deduplication key: a mutation that throws before settlement may
genuinely re-enter and receive another runtime id. When retries must write one
durable effect intent with one provider idempotency key, use the mutation's
replay-stable `settlementId` instead. The complete mutation-only recipe is
[derive a replay-stable effect key](./mutations.md#derive-a-replay-stable-effect-key).

## Keep generated fields out of operation arguments

Declare only client-authored values in a mutation's `args`. The generated
operation schema is closed, while trusted fields such as `attemptId`,
`lastProgressAt`, and `pageKey` are absent:

```json source=demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json
{
  "$id": "https://schemas.snapback.dev/apps/competitive-checkpoint/startReply.args.schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "content": {
      "type": "string"
    },
    "conversationId": {
      "type": "string"
    },
    "idempotencyKey": {
      "type": "string"
    }
  },
  "required": [
    "conversationId",
    "content",
    "idempotencyKey"
  ],
  "title": "competitive-checkpoint:startReply arguments",
  "type": "object"
}
```

A caller that tries to supply an omitted timestamp or identifier is therefore
rejected as an additional property instead of silently overriding the server
value. Official generated clients check the same closed projection before
transport and report `SNAPBACK_ARGUMENT_VALIDATION_FAILED`; the server's own
validation remains authoritative either way.

## Repair ambient dependency diagnostics

- `BUNDLE_UNSUPPORTED_TIME` for `Date.now()` or `new Date()` means: call
  `ctx.runtime.now()` and keep the stored field an integer millisecond value.
- `BUNDLE_UNSUPPORTED_RANDOM` for `Math.random()` means: use
  `ctx.runtime.id()` only when the intent is a fresh identifier. For other
  values, pass an explicit deterministic input; Snapback does not expose a
  general randomness primitive.
- `BUNDLE_UNSUPPORTED_TIMER` means an ambient timer is not valid in that
  handler profile. `ctx.runtime.now()` supplies a timestamp, not a delay or
  scheduler.

The diagnostic message includes this page's path. Assert on its stable code,
not its repair prose; see [diagnostics](../operating/diagnostics.md).

## Move a client-authored field to the runtime

For future writes, replace the handler's use of `args.createdAt` or
`args.generatedId` with the appropriate context call, then remove that field
from the operation's `args`. Regenerate the operation schemas and update
callers together: the closed schema deliberately rejects an old client that
continues sending the removed property. Existing stored values can remain;
the trust boundary changes at the write path.

For disposable local data, reset and reseed after changing the schema. When
preserved local data must be reshaped or backfilled, use the reviewed
`snapback migrate` loop — [reviewed migrations](./migrations.md) — rather
than an ad-hoc script; this guide makes no hosted rollout or zero-downtime
migration claim.

## Anti-patterns

- Do not put `createdAt`, `updatedAt`, or generated IDs in public arguments
  when the server is their authority.
- Do not substitute `Date.now()`, `new Date()`, or `Math.random()` inside a
  handler.
- Do not reuse one `ctx.runtime.id()` result for distinct logical records.
- Do not use `ctx.runtime.id()` as a replay-stable effect or provider
  idempotency key.
- Do not type a runtime-generated string as a principal or foreign key.
- Do not infer a supported migration workflow from the runtime-value APIs.
