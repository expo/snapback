# LLP 0028: Cron — scheduled execution

**Type:** RFC
**Status:** Draft
**Systems:** Cron, Runtime, Realtime, Data gateway, Deployment, Security, Developer experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-30
**Revised:** 2026-07-01 (Cloudflare-friendly refinement: All Aboard now uses a 60s read-through/minute-refresh default; Cron still supports sub-minute target capabilities but no longer treats a sub-minute DO alarm as All Aboard's baseline)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0008, LLP 0009, LLP 0010, LLP 0014, LLP 0017, LLP 0027

## Summary

Cron is Snapback's scheduled-execution subsystem: server code that runs on a
schedule rather than in response to a client request. [LLP 0000](./0000-snapback.explainer.md)
names it as a v1 subsystem ("every backend platform that matures grows this"),
but it is not yet built, and [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md)
(All Aboard) is the first consumer that forces it.

This RFC proposes the contract:

- a cron **job** is source-authored — a name, a **schedule** (fixed interval or
  calendar expression), and a handler that runs as an **action**;
- an **action** is a third execution class beside query and mutation: it may
  perform outbound `fetch` (egress) and read secrets, runs *outside* the
  transactional snapshot path, and commits durable changes by **invoking
  mutations** — so scheduled work flows through the same commit →
  read/write-set validation → realtime fan-out path as any other write;
- the model is **deterministic under test** (manual tick + injected clock),
  **observable** (last/next run, duration, failures), and honest about the
  **scale-to-zero tension** that frequent polling creates;
- schedules have **jitter by default**, unless the job explicitly opts out for an
  exact-time deadline/lock, so many apps do not stampede the same external API or
  platform scheduler at once;
- the scheduler is a **target-abstraction seam**: an in-process loop locally; on
  Cloudflare a *wakeup source* (Cron Trigger or Durable Object alarm) feeding a
  durable runner that owns the ledger. Minute-compatible jobs can use static Cron
  Trigger wakeups and early-out when no work is due; sub-minute or dynamically
  armed jobs use Durable Object alarms;
- runtime state is durable enough to make at-least-once delivery, no-overlap
  defaults, recovery, and admin inspection explicit rather than hidden in a timer
  loop.

## Motivation

- [LLP 0000](./0000-snapback.explainer.md) lists Cron as a v1 subsystem and the
  reference apps need it: daily-fantasy scoring and contest locks, party
  invite/reminder notifications, and periodic data refresh.
- [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md) is the forcing function. Its
  whole product — "the next train, pushed live" — depends on a refresh action that
  can be triggered by stale read-through demand or by a minute warm-poll, writes
  `trainStatus`, and lets the realtime layer push the change. All Aboard's Phase 2
  is explicitly blocked on this RFC.
- Cron exercises a realtime shape no demo has: **server-authored data that
  changes on a schedule and fans out to clients**, distinct from client-driven
  mutations (todo) and connection-owned ephemeral state (cursors).
- The generated manifest already reserves a `cron` capability flag
  (`src/manifest.rs`), defaulting `false`. This RFC defines what fills it.

## Scope

This RFC owns:

- the cron job definition and how it is authored and compiled;
- the schedule/cadence model and its per-target granularity;
- the **action** execution class and its relationship to mutations, egress, and
  secrets;
- delivery, overlap, missed-tick, and retry semantics;
- determinism/testability, observability, and the target-abstraction seam.

It does not own:

- the runtime **sandbox / ambient-capability policy** for egress and secrets —
  that boundary is owned by [LLP 0009](./0009-code-execution-security.rfc.md);
  this RFC depends on it and the work begun in
  [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md#external-data-and-action-egress);
- the data API and mutation commit model
  ([LLP 0004](./0004-application-data-api.rfc.md),
  [LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md));
- the realtime delta path ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md));
- the Cloudflare strategy as a whole ([LLP 0014](./0014-cloudflare-strategy.rfc.md));
  cron is one of its named seams, not the strategy.

## Design

### Cron job definition

