---
title: One-off durable jobs
id: backend.jobs
order: 5
audience: agent-first
capabilities: [backend.jobs-one-off]
authorities: [llp/0070-durable-background-work.rfc.md, src/jobs.rs, src/runtime.rs, src/admin.rs, src/admin_secret_read.rs, src/cli.rs, packages/snapback-codegen/define.mjs, packages/snapback-codegen/jobs-authoring.test.mjs, packages/snapback-admin-client/index.mjs]
examples: [packages/snapback-codegen/jobs-authoring.test.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-01
reviewed-commit: HEAD
---

# One-off durable jobs

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

One-off jobs are the `runAfter` shape: a mutation schedules a declared
**action** to run later, transactionally with its own writes. If the mutation
rolls back, no job exists — rollback provably schedules nothing. This is the
LLP 0070 first slice behind the experimental `jobs_one_off_v1` capability;
recurring schedules are [cron](./cron.md), a separate subsystem with a
separate ledger.

Execution is **at-least-once** with fenced attempts and idempotency keys.
No exactly-once class is claimed anywhere on this surface.

## Enqueue from a mutation

`ctx.jobs.enqueue(action, args, options?)` needs zero declaration — every v1
job lands on the paved `default` queue:

```js source=packages/snapback-codegen/jobs-authoring.test.mjs
globalThis.__snapbackHandlers = {
  async scheduleEvent(ctx, args) {
    return await ctx.jobs.enqueue('notify', { name: args.name }, { delayMs: 0 });
  },
  async applyEvent(ctx, args) {
    const id = await ctx.db.insert('events', { name: args.name });
    return { id };
  },
  async notify(ctx, args) {
    return await ctx.runMutation('applyEvent', { name: args.name });
  },
};
```

The complete options vocabulary:

- `delayMs` — non-negative integer; `availableAt = now + delayMs` on the
  frozen invocation clock (deterministic under replay). Horizon: 30 days
  (`SNAPBACK_JOB_DELAY_INVALID` beyond it).
- `idempotencyKey` — 1..200 bytes, scoped to (queue, action); the same key
  under a different action is a different scope and creates an independent
  job. Re-enqueueing with the same key, an equal canonical-args SHA-256
  digest, and the same `maxAttempts` returns the existing job with
  `deduplicated: true` (a different `delayMs` does not break identity —
  the existing job keeps its original `availableAt`); divergent args or
  attempt policy under the same key fails
  `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`; a commit-time race fails closed
  with `SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED` (retry the mutation to
  converge).
- `maxAttempts` — 1..8, default 1. Unlimited retry is invalid
  (`SNAPBACK_JOB_ATTEMPT_POLICY_INVALID`).

The return value is `{ jobId, availableAtMs, deduplicated }`. Job ids ride
the ctx-answer ledger, so tests can assert on them across replay.

Who may enqueue, and what may run:

- **Only mutations enqueue.** Queries and actions get
  `SNAPBACK_JOB_ENQUEUE_UNAVAILABLE`; an action schedules follow-up work by
  calling a mutation via `ctx.runMutation`, exactly as above.
- **Only manifest-declared actions run** (either runtime form — HostPlan or
  JS). A mutation or query callee fails closed at enqueue with
  `SNAPBACK_JOB_CALLEE_NOT_ADMITTED`; an undeclared name is
  `SNAPBACK_JOB_ACTION_UNKNOWN`.

Paved `default`-queue limits (published, not declarable in v1): 16 enqueues
per mutation (`SNAPBACK_JOB_ENQUEUE_LIMIT_EXCEEDED`), 64 KiB canonical args,
30 s claim lease, claim batch 64, retry backoff base 1 s capped at 60 s with
jitter ceiling 1 s.

The declarations around the handlers above are ordinary — the enqueueing
mutation carries no jobs-specific ceremony:

```js source=packages/snapback-codegen/jobs-authoring.test.mjs
export const scheduleEvent = defineJsMutation({
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'scheduleEvent',
  writes: ['events'],
});
```

## Observe a job's status live

`defineJobStatusQuery` generates the declared job-status query — an ordinary
live query over one job's privacy-bounded lifecycle projection, never an
ambient system table:

```js source=packages/snapback-codegen/jobs-authoring.test.mjs
export const jobStatus = defineJobStatusQuery({ auth: 'authenticated' });
```

**Declaring it is the whole authoring step.** Codegen itself emits the
experimental `jobs_one_off_v1` capability requirement *and* the
artifact-level experimental acknowledgment. Do **not** add
`jobs_one_off_v1` to `defineSchema(..., { requiredCapabilities })` — that
option admits schema-level target capabilities only and refuses this id as
unknown.

Args are fixed: `{ jobId: v.string() }`. Authorization in v1 is the declared
auth requirement plus knowledge of the opaque job id; there is no per-job
row policy yet. Subscribe to it like any live query: the snapshot serves the
current row and lifecycle transitions (claim, retry, terminal) arrive as
ordinary live updates.

The served row is lifecycle facts only — never argument values or results:
`jobId` (mirrored as `_id`), `queue`, `action`, `state`, `availableAtMs`,
`enqueuedAtMs`, `attemptCount`, `maxAttempts`, `stateVersion`,
`terminalAtMs`, `lastErrorCode`, and the producer association
(`producerMutationId`, `producerSnapshotVersion`, `producerFunction`).
States: `pending`, `claimed`, `succeeded`, `dead`, `cancelled`.

Receipts carry the other half of the association: a **confirmed** mutation
receipt that enqueued jobs gains a bounded `enqueues` array
(`{ jobId, action, availableAtMs }`, max 16); a rejected receipt never
carries it, and rollback leaves no job rows — inspectable evidence that
rollback schedules nothing.

## Drain deterministically in tests

`POST /_snapback/api/jobs/drain` is the injected-clock seam — the set-based
sibling of cron's forced tick. Body `{ nowMs?, maxWaves? }`: due jobs
(`availableAt <= nowMs`) are claimed in pinned order up to the claim batch
of 64 per wave, executed, and terminally published, with the drain receipts
returned synchronously (ceiling per call: 64 × waves; a larger due set
needs further calls or waves). Acceptance never sleeps:

```sh
# Enqueue with delayMs: 60000, then force due-ness by injecting the clock.
curl -s -X POST "$SERVER/_snapback/api/jobs/drain" \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"nowMs": '"$AVAILABLE_AT_MS"'}'
```

From a headless suite, `AdminClient.drainJobs({ nowMs, maxWaves })` sends
the admin credential for you. Waves are bounded (default 1; out-of-range
values are clamped to 1..=16): jobs enqueued by a wave's actions become
claimable in the next wave when due, and a due set larger than one claim
batch paginates across waves the same way — cascades are refused by the
cap, never detected.

The autonomous worker is its own ~1 s loop; keep it out of a suite with
`SNAPBACK_JOBS_DISABLED=1` (the deliberate sibling of
`SNAPBACK_CRON_DISABLED` — separate subsystems, separate switches) and
drive every claim through the drain seam. Claim order is pinned
(`availableAt` ascending, then job-id bytes); claim ids are random and
explicitly non-normative — never assert on them.

## Inspect jobs as an operator

The admin lane is `GET /_snapback/api/jobs` (list) and
`GET /_snapback/api/jobs/{id}` (job plus its append-only attempt receipts).
In **sessions auth mode** these responses can carry application-adjacent
data, so the admin token alone is deliberately not enough: the request must
also present a **secret-read lease** in the `x-snapback-secret-read-lease`
header, or it refuses with `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`.

Leases are operator-minted, short-lived (TTL ≤ 15 minutes), scoped to named
surfaces, row/byte budgeted, and reset-bounded. The minting proof root lives
next to the ready file (`<ready>.secret-read-root`), which is why minting is
a **ready-file-only** CLI operation — local operator authority can never be
discovered from a URL:

```sh
snapback secret-read-mint \
  --ready-file .snapback/dev.ready.json \
  --admin-inspect          # scope covering admin inspection reads (jobs included)
# → prints a JSON envelope; use its lease value:
curl -s "$SERVER/_snapback/api/jobs/$JOB_ID" \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H "x-snapback-secret-read-lease: $LEASE"
```

The CLI resolves the admin token from `--token`, `SNAPBACK_ADMIN_TOKEN`, or
the ready-file sibling discovery, and signs a one-shot, startup-bound HMAC
proof for `POST /_snapback/api/admin-secret-read/mint`. Other scope flags:
`--receipts`, `--table <name>` (repeatable), `--function <name>`,
`--explain-function <name>`; budgets: `--ttl-seconds` (60),
`--row-budget` (500), `--byte-budget` (1 MiB). There are no wildcard
scopes.

If you hand-roll the flow, the refusal ladder is diagnosable: a jobs read
without a lease is `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`; a mint call with a
bad or replayed proof is `SNAPBACK_ADMIN_SECRET_READ_PROOF_INVALID`; a mint
call without the admin token is `SNAPBACK_ADMIN_TOKEN_REQUIRED`. In dev auth
mode the jobs reads take the ordinary admin credential without a lease. In a
headless suite, `AdminClient.listJobs()` / `showJob(id)` cover the dev-mode
path. Product code should not be here at all — declare the job-status query
instead.

## Design reference

RFC-only (LLP 0070 stays Draft; none of this is claimed by
`jobs_one_off_v1`): queue declarations, capacity counters and admission,
per-key concurrency slots, cancellation, the `ambiguous` terminal state,
deadlines, operator replay, retention windows, webhook capture/delivery,
the `revalidatePrincipal`/`capturedGrant` authorization modes (v1 callees
run as the same system authority cron actions use), artifact-digest
pinning, restore fences, Postgres, and every hosted/multi-worker profile.

## Anti-patterns

- **Do not sleep for due-ness.** Inject the clock: enqueue with a delay,
  then drain with `nowMs` at or past `availableAtMs`.
- **Do not schedule a mutation or query.** Jobs run declared actions; the
  action calls a mutation for durable effects (the same shape cron uses).
- **Do not add `jobs_one_off_v1` to `defineSchema` requiredCapabilities.**
  Codegen emits the requirement and the acknowledgment when you declare the
  surface; the schema option refuses the id.
- **Do not read job status from product code via the admin route.** That
  lane is operator custody (secret-read lease in sessions mode); the
  declared job-status query is the product surface.
- **Do not treat idempotent enqueue as exactly-once execution.** Dedup is
  enqueue-side identity; execution stays at-least-once with fenced
  attempts.
- **Do not assert on claim ids.** They are provenance on attempt receipts,
  random by design; assert on job ids, states, and receipts.
