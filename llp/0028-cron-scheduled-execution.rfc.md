# LLP 0028: Cron — scheduled execution

**Type:** RFC
**Status:** Accepted
**Systems:** Cron, Runtime, Realtime, Data gateway, Deployment, Security, Developer experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-30
**Revised:** 2026-08-06 (LLP 0184 Phase 2 residue: §Inspection and query
surface adds the built, read-only `cron.list` host operation, direct GET
alias, CLI, and MCP projections over facts already held by the loaded
manifest and scheduler runtime; no new scheduler storage semantics); 2026-08-01 (0137 a4-f4: §Inspection and query surface — a
never-run `everyMs` job seeds its first nominal at the most recent
epoch-aligned slot, not slot 0; the run's trusted clock is bound to its due
time, so the epoch-0 seed made the documented first catch-up run execute
with `ctx.runtime.now()` ~0 while its ledger row recorded Succeeded. Grid
stays epoch-anchored; run identity stays deterministic; downtime-recovery
coalescing and its nominal-bound trusted time are unchanged and flagged as
an open question.) 2026-07-30 (dated boundary amendment per Diary 0039 and LLP 0115
CV-9: transactional *one-off* scheduling — the Convex `runAfter`-class
primitive the rerun scored as the everyday winner — is explicitly outside
this RFC. The run ledger's identity model (`jobName`, nominal slot, schedule
hash, definition generation) presupposes source-manifest definitions and
structurally rejects runtime-created entries, and local scheduler state is a
whole-blob snapshot persisted outside the mutation commit path, so a
transactional enqueue cannot be a small delta here. LLP 0070's durable-job
queue owns that primitive, per the existing 2026-07-23 cross-reference; its
designated first slice is the `runAfter` case. This RFC's contribution is
the deterministic test seam: the `SNAPBACK_CRON_DISABLED` + admin
manual-tick pattern is the donor for a sibling injected-clock jobs drain in
LLP 0070, so one-off work becomes provable without sleeping exactly as the
Dispatch arm proved recurring work.) 2026-07-25 (issues/20260724-cron-dev-disable-flag: §Scheduler state and run ledger gains the dev/test disable switch — `SNAPBACK_CRON_DISABLED=1`/`true`, the `--cron-disabled` CLI flag, and the kit's `cronDisabled` start option run the local server with the scheduler inert: definitions still load, validate, and inspect, no run is ever claimed autonomously, and the admin manual tick keeps claiming and executing due runs; the guide's cron and acceptance pages now state the epoch-0 first-tick consequence for suite authors). 2026-07-23 (dated amendment per LLP 0086 CC-8 row 3: §Cloudflare records that platform alarms are treated as lossy — single in-flight per-object alarm, ~six backoff retries, then silent drop (LLP 0083) — and that the durable schedule table remains authoritative; this confirms the existing wakeup-vs-durable-runner stance and sharpens the retry bullet, which noted the ~6-attempt backoff but not the terminal silent drop; cross-referenced with LLP 0070). 2026-07-17 (local definition generations and run sequences are terminal, JavaScript-safe identities; exhaustion refuses before ownership/nominal mutation, durable counter corruption fails startup, and failure telemetry saturates). 2026-07-16 (Cloudflare cron status now separates its public bounded outcome/code projection from authenticated operator detail; the diagnostic code is persisted independently and public classification is never parsed from error text); 2026-07-15 (ENG-25006: vendored Ibex now keeps pending fetch work visible until its runtime callback is published; the ENG-24530 settlement-floor precedence remains a defense-in-depth caller contract); 2026-07-14 (ENG-24530: the host-call-free completion generation fence also arbitrates the settlement-floor result, so a spurious `SNAPBACK_HANDLER_DID_NOT_SETTLE` from the vendored Ibex fetch-completion window cannot mask a real `SNAPBACK_ACTION_GENERATION_CONFLICT`; watchdog timeout precedence preserved; earlier: 2026-07-13 ENG-24565/ENG-24569: scheduled nominals are consumed at claim time, allow-overlap owns multiple run ids, logical-job ownership survives schedule replacement while outcomes remain generation-bound, cron dispatch is bounded-concurrent, and detached native action workers have a hard admission ceiling; earlier: 2026-07-12 ENG-24340 final review follow-up: detached host-call instance-lock and commit-gate acquisition are deadline/abandon-aware; HostPlan/data iteration and buffered-write application poll lifecycle outside the gate, whose only owner is the final SQLite commit, so a wedged mutex or data-dependent plan cannot strand the watchdog; ENG-24340 review follow-up: the outer detached action now carries its staging app generation; every later host call, including an in-lock host-plan mutation, and the final successful completion fence reject schema/function/reset drift; ENG-24340: nested Ibex mutations execute against an isolated, staging-time schema/read view outside the instance mutex, commit rejects app-generation drift, abandonment is linearized at their bounded commit gate, and Hermes async-break time limits terminate CPU-bound action/nested VMs without leaking workers; ENG-24343/ENG-24348/ENG-24367/ENG-24369: Cloudflare scheduler state uses a recoverable lease plus commit-coupled nested-mutation replay, manual run-now stays outside that ledger, pre-reset actions are generation-fenced, and strict-next cadence after missed ticks is regression-pinned; ENG-24356: persisted scheduler state is format-versioned and incompatible/corrupt durable shapes fail closed without overwrite; earlier: 2026-07-11 ENG-23840 / ENG-23841 / ENG-23626: §Scale-to-zero
tension gains the deliberate real-Cloudflare All Aboard no-subscriber proof:
the operational credential path was restored, five zero-demand observations
established the reset/disarm boundary, and a settled two-hour pure window
produced an observed-zero estimate for Worker requests, Worker execution GB-s,
and Durable Object requests with clean bracketing controls; this closes the
direct idle→zero evidence residue without changing the accepted
demand-armed-alarm design);
2026-07-08 (ENG-23640: §Scale-to-zero tension — the dynamic-alarm
row gains its first measured real-Cloudflare evidence: per-script analytics
over the deployed All Aboard separate the demand-armed warm-poll hours from
the quiet hours on the billing surface, and the overnight window is shown to
be a *connected* window — demand-gating held the alarm up because a
subscriber existed — so the no-connection idle→zero evidence lands on the
alarm-free notes deployment in LLP 0040 §As-built instead); 2026-07-08
(ENG-23730: §Schedule/cadence and §Demand gating now distinguish the job
cadence from the upstream request cadence — All Aboard polls at 180s
(ENG-23642) and its action's transactional `claimFeedPoll` budget caps real
511 requests at one per window regardless of trigger; an `everyMs` never
implies an external-API budget, which belongs to the action); 2026-07-07
(ENG-23627 / LLP 0049 ratification: §Scale-to-zero
tension — the demand-armed DO alarm is now All Aboard's accepted Cloudflare
warm-poll shape, superseding the minute-static-wakeup default this document
previously carried; LLP 0040's idle-economics measurement makes zero idle
wakeups a requirement for that deployment, which moves `warmPoll` to the
decision table's DO-alarm row. The minute Cron Trigger + demand check remains
the named fallback, taken only with its idle invocation rate measured and
declared in the capability manifest. The All Aboard source cadence comments
were corrected in the same change); 2026-07-07 (ENG-23417: §Scheduler state: validation-rejected jobs hold no runtime state — a redeploy that fails validation drops the job's previously-earned state in `reconcile`, manual run-now refuses rejected jobs with `SNAPBACK_CRON_JOB_INVALID`, and `claim_due_runs` claims only from schedule-hash-matching state; closes the loophole where a stale nominal made a rejected job execute, or with an invalid expression re-execute every tick); 2026-07-07 (ENG-23324: §Execution: the action class gains the as-built detached-execution note — server-triggered Ibex actions are staged under the global mutex but run off it on a watchdogged thread with per-host-call lock reacquisition; cron ticks claim under the lock, execute detached, and finish under the lock; `action_wall_clock_timeout` reports Enforced); 2026-07-01 (LLP 0032 L5: §Scheduler state gains the idle-cost contract — persist only on change, and skip the global lock when no job is armed, so an idle local instance has no periodic disk writes; status → Accepted, ratified in the LLP 0032 R1 batch: cron shipped per this design — duration-record and retry gaps tracked as LLP 0032 S5.D8 and the test-debt register, DK-6 open; Cloudflare-friendly refinement: All Aboard now uses a 60s read-through/minute-refresh default; Cron still supports sub-minute target capabilities but no longer treats a sub-minute DO alarm as All Aboard's baseline); 2026-07-02 (DK-6, ratified by Charlie and ledgered in LLP 0000: §Calendar expression semantics ratifies POSIX OR day-of-month/day-of-week matching — a breaking change from the initial AND behavior — and unsatisfiable expressions now fail validation instead of silently never firing; same day, the unimplemented `retry: backoff` mode is rejected fail-closed at validation); 2026-07-02 (ENG-22604: §Inspection and query surface documents the epoch-0 interval anchor and the display rule — armed past-due times render as "due now" and not-armed next times render as absent, never as an epoch wall-clock date)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0008, LLP 0009, LLP 0010, LLP 0014, LLP 0017, LLP 0027, LLP 0040, LLP 0049, LLP 0050, LLP 0070, LLP 0083, LLP 0086

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
  (`crates/snapback/src/manifest.rs`), defaulting `false`. This RFC defines what fills it.

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