A cron job is source-authored alongside schema and functions, and compiled into
the generated manifest (filling the reserved `cron` capability). A job is a name,
a schedule, the action it runs, and whether it is enabled:

```js
defineCron({
  pollTrains: {
    schedule: { everyMs: 60_000, jitter: false }, // fixed interval, pure CF Cron-compatible
    action: 'pollCaltrain',            // an action handler (see below)
    activation: { whileLive: ['trainStatusByStation'] },
    enabled: true,
  },
  refreshSchedule: {
    schedule: { cron: '0 3 * * *' },   // calendar: nightly at 03:00
    action: 'refreshGtfs',
  },
  lockContest: {
    schedule: { cron: '0 18 * * *', jitter: false }, // exact-time deadline
    action: 'lockContest',
  },
})
```

The generated manifest entry should carry the normalized schedule, action
reference, enabled flag, activation policy, source span, required capabilities,
and the resolved overlap/retry/jitter defaults. If codegen cannot parse a
schedule, cannot find the action, or cannot express the cadence on the current
target, it must emit a structured diagnostic with a source span rather than
silently omitting the job.

### Schedule / cadence

Two forms, both supported:

- **fixed interval** (`everyMs`) — All Aboard targets a 60s freshness window;
- **calendar expression** (`cron: "0 3 * * *"`) — e.g. a nightly GTFS refresh.

Minimum granularity is a **target capability fact**, not a constant: local can run
sub-minute; Cloudflare Cron Triggers have a one-minute floor; Durable Object
alarms go finer. Apps that can accept a 60s freshness target should prefer it on
Cloudflare so the hosted wakeup can be a Cron Trigger rather than a continuously
re-armed sub-minute alarm. A job that asks for finer than the target supports must
fail with a structured diagnostic, not be silently coarsened.

### Jitter

Jitter should be part of the scheduling contract, not a hidden target behavior.
Default: **jitter is enabled** for scheduled jobs unless a job opts out with
`jitter: false`. This protects external APIs, shared Snapback infrastructure, and
serverless platforms from every app waking at the same wall-clock boundary.

The default should be deterministic, bounded jitter:

- for fixed intervals, choose a stable per-app/per-job phase offset inside the
  interval, capped by a target default such as `min(10% of interval, 60s)`;
- for calendar schedules, choose a stable offset after the nominal fire time,
  capped by a target default such as five minutes;
- for retries/backoff, apply per-attempt jitter inside the backoff window once
  retry policy exists.

Deterministic means the chosen offset is derived from stable inputs such as app
id, job name, schedule hash, and a stored jitter seed, and is visible in the run
ledger. It must not come from ambient `Math.random()` or target-specific
nondeterminism. Tests with a frozen clock can therefore assert both the nominal
time and the jittered due time.

Exact-time jobs exist: contest locks, market opens, legal deadlines, and user
visible alarms may need to fire as close to the nominal schedule as the target can
provide. Those jobs should say `jitter: false`, and the manifest/admin surface
should make the opt-out visible because it has scale/cost consequences. A target
that cannot honor exact scheduling should report a capability diagnostic rather
than pretending `jitter: false` is exact.

On target profiles where the wakeup and the actual run can differ, especially
Cloudflare Cron Triggers, jitter is implemented by the durable runner, not by
blocking inside a platform handler. A Cron Trigger may wake the Worker at the
nominal minute, but if the jittered due time is later, the runner records the due
slot and arms/retains the appropriate Durable Object alarm. The `scheduled()`
handler should hand off quickly; it should not sleep until the jittered time.

That alarm is a cost/primitive choice, not something the target should hide. A
minute-compatible job that wants to stay on the pure Cron-Trigger path may opt out
with `jitter: false`, as All Aboard does, or the target may report sub-minute
jitter as a capability gap for that profile. The runner must not silently arm a DO
alarm solely to honor default jitter while still presenting the job as
Cron-Trigger-only.

### Activation policy

