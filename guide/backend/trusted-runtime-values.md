---
title: Trusted runtime time and identifiers
id: backend.runtime-values
order: 24
audience: agent-first
capabilities: [backend.runtime-values]
authorities: [llp/0051-language-neutral-data-tier.rfc.md, llp/0065-generated-data-pattern-soundness.rfc.md, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-codegen/index.mjs]
examples: [demos/competitive-checkpoint/snapback/handlers.mjs, demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-26
reviewed-commit: HEAD
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
is not a principal and does not manufacture a table foreign key.

For owner-scoped generated CRUD, declare the same policy as
`createDefaults: { createdAt: 'now', pageKey: 'id' }` instead of writing a
handler. The [safe standard patterns](./standard-patterns.md) page covers that
narrow helper profile.

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
value.

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

Snapback does not currently provide a general schema-migration or backfill
workflow. For disposable local data, reset and reseed after changing the
schema. If preserved data must be reshaped or backfilled, treat that as an
application-specific migration with its own authorization and acceptance
plan; this guide makes no hosted rollout or zero-downtime migration claim.

## Anti-patterns

- Do not put `createdAt`, `updatedAt`, or generated IDs in public arguments
  when the server is their authority.
- Do not substitute `Date.now()`, `new Date()`, or `Math.random()` inside a
  handler.
- Do not reuse one `ctx.runtime.id()` result for distinct logical records.
- Do not type a runtime-generated string as a principal or foreign key.
- Do not infer a supported migration workflow from the runtime-value APIs.
