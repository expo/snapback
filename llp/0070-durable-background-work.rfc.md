# LLP 0070: Durable background work

**Type:** RFC
**Status:** Draft
**Systems:** Background work, Actions, Webhooks, Cron, Storage, Runtime, Auth, Secrets, Deployment, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-23 (LLP 0086 CC-2b: dated candidate-assessment note added under §Capability classes — can Cloudflare Dynamic Workflows carry this RFC's hosted profile; verdict blocked-on, with the blocking facts named — plus the alarms-are-lossy cross-reference to LLP 0028's same-day amendment; assessment only, no adoption language). 2026-07-20 (initial proposal for LLP 0063's hosted application platform)
**Related:** LLP 0003, LLP 0004, LLP 0007, LLP 0009, LLP 0012, LLP 0014, LLP 0018, LLP 0028, LLP 0036, LLP 0044, LLP 0045, LLP 0046, LLP 0047, LLP 0063, LLP 0069, LLP 0083, LLP 0086, LLP 0087

## Summary

Snapback should add one durable background-work subsystem for finite,
idempotent actions that must survive process restart and outlive an initiating
request. A mutation can enqueue work in the same application-data transaction;
a worker later claims the job with a fenced lease, invokes a version-pinned
action, and records its outcome. Delivery is at least once. Exactly-once
effects are never implied; handlers use stable idempotency keys at every
external boundary.

This subsystem is distinct from LLP 0028 cron. Cron decides *when a recurring
schedule is due* and may enqueue work here. A durable queue decides *which
finite admitted jobs remain unfinished*. LLP 0044 asset processing, LLP 0045
notification delivery, payment commands and webhook reconciliation under LLP
0069, and application integrations can share the same machinery without each
inventing a claim table and retry loop.

The first target profile is `durable-work-single-process-v1`: one trusted
application deployment, one logical database authority, one or more worker
tasks inside a single Snapback process, durable SQLite or single-process
Postgres storage, and no horizontal-worker or untrusted-code claim. A hosted
target may implement the same contract with a managed queue, but it must pass
the same conformance suite and report its different leases, retention, and
delivery limits.

## Semantics

### Job identity and enqueue

Every job has:

- immutable app, database, target-profile, deployment, and stream identities;
- an opaque `jobId` allocated from Snapback's trusted id source;
- a generated action reference and immutable artifact digest;
- canonical, validator-checked argument bytes and their digest;
- a queue name and integer priority from a declared bounded range;
- `availableAt`, attempt policy, retention policy, and optional deadline;
- an application idempotency key scoped to queue and action;
- creator principal and authority/audit facts; and
- a monotonic state version.

A mutation calls `ctx.jobs.enqueue(reference, args, options)`. Validation and
insertion occur in the same database transaction as the mutation's ordinary
writes. If that transaction rolls back, no job exists. The same scoped
idempotency key and identical canonical bytes return the existing job; reuse
with different action, args, or policy fails as
`SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`.

Actions may enqueue follow-up work only through an explicit mutation, preserving
LLP 0004's rule that actions and database commits are not one transaction.
Queries cannot enqueue. Clients cannot forge `availableAt`, artifact, creator,
or target identity outside the generated application policy.

### State machine

The durable states are:

`pending → claimed → succeeded`

with these explicit alternatives:

- `claimed → pending` after a retryable failure or expired lease;
- `claimed → dead` after a terminal failure, exhausted attempts, invalid
  artifact, or missed hard deadline;
- `pending → cancelled` when cancellation wins before claim;
- `claimed → cancelRequested` when cooperative cancellation is requested; and
- `dead → pending` only through an authenticated, reasoned operator replay that
  creates a new attempt generation without erasing history.

State transitions compare the current version and claim fence in one storage
transaction. Terminal state is immutable except for retention deletion after
the audit window. A stale worker may append a late diagnostic but cannot change
state or publish an outcome after its fence is superseded.

### Claims and fencing

A worker transactionally selects eligible jobs by queue, priority, `availableAt`,
and stable tie-breaker, then records:

- a random `claimId`;
- a strictly increasing per-job fencing token;
- `claimedAt` and `leaseExpiresAt` from trusted server time;
- worker and deployment identities; and
- the pinned action artifact digest.

Lease renewal is conditional on state version, claim id, and fence. An expired
lease makes the job eligible for another claim but does not terminate the first
process or external request. Therefore every result mutation and host-mediated
effect receives the fence and rejects stale publication. External systems that
cannot consume a fence must consume the stable job/command idempotency key.

The initial lease is 30 seconds, renewable to the action's enforced wall-clock
limit. Target profiles publish the actual values and maximum. A worker must stop
renewing before graceful shutdown and gets a bounded drain interval; shutdown
never marks in-flight external effects as failed merely because their result is
unknown.

### Execution and retries

Jobs invoke generated actions under LLP 0009/0047 execution limits and LLP 0036
`uses` grants. The runtime supplies:

- `ctx.job.id`, attempt number, claim fence, deadline, idempotency key, and
  cancellation signal;
- validated immutable args;
- `ctx.runQuery` and `ctx.runMutation` with the ordinary transaction semantics;
- action-scoped secret handles; and
- structured progress and redacted diagnostics.

Job payloads never contain secret values or arbitrary serialized closures.

Failures are classified by generated action policy and host diagnostic code:
`retryable`, `terminal`, `ambiguousExternalEffect`, `cancelled`, or
`incompatibleArtifact`. Default retry uses capped exponential backoff with
deterministic jitter derived from job id and attempt. Policies declare maximum
attempts, maximum elapsed time, and backoff bounds; unlimited retry is invalid.

An ambiguous external effect retries only through the integration's lookup or
stable-idempotency path. Generic queue machinery cannot turn ambiguity into
success or failure.

### Artifact and deploy compatibility

Each job pins the generated action ABI and artifact digest admitted at enqueue.
A deployment manifest declares which earlier digests it can execute. Activation
fails if pending jobs reference an unsupported digest unless a reviewed
migration, drain, cancellation, or compatible worker deployment resolves them.

Rolling deploys may run old and new workers concurrently only when claim fences
and action compatibility are shared. Rollback must retain a compatible worker
for jobs enqueued by the newer version or fail closed before routing new work.
Arguments are immutable; migration creates a successor job linked to the old
one and terminally disposes the predecessor with an audit reason.

## Queue declarations and limits

Applications declare queues in generated source with:

- concurrency and optional per-key concurrency;
- maximum pending jobs and bytes;
- claim batch size and lease bounds;
- retry and terminal retention;
- allowed producer functions and consumer actions;
- optional rate limit; and
- required target capability class.

Per-key concurrency uses a generated canonical key extractor and a fenced
durable slot, so commerce can serialize one order without globally serializing
all jobs. It is an execution constraint, not a substitute for database
transactions or provider idempotency.

Admission maintains transactionally updated global, per-queue, and optional
per-principal counters. At limits, enqueue fails before application commit with
a structured capacity diagnostic; it never commits the application write while
silently dropping its job. Reserved system queues may have separate capacity so
one application integration cannot starve authorization or recovery work.

The scheduler provides bounded fairness across queues of equal class. Priority
is bounded and cannot create an unbounded starvation claim. Target reports
include queue capacity, byte capacity, concurrency, rate limits, lease bounds,
oldest age, ready depth, claimed depth, dead depth, and saturation counts.

## Webhook work

Inbound webhook routes authenticate and durably capture bounded immutable facts
before acknowledging the sender, as their subsystem RFC specifies. Successful
capture enqueues normalization or reconciliation in the same transaction. Raw
request bytes that require signature verification are processed before generic
JSON parsing and stored only under the subsystem's declared retention class.

Outbound webhooks use a generated integration action. Each delivery has one
event id and stable attempt idempotency key; signing occurs at the host egress
boundary with an LLP 0036 secret handle. The durable record stores destination
identity, headers allowlist, body digest, attempt facts, response status/size,
and redacted diagnostics—not signing secrets or unrestricted response bodies.

SSRF rules, destination allowlists, redirect policy, DNS/IP revalidation,
timeouts, body limits, and secret redaction are target-enforced capabilities.
Without them a profile may run trusted fixed-destination jobs but cannot claim
arbitrary application webhooks.

## Authorization and isolation

Enqueue authorization runs inside the producing mutation and records the
principal, authority instance, and relevant app policy version. Execution does
not impersonate a stale end-user session. Each action declares whether it runs
as:

- `system`: a generated application service authority with explicit data and
  secret grants;
- `revalidatePrincipal`: the current principal must still pass a named policy
  before each attempt; or
- `capturedGrant`: a narrow, expiring, server-issued job grant names the allowed
  operation and resources without carrying credentials.

The default is fail-closed `revalidatePrincipal`. `system` requires an explicit
source declaration and conformance tests. No mode turns serialized client auth
tokens into queue payloads.

All queue and job ids are scoped to app, database, target, deployment, and
stream. Inspection, cancel, replay, drain, and purge operations use the admin
lane. Public status projects only jobs an application policy allows the caller
to observe.

## Inspection, audit, and recovery

The admin surface supports list/filter, show, tail redacted attempts, pause and
resume a queue, cooperative cancel, dead-letter replay, drain status, and
capacity/capability reporting. Every control action records operator, reason,
target identity, previous/new version, and affected job ids or exact selector.
Bulk operations provide a dry-run count/hash and require that preflight on the
same state version before apply.

Backups include jobs, claims, attempts, counters, audit records, and artifact
compatibility metadata. Restore starts all queues paused. The operator verifies
target/profile identity, compatible artifacts, clock sanity, and external
integration posture before activation. Claims from the source deployment are
expired through a new restore epoch; their fencing tokens are never reused.

Retention deletes canonical args and result bodies only after the declared
terminal window, leaving the minimal idempotency tombstone and audit digest for
the integration's required replay horizon. A subsystem may require longer
retention; generic purge cannot violate it without an explicit destructive
recovery override.

## Relationship to cron and existing outboxes

Cron remains the authority for recurring schedules, missed-run policy,
`NoOverlap`, and deterministic schedule jitter. A cron handler may enqueue one
durable job with a schedule-derived idempotency key. Queue retry does not create
a new cron occurrence.

LLP 0044 and LLP 0045 currently use cron sweeps because this subsystem did not
exist. After this RFC is accepted and implemented, they may amend their target
profiles to enqueue asset and notification work. Their domain state machines,
secret grants, and provider semantics remain theirs; this RFC replaces only the
generic claim/lease/retry machinery.

## Capability classes

- `Missing`: no durable queue;
- `CaptureOnly`: transactional enqueue and inspection, no worker;
- `SingleProcess`: durable fenced claims and execution in one process;
- `MultiWorker`: multiple worker processes with proved fencing and fairness;
  and
- `HostedManaged`: an external queue mapped to this contract with retained
  provider-specific limits and delivery facts.

`durable-work-single-process-v1` requires `SingleProcess` or better. A local
in-memory queue is never durable evidence. Multi-worker and hosted-managed
claims are independent and cannot be inferred from the single-process proof.

### Hosted profile candidate: Dynamic Workflows — candidate assessment (2026-07-23)

Recorded per LLP 0086 CC-2b. This is an assessment only — no
implementation, no adoption language; any adoption decision belongs to
this RFC's own review cadence.

**Candidate.** Cloudflare's Dynamic Workflows (announced 2026-05-01)
extends the Dynamic Workers / Worker Loader family to durable execution
with per-tenant, runtime-loaded workflow definitions, on the same Durable
Object substrate Cloudflare builds its own Queues and Workflows products
on (LLP 0083 §Dynamic Workers and DO Facets, §The realtime layer).
LLP 0083 names it "a platform-native candidate substrate" for this RFC's
hosted profile — which in the classes above would be a `HostedManaged`
mapping: an external managed engine carrying this contract while
reporting its own lease, retention, and delivery limits. Dynamic Workers
has published pricing with billing since 2026-05-26
($0.002/dynamic-worker/day beyond 1,000/month, standard request/CPU
rates, paid plans only), and current platform docs carry no beta caveats
(LLP 0087 §Phase 0 progress note, 2026-07-23).

**Verdict: blocked-on.** The candidacy is plausible — durable execution
from the platform itself, on the DO substrate the hosted target already
ratified — and Dynamic Workflows should remain the named candidate for
the hosted profile. But nothing required to call it viable exists yet.
The blocking facts:

1. **This RFC is Draft.** There is no accepted contract for any substrate
   to carry, and this RFC's own boundary rule bars capability claims
   while it is Draft. The §Acceptance conformance corpus exists only as
   prose: no executable suite, and no
   `durable-work-single-process-v1` receipt to serve as the reference
   evidence a hosted mapping must match.
2. **No conformance-suite run on the substrate.** The hosted-profile rule
   in the §Summary — same conformance suite, different substrate, with
   the target's own leases/retention/delivery limits reported — has been
   exercised on nothing, Dynamic Workflows included.
3. **Contract mapping unresolved.** The load-bearing mechanics of this
   contract have no known Dynamic Workflows expression: transactional
   enqueue in the same database transaction as the producing mutation's
   writes (app data lives in the coordinator DO's SQLite per LLP 0087's
   door-1 invariant, so a cross-substrate enqueue needs an outbox-shaped
   answer that preserves the roll-back-together acceptance bar); fenced
   leases with strictly increasing per-job tokens and stale-publication
   rejection; state-version CAS transitions; artifact-digest pinning with
   deployment compatibility manifests; bounded retry with deterministic
   jitter; cooperative cancellation; dead-letter replay with audit.
   LLP 0083 records Dynamic Workflows' existence and positioning, not its
   execution semantics; no measurement of the engine against these
   requirements exists.
4. **Durability/retry semantics unmeasured against the no-silent-drop
   bar.** The underlying platform timer is lossy: a Durable Object holds
   a single in-flight alarm, retried with exponential backoff about six
   times, then **silently dropped** (LLP 0083 §Limits and economics;
   recorded as LLP 0028 §Cloudflare's dated amendment, 2026-07-23, which
   keeps the durable schedule table authoritative). Workflows runs on
   that same substrate; whether its engine masks the lossiness into the
   at-least-once, recorded-never-dropped delivery this RFC requires is
   unverified. This paragraph is also this RFC's platform-timer
   cross-reference: the single-process profile carries no platform-timer
   dependency, and any hosted mapping must treat a platform timer as a
   lossy wakeup over the durable job table, never as the delivery
   guarantee.
5. **Platform status and gating facts unsettled.** The published pricing
   is recorded but unvalidated by measurement; no dated GA determination
   is recorded in LLP 0014, which LLP 0087 requires before any external
   platform-status claim affects a gate; and runtime code loading engages
   LLP 0014's ratified door 2 (bundle loading is deploy-time, never
   runtime eval), which stands in force pending LLP 0014's own
   re-ratification (LLP 0087 §Ratification posture; LLP 0086 governing
   constraint 1).

