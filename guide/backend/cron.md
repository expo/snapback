---
title: Scheduled execution with cron
id: backend.cron
order: 4
audience: agent-first
capabilities: [backend.cron]
authorities: [llp/0028-cron-scheduled-execution.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/cron.mjs]
examples: [demos/all-aboard]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: d4fcfaf706ca9f307271d91b7a376c18774c630f
---

# Scheduled execution with cron

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Cron jobs are generated manifest entries that ask the target scheduler to run
an **action**. The action may perform I/O and calls mutations for durable
effects, so scheduled writes use the same atomic commit and live-delivery path
as user-triggered work.

## Define the job

All Aboard declares one demand-gated interval:

```js source=demos/all-aboard/snapback/functions.mjs
export const caltrainCron = defineCron({
  warmPoll: {
    // jitter:false because the 180s cadence is a fixed product interval for a
    // single demand-gated app; no thundering-herd concern (LLP 0028 §Jitter).
    schedule: { everyMs: 180_000, jitter: false },
    action: 'refreshFeed',
    activation: { kind: 'WhileLive', whileLive: ['liveTrainStatus'] },
  },
});
```

The complete authoring inventory for each job:

- `schedule`: exactly one of `everyMs` (local floor 1,000 ms) or a
  five-field `cron` expression;
- `action`: the name of a declared action; authenticated-only actions are
  rejected because the scheduler runs with system authority;
- `enabled`: defaults to `true`;
- `activation`: always (default) or `whileLive` over named live queries;
- `jitter` / `jitterMaxMs`: jitter defaults on; opt out only for a
  product-fixed cadence with no herd concern;
- `overlapPolicy`: defaults to `NoOverlap`;
- `retryPolicy`: defaults to `{ mode: 'NextTick' }`.

Codegen validates job names, schedules, action existence/kind, and the
auth-requirement boundary before the server loads the manifest.

## Gate polling on real demand

`whileLive` keeps a polling job inactive when nobody subscribes to the
declared query. The first subscription arms it; the last disconnect makes it
inactive again:

```js source=demos/all-aboard/tests/acceptance/cron.mjs
  // Subscribing to the declared live query arms the job (whileLive activation).
  const live = await db.liveQuery('liveTrainStatus', { connectionId: 'cron-rider' });
  const versionBefore = live.version;
```

This is how a scale-to-zero app avoids paying for upstream polling while idle.
The target owns the wakeup mechanism; the action/mutation behavior stays
portable.

## Test deterministically

`POST /_snapback/api/cron/tick` is an AdminWrite test/operations seam. The
kit's `cronTick()` sends the admin credential, recomputes activation, and
runs due work. Do not wait for wall-clock cadence in acceptance tests.

The acceptance asserts the whole path—tick → action → mutation → live update:

```js source=demos/all-aboard/tests/acceptance/cron.mjs
  await suite.check('scheduler run: action -> mutation -> live delta', async () => {
    const rows = await live.poll();
    assert(live.version > versionBefore, `durable version advanced (${versionBefore} -> ${live.version})`);
    const limited = rows.find((r) => r.patternId === 'sb-limited');
```

`GET /inspect` exposes registered jobs, activation state, next/last timing,
and the bounded recent-run ledger. Assert the job and a successful run so a
vacuous tick cannot pass.

## Anti-patterns

- **Do not schedule a mutation directly.** Cron targets actions; the action
  calls a mutation for durable effects.
- **Do not sleep in tests.** Force an authenticated tick and inspect its run
  ledger.
- **Do not poll while nobody can observe the result.** Use `whileLive` for
  warm-poll products that should scale to zero.
- **Do not disable jitter casually.** Fixed no-jitter schedules need an
  explicit product reason.
