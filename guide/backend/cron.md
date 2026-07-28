---
title: Scheduled execution with cron
id: backend.cron
order: 4
audience: agent-first
capabilities: [backend.cron]
authorities: [llp/0028-cron-scheduled-execution.rfc.md, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/cron.mjs, demos/_kit/server-process.mjs]
examples: [demos/all-aboard]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 8a6bbd1ec980a49010aa67269ee908433a257c9a
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

The public `GET /inspect` projection exposes aggregate cron posture only.
Per-job activation, next/last timing, diagnostics, and the bounded recent-run
ledger may contain handler-controlled values and therefore live on the
admin-gated `GET /_snapback/api/inspect` twin. In a headless suite, construct
`AdminClient` with the returned server token, or use
`openHeadlessApp(...).admin.inspect()`. Assert the job and a successful run so
a vacuous tick cannot pass.

## Run with the scheduler inert

To keep autonomous cron runs out of a test or dev session entirely, start
the server with the scheduler disabled:

```sh
SNAPBACK_CRON_DISABLED=1 snapback   # or: snapback --cron-disabled
```

The switch accepts `1` or `true`; any other value leaves the scheduler on,
so a typo cannot silently disarm production crons. Definitions still load,
validate, and appear in `/inspect` with their ordinary armed/inactive
state — only autonomous claiming stops. `POST /_snapback/api/cron/tick`
keeps working, so a suite drives every tick itself. From an acceptance
suite, pass the kit option instead of hand-building the environment:
`startServer({ ..., cronDisabled: true })` sets `SNAPBACK_CRON_DISABLED=1`
on the child (and refuses to reuse an already-running server, whose
scheduler may be live). See
[LLP 0028 §Scheduler state and run ledger](repo:llp/0028-cron-scheduled-execution.rfc.md).

**The first tick can look early.** `everyMs` schedules anchor their nominal
grid at Unix epoch 0, so an armed job's first evaluation usually finds a
past-due nominal and fires one catch-up run — up to one full interval after
boot, regardless of when your subscription armed it. A 180 s job observed
firing ~180 s after boot "before anything subscribed" is this anchor, not a
bug ([LLP 0028 §Inspection and query
surface](repo:llp/0028-cron-scheduled-execution.rfc.md), ENG-22604). If
that mid-suite run would perturb your assertions, disable the scheduler as
above and tick manually.

Definition generations and run sequences are exact JavaScript-safe integer
identities. The maximum value is usable once; a successor fails before taking
ownership with `SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED` or
`SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED`. An out-of-range persisted counter is
`SNAPBACK_CRON_STATE_INVALID`, never an implicit reset. Treat these as terminal
operator diagnostics for that scheduler state rather than retrying the job.
Scheduled-batch staging is atomic: exhaustion in any job publishes none of the
batch's claims. Inspect's consecutive-failure count saturates at the same
portable maximum instead of wrapping.

## Anti-patterns

- **Do not schedule a mutation directly.** Cron targets actions; the action
  calls a mutation for durable effects.
- **Do not sleep in tests.** Force an authenticated tick and inspect its run
  ledger; start the suite's server with `cronDisabled: true` so the live
  scheduler cannot commit a competing run mid-assertion.
- **Do not poll while nobody can observe the result.** Use `whileLive` for
  warm-poll products that should scale to zero.
- **Do not disable jitter casually.** Fixed no-jitter schedules need an
  explicit product reason.