**What would unblock a real evaluation:** this RFC leaving Draft with the
conformance suite executable and the single-process receipt in hand;
LLP 0014's dated GA determination and door-2 disposition; then a
measured mapping exercise (enqueue transactionality, fencing, retry
policy, artifact pinning) on the real platform — sequenced with
LLP 0087's facets track, which explicitly names Dynamic Workflows
adoption a non-goal assessed here.

## Acceptance

The implementation must retain executable evidence that:

- enqueue and application writes commit or roll back together;
- identical idempotent enqueue returns one job and changed bytes fail closed;
- crashes before claim, after claim, during action, after external commit but
  before result, and after result commit recover without lost jobs or duplicate
  admitted effects;
- an expired worker loses its fence and cannot publish after a successor claim;
- process restart, graceful drain, forced kill, deploy, and rollback preserve
  the state machine and artifact compatibility rule;
- bounded retries, deterministic jitter, deadlines, cancellation, dead-letter,
  operator replay, and per-key concurrency behave exactly as declared;
- capacity admission rolls back the producing mutation and one saturated queue
  cannot consume reserved system capacity;
- principal revocation, cross-app/database/target/stream ids, stale grants, and
  unauthorized inspection/control fail closed;
- secret values and webhook signing material do not appear in payloads, rows,
  logs, diagnostics, backups, or receipts;