- **fixed interval** (`everyMs`) — All Aboard polls every 180s (ENG-23642;
  originally 60s), with the upstream 511 request rate additionally capped by
  the action's own transactional `claimFeedPoll` budget — the job cadence and
  the external-API budget are deliberately separate numbers (ENG-23730);
- **calendar expression** (`cron: "0 3 * * *"`) — e.g. a nightly GTFS refresh.

Minimum granularity is a **target capability fact**, not a constant: local can run
sub-minute; Cloudflare Cron Triggers have a one-minute floor; Durable Object
alarms go finer. Apps that can accept a 60s freshness target should prefer it on
Cloudflare so the hosted wakeup can be a Cron Trigger rather than a continuously
re-armed sub-minute alarm. A job that asks for finer than the target supports must
fail with a structured diagnostic, not be silently coarsened.

#### Calendar expression semantics

Ratified via [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
DK-6 (2026-07-02, ratified by Charlie, ledgered in LLP 0000). Calendar expressions
are five-field cron — `minute hour day-of-month month day-of-week` —
evaluated in UTC at minute granularity. The v0 grammar accepts `*`,
`*/step`, and comma lists of numbers (day-of-week `7` ≡ `0` ≡ Sunday);
ranges (`1-5`) and names (`MON`) are not yet supported and fail validation
as `SNAPBACK_CRON_INVALID_EXPRESSION`.

Day-of-month and day-of-week combine with **POSIX OR semantics**: when both
fields are restricted, a day matches when **either** field matches; when at
most one is restricted, the restricted field must match (a bare `*` matches
everything, so the conjunction is ordinary AND). `0 0 13 * 5` therefore
fires on every 13th *and* on every Friday. This is a **breaking change**
from the initial implementation, which required both fields to match: AND
silently turned `0 0 13 * 5` into "Friday the 13th", which no cron user
expects — POSIX specifies the OR rule and every mainstream cron (Vixie,
cronie, and the implementations Cloudflare Cron Triggers model) implements
it. This RFC extracts `cron:` strings verbatim into hosted schedulers
(§Cloudflare), so diverging from the standard would make the same string
mean different things on different targets.

A field counts as *restricted* whenever it is anything but a bare `*`; a
stepped day field such as `*/2` is restricted. (Vixie cron instead treats
any `*`-spelled field, `*/2` included, as unrestricted for this rule;
Snapback deliberately diverges on that corner so that the OR rule keeps
every satisfiable expression firing at least once per ~8 years, which is
what makes validation-time satisfiability decidable with a small bound.)

An expression that can never fire — `0 0 30 2 *`, February 30th — is a
structured validation error, `SNAPBACK_CRON_UNSATISFIABLE_EXPRESSION`, not
a job that silently never schedules (the no-silent-no-op rule in
§Multi-target deployment). The scheduler finds the next fire with a
day-stepping scan bounded at 3,000 days: under the OR rule the rarest
satisfiable schedule is a leap-day date with an unrestricted weekday
(`0 0 29 2 *`), whose consecutive fires are at most 2,921 days apart
(2096-02-29 → 2104-02-29, across the non-leap century year 2100), so an
expression with no match inside the bound can never fire at all.

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
and a 60s compliance monitor have different product requirements. Nor does the
job cadence dictate the upstream request cadence: All Aboard's `warmPoll` runs
an action whose own transactional budget (`claimFeedPoll`, one 511 poll per
180s window shared by cron and manual refresh — ENG-23642/ENG-23730) decides
whether a granted run may actually touch the external API. Rate-limit
budgeting belongs to the action, not the scheduler.

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

**Idle scheduler cost (local target).** The local 1-second ticker must not do
work — or write to disk — when there is nothing to run. Two rules hold
(implemented via [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
L5): (1) the scheduler state is persisted **only when it changes**; an idle tick
observes no due job, does not mutate the state, and performs no SQLite write, so
an idle instance has no periodic disk I/O — the scale-to-zero shape §Idle cost
demands. (2) The ticker keeps a lock-free *armed* flag, recomputed only when the
function manifest or the set of live-query subscriptions changes; when no cron
job is armed the ticker takes the global instance lock **zero** times per tick.
Arming a demand-gated job (a watcher subscribes to its demand query) sets the
flag; losing the last watcher clears it.

**Dev/test disable switch (2026-07-25,
issues/20260724-cron-dev-disable-flag).** `SNAPBACK_CRON_DISABLED=1` (or
`true`; any other value — including empty or a typo — leaves the scheduler
on, so a malformed variable can never silently disarm production crons) and
the equivalent `--cron-disabled` CLI flag run the local server with the
scheduler **inert**: cron definitions still load, validate, and appear in
every inspection/status surface with their ordinary armed/inactive state,
but the tick loop never starts, so no run is ever claimed autonomously. The
gate sits at the scheduler loop, not the definitions or the claim
machinery, so the admin manual tick (`POST /_snapback/api/cron/tick`)
keeps claiming and executing due runs — acceptance suites use the switch
(via the kit's `cronDisabled` start option) to drive ticks
deterministically instead of racing the 1 s ticker. An inert scheduler
does zero periodic work, which satisfies the idle-cost contract above
trivially. The switch was motivated by the All Aboard external review
(2026-07-24): a 180 s `warmPoll` cron committing ticks mid-suite, plus
the epoch-0 interval anchor (§Inspection and query surface, ENG-22604)
making the first armed tick land up to one interval after boot regardless
of when demand arrived, presented as hidden behavior to every suite
author.

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

**Cloudflare as built (ENG-24348, 2026-07-12).** A claim is terminal only in
`done`/`failed`; `claimed` carries an ownership lease and attempt. A live lease
keeps the nominal slot in place, while an expired lease can be acquired by a
recovery attempt. The stable slot key also scopes a nested-mutation sequence.
Each mutation's result row is inserted in the same Durable Object SQLite
transaction as app rows, version, and journal. A retry may repeat egress, but
when it reaches an already-committed mutation sequence it receives the prior
result rather than committing again — including when a fresh fetch derived
different arguments. Terminal claims and replay rows share the retention
window. Ordinary public actions and admin manual run-now are one-shot attempts:
they record the ordinary last-run summary but allocate neither claim nor replay
rows. App reset advances a durable generation and abandons active actions; each
nested-mutation commit rechecks that generation in the same serialized section
as its final commit fence, so work staged before reset cannot commit after reset
returns. Scheduled and manual runners capture the same generation and skip all
claim-finish, last-run, nominal-advance, and prune writes on drift, so an old
completion cannot recreate scheduler state that reset erased. Fault evidence
covers interruption immediately after claim, during
action execution, and after mutation commit but before claim finish.

**Atomic completion follow-up (ENG-24500, 2026-07-12).** Completion is one
`transactionSync`: terminal claim state, last-run summary, strict-next nominal
advance, and terminal-history pruning are indivisible. A fault injected
immediately after the terminal update rolls that update back, leaving the
leased claim recoverable; the next attempt replays committed nested mutations
and writes exactly one observable completion. The prior three-boundary fault
suite now also pins this post-terminal statement boundary.

The source manifest remains the definition of what jobs exist. When a job is
renamed, removed, disabled, or its schedule changes, the runtime should reconcile
state explicitly and report any orphaned history or migrated next-run state in
inspect/admin output.

Persisted runtime state is format-versioned. A missing state value means a new
scheduler; an existing value that cannot be decoded, has an unknown version, or
contains an incompatible partial record fails startup with
`SNAPBACK_CRON_STATE_INVALID` and remains untouched for operator recovery. The
versionless complete v1 shape is the explicit older migration accepted by the
local target (ENG-24356); durable state never falls through to an empty default.

The local runtime's definition generation and run sequence are identity-bearing
counters in `0..=Number.MAX_SAFE_INTEGER`. The maximum is usable once; a
successor is terminally unavailable and returns
`SNAPBACK_CRON_DEFINITION_GENERATION_EXHAUSTED` or
`SNAPBACK_CRON_RUN_SEQUENCE_EXHAUSTED` before definition replacement, nominal
consumption, ownership installation, or skipped-run recording. A scheduled
batch is staged atomically so exhaustion in any job publishes none of its
claims. Persisted values outside this domain fail startup with
`SNAPBACK_CRON_STATE_INVALID`, and the admin-visible consecutive-failure count
saturates at the same maximum rather than panicking or leaving the portable
plain-JSON profile. This preserves both the A → B → A definition fence and exact
run ownership without ABA reuse.

**Validation-rejected jobs hold no runtime state (ENG-23417).** The fail-closed
rule for invalid definitions covers redeploys, not just first deploys: when a
previously-valid job redeploys with a definition that fails validation,
`reconcile` *removes* its existing runtime state rather than merely skipping
the job. Retaining the old nominal would let the rejected action fire at the
stale due time — and for an invalid cron expression the nominal could never
advance again, so the job would be re-claimed on every tick. The same
invariant guards the other doors into runtime state: manual run-now refuses
validation-rejected jobs with `SNAPBACK_CRON_JOB_INVALID` (creating state
there would permanently arm a job `reconcile` deliberately gave none), and
`claim_due_runs` only claims from state whose schedule hash matches the
current definition.

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
  fan-out (`crates/snapback/src/local.rs`);
- has scoped access to **secrets** (e.g. the API-key pool), never client-visible
  and never written to durable rows in the clear;
- is subject to **timeout and resource limits**, since it does I/O and may run
  long.

The shape is therefore always: *a scheduler, manual control, recovery path, or
demand/read-through trigger runs an action; the action fetches; the action calls
mutations.* This keeps the deterministic mutation/commit model intact and reuses
the realtime machinery rather than inventing a second write path.

**As built (ENG-23324 / ENG-24340, revised 2026-07-12): detached execution and
the watchdog.**
Server-triggered Ibex actions no longer run under the global write mutex.
The invocation is *staged* under the lock (module source, per-invocation
config grants, and runtime handle cloned out), then executed on a dedicated
thread with no instance lock held. Raw action `ctx.db.*` calls are rejected
host-side before dispatch; actions reach durable state only through
`ctx.runMutation`. An Ibex `ctx.runMutation` handler executes outside the
mutex against a pinned WAL read view (or
an owned SQLite snapshot for an in-memory instance), buffering its writes and
captured reads. The outer action's function, schema authority, and app generation
are captured together at staging; every later host call rechecks that generation,
including an in-lock host-plan mutation. Nested Ibex execution uses its exact
staging-time schema, and commit rejects any intervening schema/code/reset
generation. Only commit-time validation, the SQLite commit, permission
epoch advancement, and realtime fan-out reacquire the mutex. A hung outbound
fetch or nested mutation handler therefore stalls only its own action. The run
is bounded by a coarse wall-clock watchdog
(`SNAPBACK_ACTION_TIMEOUT_MS`, default 30s and clamped to a 15-minute maximum
before constructing the host deadline; `action_wall_clock_timeout`
reports **Enforced** in the capability manifest, while query/mutation
`wall_clock_timeout` stays Missing). On timeout the caller receives
`SNAPBACK_ACTION_TIMEOUT` and the run is abandoned. Timeout and the bounded
commit window share an independent commit gate: a host call either commits
before abandonment wins that gate, or its buffered effect is discarded. The
watchdog never waits for an unbounded instance lock, and no commit can land
after the caller was told the action failed. Mutations committed before the
timeout stand, which is exactly the no-action-level-transaction contract
below. Both instance-lock and commit-gate acquisition use short
deadline/abandon-aware try-lock loops, holding neither lock between attempts.
HostPlan/data iteration and buffered-write application check that lifecycle
outside the commit gate; the gate returned by the precommit callback spans only
the already-built SQLite transaction's identity write and `COMMIT`, and drops
before receipt, permission-epoch, or realtime fan-out work. Thus a permanently
held instance mutex cannot strand the action OS worker, while a timeout that
wins before precommit rolls the whole transaction (including version and
idempotency state) back. The outer action VM and every nested mutation VM are
armed to the same remaining deadline through Hermes' interruptible-eval
time-limit monitor.
CPU-bound JavaScript is asynchronously broken, its fresh VM is destroyed, and
its OS worker exits before the timeout result is published; repeated hostile
loops therefore do not accumulate live CPU workers. The outer watchdog keeps a
short, bounded termination grace as a fail-safe for native host work.
The hosted Cloudflare projection likewise treats a non-finite, zero, or
negative timeout binding as the 30s default and clamps larger values to 15
minutes; this keeps a u64-like operator value from overflowing the platform
timer into an immediate or effectively unbounded timeout.

**Bounded detached dispatch (ENG-24565 / ENG-24569, 2026-07-13).** Native host
work that does not respond to interruption may retain its worker after the
public timeout, so detached action admission now has a hard process-wide
ceiling (32 by default, configurable with
`SNAPBACK_ACTION_MAX_CONCURRENCY`, clamped to 1,024). Saturation fails fast with
`SNAPBACK_ACTION_CAPACITY_EXCEEDED`; a stuck native call retains its permit
until it actually exits, bounding OS-thread growth instead of transferring it
to an unbounded queue. Active, admitted, limit, and rejected-admission counters
are reported on the gated admin inspect surface. A cron tick dispatches
independent claims concurrently
up to a separate bound of eight by default (configurable with
`SNAPBACK_CRON_DISPATCH_CONCURRENCY`, clamped to 1,024), preserving claim order
in the returned envelope; the process-wide action ceiling remains the final
admission gate. The automatic scheduler hands admitted runs to a shared
semaphore and resumes polling without awaiting handler completion, so
`overlap: allow` can actually span due ticks. Dispatcher saturation is recorded
as `SNAPBACK_CRON_DISPATCH_CAPACITY_EXCEEDED`, never queued without bound.
Each Allow job additionally owns at most 32 active run ids across scheduled and
manual claims; later slots are skipped with
`SNAPBACK_CRON_RUN_CAPACITY_EXCEEDED` until completion releases ownership.

The local scheduler also consumes a nominal slot atomically when it creates a
claim, rather than waiting for completion. `overlap: allow` owns a set of active
run ids, while `noOverlap` tests that set; finishing removes only the exact run
it owns. Live ownership is keyed by logical job name and survives both
same-schedule hot reload and schedule replacement, so a changed `noOverlap`
definition waits for its predecessor and repeated `allow` replacements cannot
reset the 32-run ceiling. A replacement starts fresh nominal/jitter/outcome
state; completion always releases its exact logical-job run id, but updates the
last-run outcome only when its monotonic definition generation and schedule hash
are still current. Thus even an A → B → A reload cannot let an old completion
clobber the new generation's scheduling or summary. Ordinary manifest
reconciliation never clears ownership. Process startup clears persisted
ownership because the owning workers cannot return; an explicit app reset is
the separate generation-fenced operation that deliberately clears runtime state.

An action paused in native fetch/timer work is not presently interrupted just
because the app generation advances; wiring that prompt cancellation requires a
runtime-owned cancellation handle rather than another host-call check. It still
cannot escape stale success: after the awaited handler settles and before its
result is published, the detached worker rechecks the staging generation. A
reload, schema change, or reset during a host-call-free await therefore returns
`SNAPBACK_ACTION_GENERATION_CONFLICT`; the existing watchdog remains the hard
upper bound when the native operation never settles.

That completion fence also arbitrates the *settlement-floor* result, not only
clean success (ENG-24530). Before ENG-25006, Ibex fetch completion erased its
pending-request registry entry before it enqueued the resolve callback, so the
eval loop could momentarily observe "no pending work" and report
`SNAPBACK_HANDLER_DID_NOT_SETTLE` for a fetch that had settled at the network
layer. Vendored Ibex now publishes the runtime callback before releasing the
pending-fetch keepalive and re-wakes the loop after that release, closing the
native window. Snapback retains its caller-side precedence rule as defense in
depth: when a reload/reset crossed the async span, any settlement-floor result
still re-runs the staging-generation check and surfaces
`SNAPBACK_ACTION_GENERATION_CONFLICT`; a genuinely unsettled handler with no
generation drift keeps its floor diagnostic. Watchdog precedence is preserved
because the recheck reports abandonment/deadline (`SNAPBACK_ACTION_TIMEOUT`)
ahead of the generation fence.

Cron follows the same structure: a tick *claims* due runs under the lock,
executes each claim detached (same watchdog), and *finishes* each claim back
under the lock — the claim-to-finish window now spans the real run duration,
and claims are stateful, so concurrent tickers (scheduler, admin tick,
manual run) cannot double-claim a NoOverlap job. Host-plan actions (bounded
mutation steps, no egress) still execute under the lock. The config-verify
probe uses the same detached/watchdogged Ibex path. `POST /action/{name}`, the
admin function runner, the cron scheduler, `/_snapback/api/cron/tick`, and
manual cron runs all route through the detached flow.

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
- **`retry: backoff` is declared but not implemented.** No retry logic exists
  for any mode yet (`NextTick` is the implicit skip-to-next-tick default), so
  manifest validation rejects `retry: backoff` fail-closed with a structured
  diagnostic (`SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED`) rather than parsing it
  and silently never retrying — the
  [LLP 0032](./0032-decision-and-implementation-hardening.plan.md) test-debt
  fail-closed rule. Lift the rejection when backoff retry actually exists.
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
- The clock is **injected** — the runtime already threads `now_ms` (`crates/snapback/src/runtime.rs`
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

A target may additionally expose an unauthenticated health/status projection,
but that projection is not the operator runtime view. Its `lastRun` diagnostic
projection may include only timestamps, outcome, and a closed bounded
classification. Job identity, declared action/cadence/activation, and current
demand remain ordinary public capability/health metadata on targets that
already expose them. Exact run ids and scrubbed, byte-bounded error detail
require authenticated operator authority.
The durable runner persists the diagnostic code separately from its detail;
public classification must never be inferred by parsing arbitrary error text.
When both projections share a URL, every response is private/no-store and
varies on the operator credential header so a cache cannot replay detail into
an unauthenticated request.

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

**Amended 2026-08-06 (LLP 0184 Phase 2 residue):** `cron.list` is the
operator-safe convenience projection of those already-existing definition and
runtime views. The AdminRead host operation is also available as
`GET /_snapback/api/cron`, `snapback cron list`, and `snapback_cron_list`.
It returns declared `name`/`action`/schedule/enabled state plus activation,
next nominal/due time, an in-flight boolean, last-run time/outcome, and the
consecutive-failure count. It deliberately omits exact run ids, handler error
detail/results, jitter seeds, and recent-run payloads; callers needing those
facts use the existing secret-read-gated `app.inspect`/admin inspect surface.
This is a pure projection of `CronInspectState`: it creates no scheduler state,
ledger, cursor, or persistence rule.

One wire value in the runtime view needs interpretation rather than direct
display. Interval schedules keep their nominal grid anchored at Unix epoch 0
so that "every 1m" means whole-minute boundaries regardless of when the
process started. **Amended 2026-08-01 (0137 a4-f4):** a job that has never
run seeds its first nominal at the **most recent epoch-aligned slot at or
before now** (`floor(now / everyMs) * everyMs`), not at slot 0. The run's
trusted clock is bound to its due time — `ctx.runtime.now()` inside a cron
run returns the run's nominal-plus-jitter — so the historical epoch-0 seed
executed the documented first catch-up run with trusted time ~0:
time-gated handler logic (`remindAt <= now` scans) silently no-oped while
the run ledger recorded Succeeded, and any committed timestamps were
1970-dated. Under the new seeding the first catch-up still fires promptly
(the seeded slot is already past; jitter applies as usual), run identity
stays deterministic (`cron:{job}:scheduled:{slot}`), and the first run's
trusted clock is within one interval of wall clock. `nextNominalAtMs: 0`
no longer appears for a fresh interval job; headless consumers that keyed
on the literal 0 anchor must key on `dueAt <= now` instead, which was
always the scheduler contract. A **stale persisted** nominal (downtime
recovery) still coalesces per §Delivery — the single catch-up run keeps
the missed slot's identity and therefore its nominal-bound trusted time;
whether that recovery run should also clamp its trusted clock is an open
design question, not covered by this amendment. Display surfaces must
still not render any past-due time on an armed job as a wall-clock date:
show "due now" for an armed job whose due time is in the past, and show
the next times as absent for a job the scheduler will not fire
(`disabled` or `inactive:no-demand`) — its stored nominal/due values will
not fire as written. The original motivating display failure was the
admin console printing `12/31/1969` for a demand-gated poller
(ENG-22604); the seeding amendment removes that hazard at the source.

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
  coarse timer beside the existing fast housekeeping tick in `crates/snapback/src/server.rs` — and
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

#### Amendment (2026-07-23): platform alarms are lossy; the durable schedule table stays authoritative

Recorded per LLP 0086 CC-8 row 3, from the LLP 0083 Cloudflare prior-art
pass. Cloudflare documents a Durable Object as holding a **single**
in-flight per-object alarm — the only idle-compatible timer — with
at-least-once execution, exponential-backoff retry of a throwing handler up
to about six attempts, and, the fact this amendment adds to the retry
bullet above, a **silent drop after the sixth failed retry**
(LLP 0083 §Limits and economics, confirmed there against the platform
alarms/lifecycle docs). A platform alarm is therefore a lossy wakeup hint,
never a delivery guarantee: after the retry chain exhausts, the platform
stops retrying and reports nothing.

**This is confirmation of the existing stance, not a change to it.** This
document already implies the posture: this section holds that a Cron
Trigger or alarm is only a wakeup, never a complete job, and that the
ledger, claim, and no-overlap always live in the durable runner;
§Scheduler state's as-built Cloudflare protocol keeps nominal slots,
lease-backed claims, and recovery in the Coordinator DO's SQLite;
§Delivery's missed-tick rule runs once on recovery from durable state; and
the resolved runner/storage open question already bars any topology that
"silently revert[s] to wakeup-owned execution." What the amendment pins is
the platform-side consequence: because the alarm's own retry chain can end
in a silent drop, **the durable schedule table remains the sole authority
for what is due**. Every wakeup — a re-armed alarm, a Cron-Trigger
dispatch, demand re-arming, manual tick, or crash recovery — must derive
due work from the table, and alarm arming must be reconciled *from* the
table (as the implemented demand-aware alarm reconciliation does), so a
dropped alarm delays work until the next wakeup rather than losing it. A
projection that let the platform alarm itself carry schedule state would
inherit the silent drop and violate the no-silent-drop rule
(LLP 0000 §Lessons from Valet).

Cross-reference: [LLP 0070](./0070-durable-background-work.rfc.md)
(durable background work) takes the same posture for its job machinery —
`availableAt`, claims, and leases live in the durable job table, and any
hosted timer can only be a lossy wakeup over that table. LLP 0070's
Dynamic Workflows candidate assessment (dated 2026-07-23, per LLP 0086
CC-2b) carries the substrate-side view of the same finding.

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
  armed sub-minute alarm. It is All Aboard's **named fallback**, not its default:
  taking it requires measuring and declaring the per-minute idle invocation rate in
  the capability manifest and excluding the deployment from the
  no-connection-idle-zero claim
  ([LLP 0049](./0049-all-aboard-cloudflare-live.plan.md) §Warm Polling).
- **Dynamic alarm:** the Durable Object that owns the live-query room arms a poll
  alarm only while it has ≥1 subscriber, cancels it (`deleteAlarm`) when the last
  subscriber disconnects so the object can hibernate, and fires one immediate
  catch-up poll when a subscriber re-arms it (reusing the "missed ticks → run once
  on recovery" path). This is the stricter idle→zero shape, and the required shape
  for sub-minute freshness. **This is All Aboard's accepted Cloudflare shape**
  (ratified 2026-07-07, ENG-23627): LLP 0040's idle-economics measurement makes
  zero idle wakeups a requirement for that deployment, superseding the
  minute-static-wakeup default this document previously carried.

  *Measured on the deployed All Aboard (2026-07-08, ENG-23640, per-script
  GraphQL analytics over 2026-07-07T20:00Z–2026-07-08T22:00Z):* the two states
  are visibly different on the billing surface. Demand-armed hours (live
  subscribers held the 60s DO-alarm warm poll armed — `/cron/status` showed
  `state: "armed", demand: 3`, `wakeup: "durable-object-alarm"`) ran
  ~200–800 gateway-Worker requests/hour at ~215–420 GB-s duration/hour, with
  ~360–900 outbound WebSocket pushes/hour. The quietest observed stretch
  (12:00–16:00 UTC) dropped to ~18–32 Worker ingress requests/hour at
  ~1.4–13 GB-s/hour. The overnight window never reached the no-connection
  shape — 6k+ outbound WebSocket messages overnight show at least one
  subscriber stayed connected the whole time, so the alarm stayed armed *by
  design* (demand-gating held the poll up because demand existed). The
  no-connection idle→zero evidence therefore came from the alarm-free notes
  deployment (LLP 0040 §As-built). At that time, a controlled no-subscriber
  window on All Aboard itself still needed to be scheduled deliberately because
  the deployed demo had continuous watchers/agents since launch.

  *Controlled All Aboard closeout (2026-07-11/12, ENG-23840 / ENG-23841 /
  ENG-23626):* the credential path was restored and the deployed app was
  reset. Five status observations at `2026-07-11T23:32:13Z`, `23:32:18Z`,
  `23:32:23Z`, `23:32:33Z`, and `23:32:44Z` all reported zero demand; the final
  observation is the official reset/disarm boundary. The pure measurement
  interval was `2026-07-11T23:37:44Z`–`2026-07-12T01:37:44Z`; a post-window probe at
  `2026-07-12T01:39:47Z` still reported `inactive:no-demand`, `demand: 0`,
  `nextRun: null`, and `lastRun: null`. Once ingestion had settled, the controls
  read at `2026-07-12T02:28:06Z` and the final quiet re-read at
  `2026-07-12T02:43:38Z` returned `errors: []`; the raw
  `workersInvocations`, `durableObjectInvocations`, `durableObjectPeriodic`,
  and `durableObjectStorage` rows were all empty. The request datasets were
  summarized as **0 estimated Worker requests / 0 estimated Worker execution GB-s / 0
  estimated Durable Object requests**; the account-wide periodic query was
  summarized as 0 µs of Durable Object active time. Empty sparse analytics
  rows support this observed-zero estimate because non-empty
  bracketing controls proved the account, filters, and ingestion path: the
  pre-window control reported 11 Worker requests, 0.240013125 GB-s, and 2,675
  estimated Durable Object requests; the post-window control reported 3 Worker
  requests, 0.2347815 GB-s, and 245 estimated Durable Object requests; across the
  script-attributed dataset union those controls included
  all three expected All Aboard identities: gateway, handler, and action
  handler. Worker controls covered only the gateway; the all-three-script claim
  comes from the union with the Durable Object request controls. Cloudflare's
  Adaptive datasets may be sampled, and empty quiet arrays provide no sample
  interval or confidence data, so this does not assert absolute event absence
  or an invoice guarantee. `durableObjectPeriodic` and
  `durableObjectStorage` have no script identity and remain account-wide; the
  storage dataset also had no positive control, so its empty array is telemetry
  absence, not evidence that durable bytes disappeared. The
  [machine-readable closeout artifact](../cloudflare/generated/measurements.remote.idle.2026-07-12.json)
  preserves the status observations, window boundaries, raw dataset rows,
  summary, and controls. This is the direct deployed All Aboard idle→zero
  evidence the earlier watched window could not provide; the historical
  demand-armed observations above remain valid.

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
6. **Hosted adapters — implemented for Cloudflare:** the Coordinator Durable
   Object owns the SQLite job-state/run ledger, lease-backed claim/no-overlap
   protocol, nested-mutation replay, and demand-aware alarm reconciliation. The
   Durable Object alarm is the wakeup source for dynamically armed work; the
   durable runner remains authoritative across retries, eviction, and missed
   ticks.

## Validation requirements

The shipped local and Cloudflare implementations must keep these standing proofs
green:

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
- maximum-value proofs allocate the last definition/run identity exactly once,
  refuse reconcile plus scheduled/manual/skipped successors without state
  mutation, reject non-portable persisted counters, and saturate failure counts;
- restart recovery runs at most one catch-up invocation for a poller by default,
  rather than replaying every missed interval;
- capability reports and tests mark action egress/secrets as missing until
  the corresponding runtime policy is implemented;
- schedule normalization records the `{ wakeup, needsDurableRunner }` shape so the
  local ledger already carries what a Cloudflare adapter will need.

## Open questions

- **Cadence grammar** — ranges (`1-5`), day/month names, and seconds support.
  The v0 grammar and the day-of-month/day-of-week rule are pinned in
  [Calendar expression semantics](#calendar-expression-semantics) (DK-6);
  calendar schedules are accepted by the first local implementation.
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
- **Cloudflare runner/storage shape — resolved for the shipped profile:** the
  app Coordinator Durable Object owns its SQLite run ledger and atomic claim;
  Durable Object alarms wake sub-minute/dynamically armed jobs. A future
  multi-object or control-plane topology must preserve that durable-runner
  authority rather than silently reverting to wakeup-owned execution.
- **CF limit verification** — confirm against current Cloudflare docs: the
  configured Cron-Trigger limits (the docs currently mix per-Worker and
  account-level language) and the CPU/wall ceiling for `scheduled()` and
  Queue-consumer handlers, checked against an egress + multi-mutation worst case.
- **Definition changes** — schedule replacement is resolved above: fresh
  generation state with logical-job live ownership retained. Exact history and
  ownership migration for rename/removal remains open.

## Status

Accepted (ratified in the LLP 0032 R1 batch, 2026-07-01; the local scheduler
and action→mutation path shipped per this design, and DK-6 calendar semantics
were ratified 2026-07-02). All Aboard is the first consumer and forcing function
([LLP 0027](./0027-all-aboard-caltrain-demo.plan.md)): local scheduled refresh
and the Cloudflare Coordinator/DO-alarm projection now share strict-next missed-
tick semantics, durable claims, recovery, and action→mutation enforcement. It
depends on
[LLP 0009](./0009-code-execution-security.rfc.md) for the action sandbox/secrets
boundary and feeds one seam of the
[LLP 0014](./0014-cloudflare-strategy.rfc.md) Cloudflare strategy. Remaining
work concerns additional policy/grammar and future target topologies, not whether
the local or first hosted runner exists.