Not every scheduled job should run under the same idle policy. The default is
`activation: "always"`: nightly refreshes, contest locks, reminder scans, and
other system maintenance run even when no client is connected. Frequent polling
jobs may declare a demand-gated activation policy, for example
`activation: { whileLive: ['trainStatusByStation'] }`, meaning the scheduler arms
the job only while the named live query / room / demand signal has at least one
subscriber.

The exact schema for demand signals is open, but the runtime contract is not:
demand gating must be explicit in the manifest, visible in inspect/admin, and
testable. A demand-gated job should report why it is `armed`, `inactive:no-demand`,
or `catching-up`, and its staleness policy for the first subscriber after idle.
Do not infer demand-gating from a job name or cadence alone; a 60s train refresh
and a 60s compliance monitor have different product requirements.

### Scheduler state and run ledger

Cron definitions are source-authored, but scheduler state is runtime-owned. The
runtime should materialize per-app job state in a system table or target-equivalent
store:

- `jobName`, schedule hash, enabled state, activation policy/state, jitter
  policy/seed, and target capability facts;
- `nextDueAt`, `lastRunAt`, last outcome, last error, and consecutive failure
  count;
- at most one in-flight run token per job by default;
- recent run history: `runId`, nominal scheduled time, jittered due time,
  started/finished time, trigger (`scheduled`, `manual`, `recovery`), attempt
  number, outcome, duration, and diagnostic id/details.