- inbound duplicate capture and outbound duplicate delivery converge through
  stable event/idempotency ids;
- backup, destroy/replace, restore-paused, compatibility preflight, and explicit
  activation preserve a pinned job/result corpus; and
- SQLite and single-process Postgres run the same state-machine and fault corpus
  before both may claim the profile.

The retained receipt names the target profile, app/database/deployment/stream
identities, repository and artifact digests, queue declarations, effective
limits, fault points exercised, job/result corpus hash, secret scan, and every
nonclaim.

## Non-goals and claim boundary

This RFC does not promise exactly-once execution or effects, distributed
transactions, arbitrary workflow DAGs, long-lived interactive processes,
unbounded payloads, horizontal realtime scale, or multi-tenant/untrusted code.
It does not replace cron or domain-specific state machines.

While this RFC is Draft, no capability report may claim durable background work
from an ad hoc loop or cron sweep. LLP 0063 Step 6 requires maintainer acceptance
and an executable target-specific witness before jobs or webhooks count.

## Open questions

1. Should the first implementation execute only host-plan actions, or all
   trusted actions that already satisfy the execution-limit profile?
2. What terminal idempotency-tombstone window is the minimum safe default?
3. Should queue pause live in application storage or the deployment control
   plane so it remains effective while the app artifact is invalid?
4. Does the first Postgres profile remain single-process, or is multi-worker
   admission worth designing before implementation?
