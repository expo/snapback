---
title: "Recipe: time-windowed live reads"
id: recipes.time-windowed-live-reads
order: 14
audience: agent-first
capabilities: [realtime.live-queries, auth.sessions]
authorities: [llp/0053-authorization-invalidation.rfc.md, packages/snapback-codegen/guide-time-windowed-live-reads.test.mjs, tests/fixtures/guide-time-windowed-live-reads/schema.mjs, tests/fixtures/guide-time-windowed-live-reads/functions.mjs, tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs]
examples: [tests/fixtures/guide-time-windowed-live-reads]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-26
reviewed-authorities-digest: sha256:6bfc3ac33d1e7ee1a1051a9ec16fa99109947a76c2c5c183476596234dcd252d
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
the row time remains a captured database fact:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
import {
  defineJsLiveQuery,
  defineJsMutation,
  results,
  v,
} from '@expo/snapback-codegen/define';

export const eventsVisibleAtPinnedClock = defineJsLiveQuery({
  args: { clockMs: v.integer(), windowMs: v.integer() },
  result: results.documents('events'),
  auth: 'authenticated',
  reads: ['events'],
  handler: async (ctx, args) => {
    const cutoffMs = args.clockMs - args.windowMs;
    const rows = await ctx.db.query('events').take(1_024).collect();
    return rows.filter((row) => (
      row.createdAt >= cutoffMs && row.createdAt <= args.clockMs
    ));
  },
});
```

Stamp `createdAt` on the server when the row is written. A mutation or action
may sample `ctx.runtime.now()` because that time becomes durable data rather
than a mutable input to protected live visibility:

```js source=tests/fixtures/guide-time-windowed-live-reads/functions.mjs
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
export async function openTimeWindow(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, windowMs: HOUR_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}
```

This result is current for database changes relative to the pinned `clockMs`;
it is not current relative to the advancing wall clock. Rows do not age out
merely because time passes, because no database commit invalidates the query.
Re-issue with a fresh clock when product freshness requires it: route focus,
pull-to-refresh, an explicit refresh control, or an application-owned coarse
boundary such as the next minute or five-minute bucket. Dispose the predecessor
handle before installing the fresh generation:

```js source=tests/fixtures/guide-time-windowed-live-reads/time-windowed-live-reads.mjs
export async function refreshTimeWindow(current, client, reference, connectionId) {
  await current.handle.dispose();
  return openTimeWindow(client, reference, connectionId);
}
```

Choose the refresh cadence from the product promise, not from live-query push:
“last hour, refreshed on focus” can remain pinned for a screen visit; an
“expires in under a minute” view needs a boundary refresh near that minute.
This recipe does not provide a trusted clock, autonomous expiry, or generated
time buckets. Those remain a primitive-design question.

## Anti-patterns

- Do not call `ctx.runtime.now()`, `Date.now()`, or `new Date()` inside an
  authenticated live query whose result visibility depends on the value.
- Do not omit the generated `clockMs`/`windowMs` argument contract and pass an
  unchecked bag to the handler.
- Do not claim that live push advances the pinned clock or ages rows out when
  no database commit occurs.
- Do not refresh every render. Choose a product boundary, dispose the old
  handle, and open one successor generation with a fresh clock.
