---
title: "Recipe: time-windowed live reads"
id: recipes.time-windowed-live-reads
order: 14
audience: agent-first
capabilities: [realtime.live-queries, auth.sessions]
authorities: [llp/0053-authorization-invalidation.rfc.md, llp/0264-table-write-policy.spec.md, packages/snapback-codegen/guide-time-windowed-live-reads.test.mjs, tests/fixtures/guide-time-windowed-live-reads/schema.mjs, tests/fixtures/guide-time-windowed-live-reads/functions.mjs, tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs]
examples: [tests/fixtures/guide-time-windowed-live-reads]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-27
reviewed-authorities-digest: sha256:8f5a52c9b4ca52eb46cf6827a6685be9b8444cecc4b5bd9e07cb5b1c961454cf
---

# Recipe: time-windowed live reads

<!-- diagnostic-primary: SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY -->

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Authenticated live queries cannot make visibility depend on an ambient clock.
Calling `ctx.runtime.now()` in one produces
`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`. The refusal protects deterministic
reruns and authorization invalidation; do not weaken it or replace it with
`Date.now()` inside the handler.

Use a load-pinned client clock argument and server-authored row timestamps.
The clock becomes an immutable input to one subscription generation, while
the row time remains a captured database fact. The client clock controls only
which already-authorized rows the product wants to display; it is not trusted
for authorization, billing, or a security deadline.

## Declare stored times and ordinary integer clock arguments

Store event creation times and lease deadlines as integer milliseconds. Keep
the table's real authorization boundary — owner visibility in this focused
fixture, or the app's membership policy — independent of the client clock:

```js source=tests/fixtures/guide-time-windowed-live-reads/schema.mjs
import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

export default defineSchema({
  events: defineTable({
    ownerId: v.principal(),
    label: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_and_created_at', ['ownerId', 'createdAt'])
    .sync(),
  typingLeases: defineTable({
    ownerId: v.principal(),
    typerLabel: v.string(),
    expiresAt: v.integer(),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_and_expires_at', ['ownerId', 'expiresAt'])
    .index('by_owner_and_typer', ['ownerId', 'typerLabel'], { unique: true })
    .sync(),
});
```

The generated function argument contract uses an ordinary `v.integer()` for
`clockMs` and another product input such as `windowMs` or `soonWithinMs`.
Snapback does not yet provide a trusted or quantized clock argument type, so
validate or fix the product interval server-side if callers must not choose it.
The composite indexes bind the server-derived owner first and the stored time
second, so each read can scan its owner's exact time range instead of sampling
the table.

## Read “trending in the last hour”

Subtract the window from the pinned argument inside the protected live query:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

// @ref LLP 0053#the-authorization-event-universe-closed — Protected reads pin
// clock input; mutations materialize server time as database facts.
// @ref LLP 0004#ctxdb-contract — Window predicates belong in an indexed query
// range, before collection, so an unrelated prefix cannot hide matches.
export const eventsVisibleAtPinnedClock = defineJsLiveQuery({
  args: { clockMs: v.integer(), windowMs: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const cutoffMs = args.clockMs - args.windowMs;
    return ctx.db.query('events')
      .withIndex('by_owner_and_created_at')
      .eq('ownerId', ctx.auth.userId)
      .gte('createdAt', cutoffMs)
      .lte('createdAt', args.clockMs)
      .collect();
  },
});
```

The lower and upper event boundaries are inclusive: `createdAt >= cutoffMs`
and `createdAt <= clockMs`. This range scan returns the complete matching
window regardless of how many older or future rows the table contains. It has
no result-size cap that can silently change the window. If the matching range
itself reaches Snapback's 1,024-row implicit collection ceiling, the invocation
refuses with `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` instead of returning a
truncated result; narrow or page that product surface explicitly.

Do not fetch `.take(1_024)` from the table and filter the timestamps afterward.
That fetch is only an arbitrary natural- or index-order prefix. Once the table
grows, qualifying rows can sit beyond the prefix — recent insertion-ordered
events commonly do — and the handler will silently return an incomplete or
empty window.

Stamp `createdAt` on the server when the row is written. A mutation or action
may sample `ctx.runtime.now()` because that time becomes durable data rather
than a mutable input to protected live visibility:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
// @ref LLP 0264#d3-owner-inserts-are-host-stamped — The owner policy derives
// ownerId from ctx.auth; accepting or supplying an owner value is forbidden.
export const insertServerTimedEvent = defineJsMutation({
  args: { label: v.string() },
  result: results.value(v.id('events')),
  auth: 'authenticated',
  reads: [],
  writes: ['events'],
  handler: async (ctx, args) => ctx.db.insert('events', {
    label: args.label,
    createdAt: ctx.runtime.now(),
  }),
});
```

Pin the clock once when loading the view and pass it as an ordinary generated
argument. Use stream transport for push updates caused by database commits:

```js source=tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs
export async function openTrendingWindow(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, windowMs: HOUR_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}
```

