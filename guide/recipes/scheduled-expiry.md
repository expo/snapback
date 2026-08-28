---
title: "Recipe: scheduled expiry and status flips"
id: recipes.scheduled-expiry
order: 17
audience: agent-first
capabilities: [backend.cron, realtime.live-queries]
authorities: [llp/0028-cron-scheduled-execution.rfc.md, llp/0070-durable-background-work.rfc.md, llp/0045-notifications-outbox.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-admin-client/index.mjs, tests/fixtures/guide-scheduled-expiry/schema.mjs, tests/fixtures/guide-scheduled-expiry/functions.mjs, tests/fixtures/guide-scheduled-expiry/seed.json, demos/all-aboard/tests/acceptance/cron.mjs, scripts/verify-local-proof]
examples: [tests/fixtures/guide-scheduled-expiry]
status: current
targets: [local]
maturity: shipped
authoring-profiles: [explicit]
reviewed: 2026-08-28
reviewed-authorities-digest: sha256:c9190e6d136b287428fd95cd9ef99e0a4c29c3930676a84f33aa37df57ce28ca
---

# Recipe: scheduled expiry and status flips

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use this pattern to **expire stale rows**, **flip a link to expired**, or build
the selection half of **send a daily digest**:

1. a recurring cron declaration names an action;
2. the scheduler invokes that action with system authority;
3. the action calls one bounded, idempotent mutation; and
4. the mutation's ordinary commit delivers the status change to live queries.

There is no privileged `expireStaleRows` helper. The schema, time predicate,
scan ceiling, retry behavior, and authority boundary remain visible in
application code.

## Store the deadline and index the sweep predicate

Store the deadline as integer milliseconds. Put `status` and `expiresAt` in
one index so already-expired rows are excluded before the scan ceiling is
applied. The second index gives the example's live query a deterministic order:

```js source=tests/fixtures/guide-scheduled-expiry/schema.mjs
import {
  defineSchema,
  defineTable,
  v,
} from '@expo/snapback-codegen/define';

export default defineSchema({
  links: defineTable({
    slug: v.string(),
    status: v.string(),
    expiresAt: v.integer(),
    expiredAt: v.optional(v.integer()),
  })
    .visibility({ kind: 'public-read' })
    .index('by_status_and_expires_at', ['status', 'expiresAt'])
    .index('by_expires_at', ['expiresAt'])
    .sync(),
});
```

The fixture is public only to keep the recipe focused. Preserve the product's
real owner or membership visibility when the rows are protected; cron's system
authority does not justify widening reads.

## Make one bounded, idempotent mutation

Sample `ctx.runtime.now()` once. Select only active rows whose stored deadline
is due, take the three-row write ceiling plus one look-ahead row, and patch no
more than three rows:

```js source=tests/fixtures/guide-scheduled-expiry/functions.mjs
// @ref LLP 0028#execution-the-action-class — Keep each scheduled write in one
// bounded mutation so commit, invalidation, and live delivery stay atomic.
export const expireDueLinks = defineJsMutation({
  args: {},
  result: results.value(sweepResult),
  auth: 'public',
  reads: ['links'],
  writes: ['links'],
  handler: async (ctx) => {
    const sweepLimit = 3;
    const nowMs = ctx.runtime.now();
    const candidates = await ctx.db.query('links')
      .withIndex('by_status_and_expires_at')
      .eq('status', 'active')
      .lte('expiresAt', nowMs)
      .order('expiresAt', 'asc')
      .take(sweepLimit + 1)
      .collect();
    const batch = candidates.slice(0, sweepLimit);

    for (const link of batch) {
      await ctx.db.patch('links', link._id, {
        status: 'expired',
        expiredAt: nowMs,
      });
    }

    return {
      nowMs,
      examined: candidates.length,
      changed: batch.length,
      hasMore: candidates.length > sweepLimit,
    };
  },
});
```