Claiming a due run must be atomic at the app/job boundary. Locally, that means a
brief SQLite transaction around the scheduler state row before the action starts.
On Cloudflare the claim needs Durable-Object-class single-threaded serialization:
DO storage is the clean mapping (transactional, strongly consistent), D1 a caveated
alternative via a conditional-`UPDATE … WHERE inflight = 0` CAS, and KV is ruled out
— see [Cloudflare: wakeup source vs durable runner](#cloudflare-wakeup-source-vs-durable-runner).
Multiple timers, process restarts, or duplicate alarms may wake up, but only one
runner should normally claim a given due slot; crash recovery is what makes the
public delivery contract **at-least-once**, not exactly-once. Because a DO-alarm
retry re-runs the *whole* action, the durable idempotency key must be stable
across attempts. The action context should expose an explicit
`idempotencyKey`/`slotKey`: for ordinary scheduled ticks it defaults to
`(jobName, scheduledAt)` (the nominal time); for manual runs, demand catch-ups, or
run-now controls it includes the trigger/requested-at identity when the run should
not dedupe against the scheduled slot. `runId` and `attempt` remain observability
fields only.

The source manifest remains the definition of what jobs exist. When a job is
renamed, removed, disabled, or its schedule changes, the runtime should reconcile
state explicitly and report any orphaned history or migrated next-run state in
inspect/admin output.

### Execution: the action class

This is the load-bearing decision and the through-line from
[LLP 0027](./0027-all-aboard-caltrain-demo.plan.md). Scheduled work and
demand/read-through catch-up run as an **action** — a third execution class beside
query and mutation. An action:

- may perform **egress** (`fetch`) when the target grants that capability — the
  privileged class that
  [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md#external-data-and-action-egress)
  un-denies and grants `network:fetch`; ordinary queries and mutations keep the
  full sandbox deny;
- runs **outside the transactional snapshot path** — it does not hold a read-set
  open across a network round-trip, so it cannot break the commit-time
  read/write-set validation that mutations depend on;
- performs its side effects (fetch external data), then **commits durable writes
  by invoking mutations** (`ctx.runMutation(...)`), so every write still goes
  through the normal commit → validation → `notify_live_subscriptions` realtime
  fan-out (`src/local.rs`);
- has scoped access to **secrets** (e.g. the API-key pool), never client-visible
  and never written to durable rows in the clear;
- is subject to **timeout and resource limits**, since it does I/O and may run
  long.

The shape is therefore always: *a scheduler, manual control, recovery path, or
demand/read-through trigger runs an action; the action fetches; the action calls
mutations.* This keeps the deterministic mutation/commit model intact and reuses
the realtime machinery rather than inventing a second write path.

Actions should not receive the mutation surface of `ctx.db`. If an action needs
durable state before deciding what to write, it can call a query or call a
mutation that performs the correctness-sensitive read and write atomically. Any
read that affects a durable invariant must be re-read or validated inside the
mutation that commits the write; an action-level read followed later by
`ctx.runMutation(...)` is not a transaction.

There is no action-level transaction across multiple `ctx.runMutation(...)`
calls. Each mutation commits or fails under the normal mutation contract. If an
action invokes one mutation and then later fails, the first commit remains visible
and may already have fanned out to live subscribers. The first cron guidance
  should therefore be: one durable mutation per action run when practical, and
explicit idempotency/compensation when a job needs several commits.

The action context should expose run metadata, for example `ctx.cron` or `ctx.run`
with `jobName`, `runId`, `scheduledAt` (nominal time when present), `dueAt` (after
jitter when present), `idempotencyKey`, `attempt`, and `trigger`. Exact spelling is
an API detail, but the values are part of determinism, observability, and
idempotency; tests should be able to inject them with the clock.

A sketch:

```js
// action: may fetch + read secrets; commits via mutations
export async function pollCaltrain(ctx) {
  const feed = await ctx.fetch(CALTRAIN_FEED_URL, {
    headers: { Authorization: ctx.secrets.caltrainKeyPool.next() },
  })
  const rows = mapFeedToTrainStatus(feed)
  await ctx.runMutation('applyTrainStatus', { rows })   // durable + realtime
}
```

Actions may be useful beyond cron — All Aboard's per-request walk/bike Maps call
is also naturally an action. Whether **action** is a fully general execution class
from the start or is introduced cron-scoped and generalized later is an open
question.

### Delivery, overlap, and missed ticks

- **At-least-once** delivery; jobs should be written to be idempotent, with the
  run metadata above available as the idempotency key.
- **No overlap by default**: if the previous run is still executing when the next
  tick fires, skip/coalesce rather than run concurrently — overlapping polls waste
  external API quota and can race. Overlap policy is configurable per job.
- **Missed ticks** after downtime: run **once** on recovery; do not backfill every
  missed interval. A poller wants latest state, not a replay of stale polls. A
  calendar job may opt into "run if missed."

### Failure and retry

- A failed run is **recorded, never silently dropped** (a direct Valet lesson —
  [LLP 0000](./0000-snapback.explainer.md#lessons-from-valet) bars silent drops).
- Default for pollers: **skip and try the next tick** rather than retry
  aggressively — the next poll is already coming. Jobs that need it can opt into
  retry with backoff.
- Repeated failures surface as diagnostics and observability, not just log lines.
- **On Cloudflare, backoff retry is a primitive capability, not a free knob:**
  Durable Object alarms auto-retry a throwing handler with exponential backoff and
  Queues retry, but bare Cron Triggers do **not** retry (a failed `scheduled()`
  just waits for the next scheduled time). Selecting retry on a calendar job
  therefore forces it off the Cron-Trigger path onto a DO alarm or Queue — reported
  as a capability fact (see
  [Cloudflare: wakeup source vs durable runner](#cloudflare-wakeup-source-vs-durable-runner)).

### Determinism and testability

Critical, because All Aboard's acceptance is a frozen-clock determinism check.

- The scheduler must be **test-drivable**: a "run now / advance" path so a test can
  tick a job without waiting wall-clock. This is an admin/test capability, not a
  client-visible API.
- The clock is **injected** — the runtime already threads `now_ms` (`src/runtime.rs`
  exposes `runtime.now`) rather than letting handlers read an ambient wall clock.
  A frozen clock + seed + manual tick must produce identical durable writes. This
  is the agent-DX/acceptance bar from
  [LLP 0010](./0010-agent-dx-and-acceptance.spec.md). This frozen-clock guarantee is
  a **local/Ibex capability**: Cloudflare has no native frozen clock for
  `scheduled()`/alarm handlers, so the CF profile reports determinism as a
  capability gap (or relies on a Snapback-injected clock shim) rather than
  inheriting the bar for free.

### Observability

Per job, the system should expose: last run time, duration, outcome, next
scheduled run, recent run history, and last error. Surfaced in the admin console
([LLP 0017](./0017-admin-console-inspection-surface.rfc.md)) and as machine-readable
diagnostics/inspect ([LLP 0010](./0010-agent-dx-and-acceptance.spec.md)).
Agent-first: an agent should be able to see whether a cron job is healthy and why
a run failed, without scraping logs.

### Inspection and query surface

Yes: the design should make cron jobs queryable through the same headless
inspection surfaces Snapback already uses for schema, functions, capabilities, and
runtime state.

There are two distinct views:

- **Definition view:** generated artifacts / `capabilityManifest` list the jobs
  declared in source: job name, action reference, normalized schedule, jitter
  policy, enabled flag, overlap/retry policy, required capabilities, source span,
  and target compatibility diagnostics.
- **Runtime view:** `runtimeState` / `app.inspect` / `/_snapback/api/inspect`
  expose scheduler state: job name, enabled state, activation state, next nominal
  scheduled time, next jittered due time, whether a run is in flight, current run
  id, last run, last outcome, consecutive failure count, last error diagnostic,
  and recent run history.

The admin console can render those same facts as a Cron surface. CLI/MCP/host-ops
should not need a separate private API; `snapback inspect` / `app.inspect` should
return the same structured cron block. Later, token-gated admin/test operations
can add `run now`, `advance/tick`, `enable/disable`, and `clear run history`
controls, but read-only job/status inspection should be available as soon as cron
lands.

### Security and isolation

Cron actions are **privileged** — they hold egress and secrets — so they are
central to the sandbox and tenant-isolation model owned by
[LLP 0009](./0009-code-execution-security.rfc.md):

- in hosted/multi-tenant deployments, one tenant's cron must not exhaust shared
  resources: per-tenant concurrency caps and run-time limits;
- egress from cron actions is subject to the destination-allowlist story, with
  the coarse-vs-per-host gap recorded in
  [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md#external-data-and-action-egress)
  (Ibex enforces only a coarse `network:fetch` today);
- secrets are scoped to the action context and must never reach clients or
  durable rows in the clear.

### Multi-target deployment (the scheduler seam)

The scheduler is a target-abstraction seam — one of the seams
[LLP 0014](./0014-cloudflare-strategy.rfc.md) is charged with identifying
("scheduler/alarm behavior"):

- **Local (Ibex + SQLite):** the Rust server owns an in-process scheduler — a
  coarse timer beside the existing fast housekeeping tick in `src/server.rs` — and
  drives action execution in process. This is the reference target.
- **Always-on VMs** (Hetzner, Fly, droplets): same in-process model.
- **Cloudflare:** a *wakeup source* (Cron Trigger or Durable Object alarm) feeds a
  Durable Object *runner* that owns the ledger, claim, and no-overlap. The
  cadence→primitive rule, configured Cron-Trigger limits, the ledger/claim
  store, retry behavior, and CPU limits are detailed in
  [Cloudflare: wakeup source vs durable runner](#cloudflare-wakeup-source-vs-durable-runner)
  just below. A target profile must report a capability gap when no supported
  primitive matches the requested cadence/ownership.
- **Missing scheduler capability:** report an explicit gap; never silently no-op a
  scheduled job.

### Cloudflare: wakeup source vs durable runner

On Cloudflare the local in-process loop inverts — the platform wakes you — so the
viable design separates a **wakeup source** from a **durable runner**, and the
runner is always a Durable Object (the only CF primitive that gives single-threaded
serialization plus transactional storage for the ledger, claim, and no-overlap
guarantees). A Cron Trigger is only a wakeup, never a complete job.

Cadence → wakeup primitive:

| Schedule | Wakeup | Why |
|---|---|---|
| Calendar `cron:` strings, and whole-minute intervals expressible as a 5-field cron | **Cron Trigger** | CF Cron Triggers take standard cron expressions; minimum granularity **1 minute**, no sub-minute. `cron: "0 3 * * *"` extracts into `[triggers] crons` verbatim. |
| Minute-compatible demand-gated jobs that can tolerate a static wakeup | **Cron Trigger + runner demand check** | The trigger fires every minute, then the runner checks demand/cache age and early-outs if no work is due. This is cheap and avoids keeping a sub-minute alarm armed, but it is not zero invocations while deployed. |
| Sub-minute intervals, and ≥1-min intervals not cron-expressible (e.g. `everyMs: 90_000`) | **DO alarm** | Only DO alarms go sub-minute and preserve *interval-since-last-run*; a Cron Trigger fires on wall-clock minute boundaries, which is not `everyMs` fixed-delay semantics. |
| Dynamically armed jobs, or demand-gated jobs that must have zero idle wakeups | **DO alarm** | Cron Triggers are deploy-time static (`wrangler.toml`); only alarms arm/cancel at runtime. |

Consequences the local model doesn't surface:

- **A Cron Trigger is a stateless wakeup, and configured triggers are scarce.**
  Cloudflare documents low Cron Trigger limits, with current docs splitting the
  language between "up to three Cron Triggers configured at once" and account-level
  limits (Free/Paid). Treat the exact number as a target capability fact to verify
  at implementation, not as a design constant. A `scheduled()` Worker runs once,
  globally, with no durable state. So multiple calendar jobs should consolidate
  behind a small dispatcher set that hands off to the runner DO; the ledger, claim,
  and no-overlap always live in the DO, never in the trigger.
- **The ledger/claim store must be strongly consistent.** DO storage is the clean
  mapping (single-threaded + transactional — the atomic claim is free). D1 can
  approximate it with a single conditional-`UPDATE` CAS, with read-replica lag and
  no interactive transactions as caveats. **KV is ruled out** (eventually
  consistent, last-write-wins, no CAS). The local SQLite-transaction model
  translates cleanly only to the DO-storage case.
- **Retry is a primitive capability.** DO alarms auto-retry a throwing handler with
  exponential backoff (≈2 s start, up to ~6 attempts) and Queues retry; bare Cron
  Triggers do not. A DO-alarm retry re-runs the **whole** action (re-fetch and
  re-apply, including an already-committed first mutation) — which is *why* the
  stable `idempotencyKey`/`slotKey` is separate from `runId`, and why "one durable
  mutation per run when practical" is load-bearing.
- **CPU and cross-DO hops.** The action→`runMutation`→fan-out path may cross DO
  boundaries (data-owner DO, realtime-owner DO) as RPC against the per-invocation
  subrequest budget, under a ~30 s default CPU limit per invocation (raisable via
  `limits.cpu_ms`; verify the ceiling for the `scheduled()`/Queue handler). Fine at
  Caltrain scale with one batched mutation per run; it reinforces batching. Exact
  routing is deferred to [LLP 0014](./0014-cloudflare-strategy.rfc.md).
- **`enabled: false` differs by primitive.** For a DO-alarm job, don't re-arm. For a
  Cron-Trigger job, the trigger keeps firing until redeploy, so disabling means the
  handler early-outs and still bills a small invocation.
- **Determinism doesn't transfer.** The frozen-clock + manual-tick bar is a
  local/Ibex capability; the CF profile reports it as a capability gap (or uses a
  Snapback-injected clock shim).

### Scale-to-zero tension and demand-gated polling

A frequent-interval job *appears* to keep the app **warm**: on a scale-to-zero
substrate (Cloudflare/serverless) an always-armed sub-minute alarm wakes the
Durable Object several times a minute forever, defeats hibernation, and bills
duration + requests 24/7; on an always-on VM the same poll is free at the margin.
So idle cost is cadence- and target-dependent, consistent with
[LLP 0000](./0000-snapback.explainer.md#multi-target-deployment)'s per-target
idle-cost framing.

But the "warm forever" cost is **not inherent** for demand-shaped products. For a
product like All Aboard, the data only matters *while someone is watching*, so the
refresh should opt into **demand-gated** activation rather than always-on. There
are two Cloudflare-compatible versions:

- **Minute static wakeup:** a Cron Trigger fires once per minute, the durable runner
  checks subscriber demand and cache age, and it early-outs when there is no useful
  work. This still bills a tiny deployed invocation, but it avoids a continuously
  armed sub-minute alarm and is the default All Aboard shape.
- **Dynamic alarm:** the Durable Object that owns the live-query room arms a poll
  alarm only while it has ≥1 subscriber, cancels it (`deleteAlarm`) when the last
  subscriber disconnects so the object can hibernate, and fires one immediate
  catch-up poll when a subscriber re-arms it (reusing the "missed ticks → run once
  on recovery" path). This is the stricter idle→zero shape, and the required shape
  for sub-minute freshness.

So "it never idles" holds only for an un-gated frequent poll. Cadence is a product
decision with a cost consequence, and demand-gating plus read-through catch-up is
the lever that makes a frequent or semi-frequent refresh compatible with
scale-to-zero targets. Demand-gating is not the default for all cron jobs; it is a
declared policy for jobs whose product semantics allow idle staleness.

## Relationship to realtime and ephemeral state

Cron writes **durable** rows, and the live-query path
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)) fans the changes out. Cron
is **not** a substitute for ephemeral state
([LLP 0013](./0013-ephemeral-realtime-state.rfc.md)) and must not be used to push
high-frequency transient state — its cadence is coarse (seconds and up), not
per-keystroke.

## Implementation plan

1. **Manifest/codegen:** add `defineCron`, cron manifest entries, source-span
   diagnostics, schedule normalization, activation policy, jitter defaults, and
   `cron` capability reporting. Invalid schedules, missing actions,
   target-incompatible cadences, and unsupported policy knobs must be diagnostics,
   not omissions.
2. **Cron-scoped action kind:** introduce the minimum action invocation path needed
   by cron, initially without broad general-action claims. Actions can call
   `ctx.runMutation(...)`, receive run metadata, and use injected runtime time/id.
   Ordinary queries and mutations keep ambient `fetch` denied.
3. **Local scheduler:** add the SQLite-backed job state/run ledger, an in-process
   due-job loop beside the existing server housekeeping, atomic claim semantics,
   deterministic jitter, activation-state tracking, manual tick/run-now support,
   and inspect/admin facts for job health. Normalize each schedule into a
   `{ wakeup: cron-expr | interval-ms, needsDurableRunner }` shape now, so the
   ledger row already carries what a Cloudflare adapter needs.
4. **Recorded-feed proof:** make All Aboard Phase 2 run a refresh action that
   advances recorded train data through a mutation, proving stale read-through
   catch-up, minute scheduled wakeup, durable write -> live-query delta before
   outbound egress or secrets are enabled.
5. **Egress/secrets rider:** enable `fetch` and secret handles for the action class
   only under the LLP 0009/0027 capability policy. The per-host allowlist gap stays
   explicit until Ibex threads host-scoped capability checks through the fetch path
   or Snapback adds an app-level URL check.
6. **Hosted adapters:** implement Cloudflare only after LLP 0014 chooses the
   profile-specific split, using the wakeup-source-vs-runner model above — a
   durable runner owns the ledger/claim/no-overlap regardless of whether the wakeup
   is a Cron Trigger, a DO alarm, or a demand event.

## Validation requirements

Before this RFC moves to `Active` or Cron is reported as implemented, the local
implementation should prove:

- invalid cron definitions produce structured diagnostics with source spans and
  do not silently disappear from generated manifests;
- generated artifacts and `app.inspect` expose declared jobs, schedule, jitter
  policy, activation policy/state, enabled state, in-flight state, next run, last
  run, last error, and recent run history;
- a manual tick with a frozen clock and seed produces deterministic durable rows;
- default jitter produces deterministic nominal/due times, while `jitter: false`
  is visible in the manifest and either honored by the target or reported as a
  capability gap;
- demand-gated jobs report `armed`, `inactive:no-demand`, and `catching-up` states,
  and do not run while inactive;
- a minute-compatible demand-gated job can be represented as a static minute wakeup
  plus a runner demand/cache-age early-out, while sub-minute demand-gated jobs
  report the need for a DO alarm or equivalent dynamic wakeup;
- manual/run-now and demand catch-up runs get stable idempotency keys that do not
  accidentally dedupe against ordinary scheduled slots unless explicitly intended;
- a scheduled action can call one mutation, that mutation produces one commit
  version, and the existing realtime path delivers the live-query delta;
- ordinary query/mutation handlers still cannot access ambient `fetch`, secrets,
  timers, or action-only scheduler metadata;
- a job whose cadence is below the target floor fails with a capability diagnostic;
- default no-overlap behavior records a skipped/coalesced tick while a prior run
  is in flight;
- a failed run records outcome, duration, diagnostic details, and repeated-failure
  state visible through inspect/admin without leaking secrets;
- restart recovery runs at most one catch-up invocation for a poller by default,
  rather than replaying every missed interval;
- capability reports and tests mark action egress/secrets as missing until
  the corresponding runtime policy is implemented;
- schedule normalization records the `{ wakeup, needsDurableRunner }` shape so the
  local ledger already carries what a Cloudflare adapter will need.

## Open questions

- **Cadence grammar** — exact cron-expression grammar, seconds support, and
  whether the first local implementation accepts calendar schedules or starts
  interval-only with a diagnostic for calendar jobs.
- **Jitter defaults** — exact default caps for interval and calendar schedules,
  and whether they are target-wide constants, deployment settings, or encoded in
  each generated manifest.
- **Activation schema** — exact way jobs declare demand signals (`whileLive`,
  room/scope names, query ids, or another shape), and how much staleness is
  acceptable on first-subscribe-after-idle.
- **Action generality** — is `action` a fully general execution class from the
  start, or introduced cron-scoped and later generalized to per-request actions
  (like the All Aboard walk/bike Maps call)?
- **Overlap policy surface** — which configurable policies beyond the default
  skip/coalesce are worth supporting: queue, allow-concurrent, or keyed
  concurrency?
- **Retry classification** — none/skip-to-next-tick for pollers vs backoff for
  calendar jobs; where is the line and how is it declared?
- **Secrets** — how is the API-key pool (and rotation) declared and bound to an
  action context? (Shared with the [LLP 0027](./0027-all-aboard-caltrain-demo.plan.md)
  secrets-seam gap.)
- **Backfill** — should calendar jobs run-if-missed by default?
- **Timezones** — calendar cron in UTC, app-configured zone, or per-job?
- **Limits** — max runtime and concurrency per job and per tenant.
- **Cloudflare runner/storage shape** — which LLP 0014 profile (D1 store + DO
  coordinator vs DO app shard) owns the run ledger, which in turn forces the D1-CAS
  claim or the DO-storage claim? The wakeup primitive remains first-class: Cron
  Trigger for minute-compatible jobs, DO alarm for sub-minute or dynamically armed
  jobs.
- **CF limit verification** — confirm against current Cloudflare docs: the
  configured Cron-Trigger limits (the docs currently mix per-Worker and
  account-level language) and the CPU/wall ceiling for `scheduled()` and
  Queue-consumer handlers, checked against an egress + multi-mutation worst case.
- **Definition changes** — exact migration behavior when a job is renamed,
  removed, disabled, or changes schedule while run history exists.

## Status

Draft. The first consumer and forcing function is All Aboard
([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md)); this RFC unblocks its
Phase 2 (real scheduled/demand refresh). It depends on
[LLP 0009](./0009-code-execution-security.rfc.md) for the action sandbox/secrets
boundary and feeds one seam of the
[LLP 0014](./0014-cloudflare-strategy.rfc.md) Cloudflare strategy. Implementation
should start with the **local in-process scheduler and the action→mutation path**,
proving determinism, read-through catch-up, and observability before any hosted
adapter is attempted.