## Read typing leases that are expiring soon

For an ordinary typing indicator, prefer [ephemeral activity
presence](../realtime/ephemeral-state.md#stop-publishing-when-activity-goes-idle):
it already owns heartbeat, withdrawal, and TTL behavior. Use a durable
protected live read when lease rows must participate in another query, such as
a protected view of leases that are still live but expire within the next
minute.

The read compares a server-authored lease deadline (`expiresAt`) with the
subscription's pinned `clockMs`. The clock and “soon” horizon are both explicit
generated arguments:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
export const typingLeasesExpiringSoon = defineJsLiveQuery({
  args: { clockMs: v.integer(), soonWithinMs: v.integer() },
  result: results.documents('typingLeases'),
  auth: 'authenticated',
  reads: ['typingLeases'],
  handler: async (ctx, args) => {
    const soonHorizonMs = args.clockMs + args.soonWithinMs;
    return ctx.db.query('typingLeases')
      .withIndex('by_owner_and_expires_at')
      .eq('ownerId', ctx.auth.userId)
      .gt('expiresAt', args.clockMs)
      .lte('expiresAt', soonHorizonMs)
      .collect();
  },
});
```

The lease's lower boundary is exclusive and its upper boundary is inclusive:
an already-expired `expiresAt === clockMs` lease is absent, while
`expiresAt === clockMs + soonWithinMs` is present. As with events, filtering
inside the owner/time index range makes total table size irrelevant and makes
an oversized matching range refuse rather than truncate.

Renew the lease through a server mutation so the deadline is a captured row
fact. Do not accept `expiresAt` itself from the client:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
// @ref LLP 0264#d3-owner-inserts-are-host-stamped — The owner policy derives
// ownerId for a new lease and the unique lookup stays inside that owner.
export const renewTypingLease = defineJsMutation({
  args: { typerLabel: v.string() },
  result: results.value(v.id('typingLeases')),
  auth: 'authenticated',
  reads: ['typingLeases'],
  writes: ['typingLeases'],
  handler: async (ctx, args) => {
    const expiresAt = ctx.runtime.now() + 5_000;
    const existing = await ctx.db.query('typingLeases')
      .withIndex('by_owner_and_typer')
      .eq('ownerId', ctx.auth.userId)
      .eq('typerLabel', args.typerLabel)
      .first();
    if (existing) {
      await ctx.db.patch('typingLeases', existing._id, { expiresAt });
      return existing._id;
    }
    return ctx.db.insert('typingLeases', {
      typerLabel: args.typerLabel,
      expiresAt,
    });
  },
});
```

The `ownerId` input is deliberately absent: the declared owner policy
host-stamps it. Supplying that field from the handler is refused. The unique
owner/typer index lets renewal extend one server-authored deadline instead of
accumulating duplicate lease rows.

Open the live generation with one sampled clock and a product-owned horizon:

```js source=tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs
export async function openExpiringSoon(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, soonWithinMs: SOON_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}
```

## Refresh when the product's clock promise expires

This result is current for database changes relative to the pinned `clockMs`;
it is not current relative to the advancing wall clock. Rows do not age out
merely because time passes, because no database commit invalidates the query.
Re-issue with a fresh clock when product freshness requires it: route focus,
pull-to-refresh, an explicit refresh control, or an application-owned coarse
boundary such as the next minute or five-minute bucket. Dispose the predecessor
handle before installing the fresh generation:

```js source=tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs
export async function refreshTimeWindow(current, openSuccessor) {
  await current.handle.dispose();
  return openSuccessor();
}
```

Choose the refresh cadence from the product promise, not from live-query push:
“last hour, refreshed on focus” can remain pinned for a screen visit; an
“expires in under a minute” view should re-issue at that minute boundary (and
on focus after backgrounding). A client timer may request the successor, but
it does not become an ambient server input. Clock skew or a dishonest client
can shift the requested display window, so never use this pattern to grant
access or extend a security lease.

This recipe does not provide a trusted clock, autonomous expiry, generated
time buckets, or a declared clock-quantization argument. Those remain a
feature-design question rather than a reason to weaken the determinism guard.

## Anti-patterns

- Do not call `ctx.runtime.now()`, `Date.now()`, or `new Date()` inside an
  authenticated live query whose result visibility depends on the value.
- Do not omit the generated `clockMs`/`windowMs` argument contract and pass an
  unchecked bag to the handler.
- Do not accept a client-authored `createdAt` or `expiresAt` when the row time
  is meant to be server-authored.
- Do not collect or `take` an arbitrary table prefix and then apply the time
  predicate in JavaScript. Range-filter through an owner/time index first.
- Do not use the client clock as an authorization boundary; preserve owner or
  membership visibility independently.
- Do not claim that live push advances the pinned clock or ages rows out when
  no database commit occurs.
- Do not refresh every render. Choose a product boundary, dispose the old
  handle, and open one successor generation with a fresh clock.