The exact ceilings are four examined rows and three writes per invocation.
`hasMore` makes backlog visible without an unbounded drain loop. Choose a
production limit from the target's mutation budget and expected arrival rate;
keep it a literal application decision.

The `status === 'active'` predicate is the idempotency fence. A retry never
rewrites an already-expired row, so it does not move `expiredAt`, create a new
commit, or send a duplicate live update. If expiry also creates another durable
fact, give that fact a unique application key such as
`link-expired:<link-id>:<expiresAt>` and check or upsert it in this same
mutation.

## Put recurrence and system authority in the cron action

The action performs no database work itself. Cron accepts actions that do not
require a user principal, then invokes them as the system; the nested mutation
inherits that authority. A browser does not mint or pass a privileged identity.

```js source=tests/fixtures/guide-scheduled-expiry/functions.mjs
export const runExpirySweep = defineAction({
  args: {},
  result: results.value(sweepResult),
  auth: 'public',
  handler: async (ctx) => ctx.runMutation('expireDueLinks', {}),
});

export const expiryCron = defineCron({
  expireLinks: {
    // This product promises a sweep at each exact minute boundary. Omit
    // jitter:false unless the cadence is itself a product requirement.
    schedule: { everyMs: 60_000, jitter: false },
    action: 'runExpirySweep',
    overlapPolicy: 'NoOverlap',
    retryPolicy: { mode: 'NextTick' },
  },
});
```

`NoOverlap` skips a new claim while the previous run is still in flight.
`NextTick` is the shipped retry policy: a failed slot is not retried in a tight
loop; the next scheduled run safely encounters the still-active rows. Cron is
at-least-once, so the mutation must remain idempotent even with both policies.
Backoff retry is not a shipped cron mode.

This example disables jitter only because its stated product contract is an
exact minute boundary. In the ordinary sweep, leave jitter enabled to spread
wakeups. Jitter never changes the correctness rule below.

## Keep request-time expiry checks authoritative

A sweep materializes a convenient status projection; it does not make the
deadline occur. Between `expiresAt` and the next successful sweep, a row can be
logically expired while its stored `status` is still `active`.

Every correctness-sensitive operation—redeem link, authorize download, accept
invite—must therefore perform a request-time expiry check using one sampled
server clock: refuse when `ctx.runtime.now() >= row.expiresAt`, regardless of
the stored status. A client may use the deadline for display, but client time is
not an authorization input. The sweep remains valuable because it gives
ordinary queries a stable stored status and causes a live update after commit.

## Test the scheduler, bound, retry, and live delivery without sleeping

Start with `cronDisabled: true`, subscribe over the stream transport, and call
the authenticated admin test tick. The fixture places four deadlines far in
the past and one far in the future, so the assertion does not race wall time.
The handler samples one runtime clock; the test tick claims the current nominal
slot without waiting for the minute cadence.

The executable acceptance checks that codegen admits a userless cron action,
pins `NoOverlap` and `NextTick`, then exercises the scheduled path:

```js source=demos/all-aboard/tests/acceptance/cron.mjs
  let firstRun = null;
  await suite.check('manual test tick uses nominal time and enforces the scan ceiling', async () => {
    const runs = await expiryAdmin.tickCron();
    firstRun = runs.find(({ jobName }) => jobName === 'expireLinks');
    assert(firstRun, 'manual tick claimed expireLinks');
    assertEqual(firstRun.outcome, 'Succeeded', 'scheduled action succeeded');
    assertEqual(firstRun.trigger, 'Scheduled', 'test tick used the scheduled path');
    assertEqual(firstRun.result.changed, 3, 'one mutation changed at most the three-row ceiling');
    assertEqual(firstRun.result.examined, 4, 'one look-ahead row proves more bounded work remains');
    assertEqual(firstRun.result.hasMore, true, 'the action reports another bounded batch');
    assert(
      firstRun.result.nowMs >= firstRun.dueAtMs
        && firstRun.result.nowMs - firstRun.dueAtMs < 60_000,
      'handler sampled one runtime clock within the claimed one-minute slot',
    );
  });

  await suite.check('the scheduled commit is delivered to the live subscription', async () => {
    await recorder.waitFor(
      (rows) => rows.filter(({ status }) => status === 'expired').length === 4,
      'live expiry status update',
    );
    assertEqual(
      expiryLive.rows.filter(({ status }) => status === 'expired').length,
      4,
      'three newly expired rows join the pre-expired row',
    );
    assert(
      recorder.updates.some(({ kind, rows }) => (
        kind !== null && rows.filter(({ status }) => status === 'expired').length === 4
      )),
      'the subscribed stream delivered the changed projection',
    );
  });

  await suite.check('run-now simulates the next scheduled bounded batch', async () => {
    const retry = await expiryAdmin.runCronJob('expireLinks');
    assertEqual(retry.outcome, 'Succeeded', 'manual continuation succeeds');
    assertEqual(retry.result.changed, 1, 'continuation changes only the remaining due row');
    assertEqual(retry.result.hasMore, false, 'continuation catches the projection up');
  });

  await suite.check('repeating a caught-up sweep is idempotent', async () => {
    const before = await expiryDb.query('linksByExpiry', {});
    const repeated = await expiryAdmin.runCronJob('expireLinks');
    const after = await expiryDb.query('linksByExpiry', {});
    assertEqual(repeated.outcome, 'Succeeded', 'repeat succeeds');
    assertEqual(repeated.result.changed, 0, 'repeat changes no rows');
    assertEqual(repeated.result.hasMore, false, 'repeat finds no queued batch');
    assertEqual(after.rows, before.rows, 'stored projection is unchanged');
  });
```

There is no scheduler sleep and no live-query poll in this expiry path. The
admin tick returns only after the scheduled action finishes; the stream
recorder waits for the separately delivered subscribed projection.

## Recurring sweep, one-off job, or request-time check?

Use recurring cron when many rows can become due, deadlines may change, or a
bounded reconciliation backstop is useful. The source declaration owns the
cadence, and each run finds due work through the index.

Use [one-off durable jobs](../backend/jobs.md) when a mutation knows one future
deadline at write time. Enqueue the declared action transactionally with
`ctx.jobs.enqueue`, pass a stable idempotency key such as
`expire-link:<link-id>:<expiresAt>`, and let the action call the same style of
idempotent mutation. One-off jobs have their own durable ledger and injected-
clock test drain; they are not runtime-created cron entries. They remain an
experimental local capability under LLP 0070.

Use the request-time expiry check in either design. Cron and one-off jobs are
at-least-once and may run after a deadline; they materialize state and trigger
live delivery, but they cannot be the security boundary at the instant of
expiry.

## Daily digest variant: select first, deliver separately

For **send a daily digest**, keep the recurring job's durable mutation about
selection, not network delivery. At a declared day boundary, scan an indexed
recipient/due range under an explicit ceiling and materialize `digestIntents`
with a unique key such as `<local-date>:<recipient-id>`. Repeating the selection
then finds or upserts the same intents. Record the selected row IDs or a stable
snapshot in each intent so a later delivery attempt does not silently select a
different digest.

Delivery is a separate action. For an in-app digest, clients can subscribe to
the durable intent rows. For external delivery, an app can enqueue a bounded
one-off action per intent and integrate its own provider with a stable provider
idempotency key. Row selection and delivery settlement must not be treated as
one successful fact.

Snapback does **not** currently ship generic production email or SMS delivery
adapters. LLP 0045's general notification outbox remains a draft design, so
this recipe claims only durable selection/materialization plus the separately
documented, target-limited action and one-off-job seams. Do not describe an
intent row as delivered until an actual app-owned adapter records settlement.
