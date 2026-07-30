# LLP 0070: Durable background work

**Type:** RFC
**Status:** Draft
**Systems:** Background work, Actions, Webhooks, Cron, Storage, Runtime, Auth, Secrets, Deployment, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-30 (Diary 0039 competitive evidence and first-slice
designation, per LLP 0115 CV-9: the Snapback × Convex rerun scored Convex's
`ctx.scheduler.runAfter(0, ...)` as the better everyday primitive — a
transactional one-off durable scheduler composing with mutations — and the
LLP 0115 coverage audit found this RFC already specifies that primitive's
semantics (same-transaction enqueue, rollback-schedules-nothing,
`availableAt` delays, job+attempt receipts) while neither the diary nor the
plan's first draft cited it. The `runAfter` case — default queue,
`availableAt = now + delay`, transactional enqueue, host-plan action callee —
is therefore the designated first implementation slice of
`durable-work-single-process-sqlite-v1`, giving this Draft the executable
evidence it needs. Two gaps the slice must close are recorded in §Decisions
still requiring ratification: a deterministic injected-clock drain seam, and
the callee-class admission question for the Dispatch-style action→mutation
shape.) 2026-07-26 (author-side review application: v1 now separates
immutable jobs from append-only attempts, makes operator replay create a
successor job, pins cancellation/ambiguity and atomic terminal publication,
defines claim supersession, queue/deploy admission and artifact custody,
durable authorization inputs, tombstone/counter/fairness/jitter rules, and an
external restore/control fence. SQLite and Postgres are independent tuples; the
first implementation is single-process SQLite over generated host-plan
actions. The RFC remains Draft and still requires independent review and
executable evidence). 2026-07-23 (LLP 0086 CC-2b: dated candidate-assessment
note added under §Capability classes — can Cloudflare Dynamic Workflows carry
this RFC's hosted profile; verdict blocked-on, with the blocking facts named —
plus the alarms-are-lossy cross-reference to LLP 0028's same-day amendment;
assessment only, no adoption language). 2026-07-20 (initial proposal for LLP
0063's hosted application platform)
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

The first target profile is
`durable-work-single-process-sqlite-v1`: one trusted application execution
domain, one logical SQLite database authority, and one or more worker tasks
inside a single Snapback process, with no horizontal-worker or untrusted-code
claim. `durable-work-single-process-postgres-v1` is an independent tuple over
the same semantic corpus; one tuple does not borrow the other's evidence. A
hosted target may implement the same contract with a managed queue, but it must
pass the same conformance suite and report its different leases, retention,
and delivery limits.

## Semantics

### Job identity and enqueue

Every immutable job intent has:

- immutable app, database, target-profile, producer-deployment, logical
  queue/execution-domain, stream, and restore-epoch identities;
- an opaque `jobId` allocated from Snapback's trusted id source;
- a generated action reference and immutable artifact digest;
- canonical, validator-checked argument bytes and their digest;
- a queue name and integer priority from a declared bounded range;
- `availableAt`, attempt policy, retention policy, and optional deadline;
- an application idempotency key scoped to queue and action;
- creator principal and authority/audit facts; and
- a monotonic state version.

Attempts are separate append-only records. Each names job, attempt number,
claim/fence, worker deployment, admitted artifact, trusted timing, outcome,
redacted diagnostics, and predecessor attempt. The current job projection
points at at most one live attempt. Producer deployment is provenance; the
logical execution domain is the stable claim scope across compatible releases;
worker deployment is claim provenance; target/stream/restore epoch fences
replacement. A successor deployment may claim only when the external
queue-admission epoch admits both its artifact and the job's producer ABI.

A mutation calls `ctx.jobs.enqueue(reference, args, options)`. Validation and
insertion occur in the same database transaction as the mutation's ordinary
writes. If that transaction rolls back, no job exists. The same scoped
idempotency key and identical canonical bytes return the existing job; reuse
with different action, args, or policy fails as
`SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`.

The first profile admits generated host-plan actions only: a closed,
artifact-owned action plan with generated validators, read/write/secret grants,
and the LLP 0009/0047 execution envelope. Broad execution of arbitrary trusted
application actions is a later capability.

Actions may enqueue follow-up work only through an explicit mutation, preserving
LLP 0004's rule that actions and database commits are not one transaction.
Queries cannot enqueue. Clients cannot forge `availableAt`, artifact, creator,
or target identity outside the generated application policy.

### State machine

The durable states are:

`pending → claimed → succeeded`

with these explicit alternatives:

- `claimed → pending` after a recorded retryable failure;
- `claimed → dead` after a terminal failure, exhausted attempts, invalid
  artifact, or missed hard deadline;
- `claimed → ambiguous` when an external effect may have committed but its
  exact outcome cannot yet be established;
- `pending → cancelled` when cancellation wins before claim;
- `claimed` remains claimed with a monotonic `cancelRequestedAt` fact when
  cooperative cancellation is requested; and
- `dead|ambiguous|cancelled → successor job` only through an authenticated,
  reasoned operator or domain reconciliation operation.

`succeeded`, `dead`, `ambiguous`, and `cancelled` are terminal for that job.
Replay never reopens them. It transactionally creates a fresh job id and
idempotency domain, records a typed predecessor/reason, copies or explicitly
migrates canonical args and policy, and rechecks current artifact and
authorization admission. The predecessor remains immutable.

Every transition compares job state/version, restore epoch, current attempt,
claim id, and fence in one storage transaction. Pending cancellation may win
before claim. Claimed cancellation is only a request: a verified completed
effect may still publish success, an unknown external result publishes
`ambiguous`, and a deadline prevents new work/publication but does not relabel
an in-flight unknown as cancelled. A stale worker may append a bounded redacted
late diagnostic but cannot change state or publish an outcome after its fence
is superseded.

The normative transition projection records, for every event, current state,
guard identities, next state, attempt/fence changes, capacity-counter and
per-key-slot changes, domain-effect permission, and audit fact. Generated
golden vectors cover every legal row and reject every unlisted transition.

### Atomic result publication

A generated terminal-result mutation is the only ordinary completion path. In
one application-data transaction it:

1. verifies app/database/target/stream/restore epoch, job state/version,
   current attempt, claim id, fence, worker artifact, and queue-admission epoch;
2. applies the domain result under a stable `(jobId, effectName)` idempotency
   record;
3. appends the attempt/outcome receipt;
4. transitions to success, retry-pending, dead, ambiguous, or cancelled; and
5. releases or transfers every capacity counter and per-key slot.

An action needing several application mutations uses one named idempotency
record per effect plus an explicit checkpoint protocol. The queue never implies
atomicity across transactions or external systems.

### Claims and fencing

A worker transactionally selects eligible jobs by queue, priority, `availableAt`,
and stable tie-breaker, then records:

- a random `claimId`;
- a strictly increasing per-job fencing token;
- `claimedAt` and `leaseExpiresAt` from trusted server time;
- worker and deployment identities; and
- the pinned action artifact digest.

Lease renewal is conditional on state version, claim id, and fence. An expired
lease does not pass through an observable unclaimed state. A successor claim
atomically verifies expiry, appends the expired attempt outcome, allocates the
next attempt number and strictly greater fence, transfers the per-key slot, and
records the new lease. It does not terminate the first process or external
request. Therefore every claim, renewal, result mutation, host-mediated effect,
slot, and admin operation carries the restore epoch and fence and rejects stale
publication. External systems that cannot consume a fence must consume the
stable job/command idempotency key.

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
stable-idempotency path. If that bounded path cannot classify the result, the
job terminates `ambiguous` and a domain-owned reconciliation operation may
create a successor. Generic queue machinery cannot turn ambiguity into success
or failure.

The v1 jitter profile computes
`u64be(SHA256("snapback-job-jitter-v1" || 0x00 || canonicalJobId ||
u32be(attemptNumber))[0..8])`, maps it modulo
`(jitterCeilingMilliseconds + 1)`, and adds that unsigned integer to the
saturated exponential base delay. Attempt numbering starts at one; all
arithmetic uses checked unsigned 64-bit milliseconds and caps before addition.
Trusted time schedules the result. Cross-language vectors pin framing,
rounding, saturation, and maximum attempts.

### Artifact and deploy compatibility

Each job pins the generated action ABI and artifact digest admitted at enqueue.
That digest roots a signed/content-addressed manifest over action code and
dependency closure, generated ABI and validator, authorization mode and
dependencies, read/write sets, secret grants, runtime/target profile, and
compatibility/migration policy. Activation proves the exact bytes remain in
immutable custody. Revoked, missing, or known-vulnerable artifacts quarantine
their jobs; a row naming a digest is not permission to execute it forever.

A restore-resistant queue-admission authority outside the application backup
set stores a monotonic epoch and the exact producer/worker artifact sets
admitted for each logical execution domain. Producers present that epoch on
every enqueue; workers present it on every claim and result. Deployment
activation changes producer and worker sets atomically with routing under LLP
0072's control fence. Old/new overlap is an explicit compatibility
intersection. Rollback preflight fences new-generation enqueue before proving
that the predecessor workers can consume every still-admitted job.

A point-in-time scan of pending jobs is evidence, not synchronization.
Activation fails if the admission-set change, routing change, and queue pause
cannot be serialized. Arguments are immutable; migration creates a successor
job linked to the terminally disposed predecessor with an audit reason and
fresh artifact/authorization admission.

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

Every enqueue, claim, retry, terminal transition, cancellation, successor
creation, purge, restore, and migration updates the authoritative rows,
counters, and per-key slots in one transaction. A read-only verifier derives
expected counts and live slot owners from job/attempt rows. Mismatch pauses the
affected queue and requires a fenced repair receipt; admission never treats
eventually reconciled counters as authoritative.

V1 scheduling is weighted deficit round-robin across queue classes, then
`effectivePriority = min(maxPriority, declaredPriority +
floor(eligibleAge / agingInterval))`, then `availableAt`, then canonical job-id
bytes. Weights, `agingInterval`, and priority range are generated target facts.
After at most the sum of positive class weights plus the declared maximum
concurrent claims, an eligible non-saturated class receives a claim opportunity;
per-key saturation and an empty queue are explicit exclusions. Target reports
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

`revalidatePrincipal` retains only credential-free authority subject,
tenant/resource identities, named generated policy, policy schema/version, and
complete invalidation dependencies. Every attempt evaluates the current
authority instance and current resource facts; enqueue-time authorization is
provenance, not execution permission. A `capturedGrant` additionally binds
issuer, audience, exact operation/resources, issue/not-before/expiry, grant
generation, revocation identity, and attempt-time revocation check. Expiry or
revocation during an unknown external effect produces domain ambiguity, not a
guessed cancellation or failure.

All queue and job ids are scoped to app, database, target, logical execution
domain, stream, and restore epoch; producer and worker deployments remain
separate provenance/admission facts. Inspection, cancel, replay, drain, and
purge operations use the admin lane. Public status projects only jobs an
application policy allows the caller to observe.

Progress is non-authoritative, size/rate bounded, redacted, and fenced to the
current attempt. Late diagnostics use a separate bounded retention class and
cannot contain result values, unrestricted exceptions, secret-bearing fields,
or evidence that an external effect succeeded.

## Inspection, audit, and recovery

The admin surface supports list/filter, show, tail redacted attempts, pause and
resume a queue, cooperative cancel, dead-letter replay, drain status, and
capacity/capability reporting. Every control action records operator, reason,
target identity, previous/new version, and affected job ids or exact selector.
Bulk operations provide a dry-run count/hash and require that preflight on the
same state version before apply.

Backups include jobs, claims, attempts, counters, audit records, and artifact
compatibility metadata. The authoritative queue-pause bit, queue-admission
epoch, and restore epoch live in LLP 0072's external control authority and are
excluded from the application backup. Restore advances that authority first,
starts every queue paused, and prevents restored application code from
unpausing itself. The operator verifies target/profile identity, compatible
artifacts, clock sanity, and external integration posture before a separate
control-plane activation. Claims from the source deployment are superseded
under the new restore epoch; their fencing tokens are never reused.

Retention deletes canonical args and result bodies only after the declared
terminal window, leaving the minimal idempotency tombstone and audit digest for
at least 30 days and never less than the declared producer, client, provider,
webhook, or external replay horizon. The tombstone retains scoped key, complete
canonical digest, action/queue identity, terminal disposition, and successor
link. A subsystem may require longer or permanent minimal retention; generic
purge cannot violate it without an explicit destructive recovery override that
also disables reuse of the retired idempotency domain.

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

Each `durable-work-single-process-{sqlite,postgres}-v1` tuple requires
`SingleProcess` or better on that storage adapter. A local in-memory queue is
never durable evidence. SQLite, Postgres, multi-worker, and hosted-managed
claims are independent and cannot be inferred from another tuple's proof.

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
   `durable-work-single-process-sqlite-v1` receipt to serve as the reference
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
- SQLite passes the complete state-machine and fault corpus before
  `durable-work-single-process-sqlite-v1` may be claimed; Postgres must pass the
  same corpus independently before its own tuple may be claimed.

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

## Decisions still requiring ratification

The 2026-07-26 author-side review application proposes generated host-plan
actions only for the first implementation; a 30-day generic tombstone floor
that extends to every longer domain replay horizon; queue pause, restore epoch,
and deployment admission in the external control authority; `ambiguous` as a
terminal queue disposition plus domain-owned reconciliation; and independent
single-process SQLite and Postgres tuples, with SQLite first. These choices are
not accepted merely because they are written here. Independent storage/fault
review and maintainer ratification remain prerequisites before implementation
can satisfy LLP 0063.

Two additions from the 2026-07-30 Diary 0039 absorption (LLP 0115 CV-9):

- **Deterministic drive seam.** The admin surface (list/show/pause/resume/
  cancel/replay/drain) has no injected-clock manual-drive operation, and the
  acceptance corpus never requires frozen-clock determinism — yet the
  matrix's Dispatch arm proved recurring work without sleeping only because
  LLP 0028 has exactly that seam (`SNAPBACK_CRON_DISABLED` + admin manual
  tick). The first slice must add the sibling: an injected-clock forced
  drain that claims due jobs, so one-off work is provable without wall-clock
  waits. LLP 0028's pattern is the donor; the cron run ledger's identity
  model is not (runtime-created entries have no nominal slot or schedule
  hash).
- **Callee-class admission.** V1 admits generated host-plan actions only.
  Whether the Dispatch-style one-off shape (action performing egress, then a
  nested atomic mutation) fits that admission or requires the later
  broader-action capability must be named before the slice claims the
  Convex-parity use case rather than a narrower one.
