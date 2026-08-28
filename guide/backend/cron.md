---
title: Scheduled execution with cron
id: backend.cron
order: 4
audience: agent-first
capabilities: [backend.cron]
authorities: [llp/0028-cron-scheduled-execution.rfc.md, crates/snapback-cli/src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/index.mjs, demos/all-aboard/snapback/functions.mjs, demos/all-aboard/tests/acceptance/cron.mjs, demos/_kit/server-process.mjs]
examples: [demos/all-aboard]
status: current
targets: [local]
maturity: shipped
authoring-profiles: [explicit]
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:193d82a23f9e4bda1a74ee40d7d2d3a7ddc2507cee0b29ee95e34308443e2b8a
---

# Scheduled execution with cron

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Cron jobs are generated manifest entries that ask the target scheduler to run
an **action**. The action may perform I/O and calls mutations for durable
effects, so scheduled writes use the same atomic commit and live-delivery path
as user-triggered work. Cron owns only recurring, source-declared schedules;
one-off delayed work — the `runAfter` shape a mutation enqueues at runtime —
is [one-off durable jobs](./jobs.md), a separate subsystem with a separate
ledger (LLP 0028's 2026-07-30 boundary amendment).

For the complete action → bounded mutation pattern behind “expire stale
rows,” “flip a link to expired,” and daily selection work, use the executable
[scheduled expiry and status flips recipe](../recipes/scheduled-expiry.md).

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

## Inspect declared jobs and runtime posture

Use the read-only operator projection before forcing any scheduler work:

```sh
snapback cron list --ready-file .snapback/ready.json
```

The equivalent control-MCP tool is `snapback_cron_list`; the direct HTTP
alias is AdminRead-gated `GET /_snapback/api/cron`. The response lists each
declared job's name, action, schedule, enabled/activation state, next nominal
and due time, whether work is in flight, last-run time/outcome, and consecutive
failure count. These are the same facts already held for runtime inspection,
so listing does not tick, run, or persist scheduler work.

This narrow view intentionally omits exact run IDs, handler error details and
results, jitter seeds, and recent-run payloads. Use the secret-read-gated full
`app.inspect`/admin inspect view when those details are actually required.

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
SNAPBACK_CRON_DISABLED=1 snapback start   # or: snapback start --cron-disabled
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

**The first tick can look early.** `everyMs` schedules keep their nominal
grid anchored at Unix epoch 0, and a job's first evaluation seeds the most
recent past slot — so one catch-up run fires promptly after arming,
regardless of when your subscription armed it. A 180 s job observed firing
shortly after boot "before anything subscribed" is this catch-up, not a
bug ([LLP 0028 §Inspection and query
surface](repo:llp/0028-cron-scheduled-execution.rfc.md), ENG-22604 and the
2026-08-01 a4-f4 amendment). Inside that run, `ctx.runtime.now()` is the
run's due time — since the a4-f4 amendment that is within one interval of
wall clock, so time-gated scans (`remindAt <= now`) behave on the first
tick. If the mid-suite run would perturb your assertions, disable the
scheduler as above and tick manually.

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
- **Do not emulate one-off delayed work with a cron job.** The run ledger's
  identity model rejects runtime-created entries by construction; use
  [one-off durable jobs](./jobs.md) (`ctx.jobs.enqueue`) instead.
- **Do not sleep in tests.** Force an authenticated tick and inspect its run
  ledger; start the suite's server with `cronDisabled: true` so the live
  scheduler cannot commit a competing run mid-assertion.
- **Do not poll while nobody can observe the result.** Use `whileLive` for
  warm-poll products that should scale to zero.
- **Do not disable jitter casually.** Fixed no-jitter schedules need an
  explicit product reason.
