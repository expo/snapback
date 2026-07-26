# LLP 0070: Durable background work

**Type:** RFC
**Status:** Draft
**Systems:** Background work, Actions, Webhooks, Cron, Storage, Runtime, Auth, Secrets, Deployment, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review reconciliation: jobs and attempts
are separate; replay creates a successor instead of reopening terminal state;
the complete transition/CAS precedence, atomic fenced settlement, claim
supersession, deployment admission epoch, executable-artifact custody,
authorization revalidation facts, idempotency-retention floor, counter/slot
rebuild, deterministic retry/fairness algorithms, externally advanced restore
epoch, and independent SQLite/Postgres tuples are specified. The RFC remains
Draft pending independent review and implementation). 2026-07-23 (LLP 0086
CC-2b: dated candidate-assessment note added under §Capability classes — can
Cloudflare Dynamic Workflows carry this RFC's hosted profile; verdict
blocked-on, with the blocking facts named — plus the alarms-are-lossy
cross-reference to LLP 0028's same-day amendment; assessment only, no adoption
language). 2026-07-20 (initial proposal for LLP 0063's hosted application
platform)
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

- immutable app, database, target-profile, logical execution-domain, producer
  deployment, and stream identities;
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

Jobs and attempts are distinct durable objects. A `Job` is immutable intent
plus one current-state projection. Every claim creates an append-only
`Attempt` containing its claim, fence, worker deployment, timing, progress,
and terminal disposition. Operator replay or argument/artifact migration
creates a successor `Job` with a typed predecessor edge; it never changes the
predecessor's terminal state. The logical execution domain remains stable
across compatible deploys. Producer and worker deployment identities are
audit provenance, while target incarnation and restore epoch fence execution.

### State machine

The durable states are `pending`, `claimed`, `cancelRequested`, `ambiguous`,
`succeeded`, `dead`, and `cancelled`. `succeeded`, `dead`, and `cancelled` are
terminal and never reopen. `ambiguous` is quarantined: only a domain
reconciliation mutation may settle it, or an operator may create a linked
successor after recording why replay is safe.

Every transition is one compare-and-swap transaction over target incarnation,
restore epoch, execution domain, job id, state version, and—when claimed—claim
id plus fence:

| Current | Event and additional guard | Next | Required atomic work |
| --- | --- | --- | --- |
| `pending` | eligible claim; admitted artifact and free per-key slot | `claimed` | append attempt, increment fence/attempt, acquire slot, update counters |
| `pending` | authorized cancel | `cancelled` | terminal attempt fact and counter update |
| `pending` | hard deadline before claim | `dead` | deadline disposition and counter update |
| `claimed` | retryable result under current fence, attempts/time remain | `pending` | close attempt, release slot, set versioned jittered `availableAt` |
| `claimed` | terminal result, attempts exhausted, or incompatible/revoked artifact | `dead` | close attempt, release slot, update counters |
| `claimed` | authorized cancellation request | `cancelRequested` | retain claim and slot; signal is advisory |
| `cancelRequested` | worker proves no admitted effect began | `cancelled` | close attempt, release slot, update counters |
| `claimed` or `cancelRequested` | fenced terminal-result mutation commits | `succeeded` or `dead` | domain effect/idempotency row, outcome, state, counters, and slot in one transaction |
| `claimed` or `cancelRequested` | external effect may have committed but lookup cannot decide | `ambiguous` | quarantine, close attempt, release slot, record reconciliation key |
| `claimed` or `cancelRequested` | lease expires and a successor claims | `claimed` | atomically close old attempt as superseded, increment fence/attempt, and transfer slot |
| `ambiguous` | domain reconciliation proves outcome | terminal | commit the domain-owned settlement and audit fact together |

Success proven after a cancellation request still wins through the fenced
terminal-result mutation. A deadline prevents new effect initiation and
ordinary result publication after the deadline, but cannot relabel an
already-in-flight external effect; an unknown outcome becomes `ambiguous`.
Lease expiry alone changes no durable state. A successor atomically supersedes
the expired attempt and claims the job, avoiding an observable unclaimed
window. The successor preserves priority, uses the retry policy to choose the
next eligible time, increments attempt/fence exactly once, and transfers the
per-key slot in the same transaction.

A stale worker may append only a separately retained, rate/size-bounded,
redacted late diagnostic. It cannot publish progress, results, or
secret-bearing exception text after its fence is superseded.

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
process or external request. Reclaim is the atomic superseding transition in
the state table, never an unfenced `claimed → pending → claimed` sequence.
Every progress write, result mutation, per-key slot, and host-mediated effect
receives target incarnation, restore epoch, job id, claim id, and fence and
rejects stale publication. External systems that cannot consume a fence must
consume the stable job/command idempotency key.

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

The generated terminal-result mutation is the only ordinary settlement path.
In one storage transaction it:

1. verifies target incarnation, restore epoch, execution domain, job
   generation, state/version, claim/fence, deadline, and artifact admission;
2. inserts or verifies a stable job-effect idempotency record;
3. applies the domain result;
4. appends the attempt/outcome receipt; and
5. changes job state, capacity counters, and the per-key slot.

An action that needs multiple application mutations must give each effect a
domain idempotency identity and explicit checkpoint protocol. The queue makes
no cross-transaction atomicity claim. Fault injection stops before and after
every settlement step and proves either one committed settlement or safe
retry/reconciliation.

Retry jitter is portable and versioned as `snapback-job-jitter-v1`:
`HMAC-SHA256(jobIdBytes, frame("retry-jitter-v1", attemptU32BE))`; the first
64 digest bits are an unsigned big-endian integer, mapped without floating
point to the inclusive integer interval
`[floor(baseDelayMs * 3/4), floor(baseDelayMs * 5/4)]`, then capped by the
declared maximum and added to trusted server time. Attempt numbering starts at
one. Length-prefixed UTF-8 framing, integer rounding, overflow refusal, and
golden JS/Rust/SQL vectors are part of conformance.

### Artifact and deploy compatibility

Each job pins the generated action ABI and artifact digest admitted at enqueue.
A signed, content-addressed executable-artifact manifest binds the action code
and dependency closure, generated ABI and validator, authorization mode,
declared read/write sets, secret grants, target runtime/profile, revocation
status, and compatibility/migration policy. Digest presence alone is
insufficient: bytes, signature, dependency closure, and current admission must
all verify before enqueue, claim, and settlement. A revoked artifact
quarantines affected jobs as incompatible; retention never makes known-vulnerable
code runnable merely because an old row names it.

The control authority owns a monotonic deployment/queue admission epoch with
admitted producer and worker digest sets. Producers may enqueue only a digest
admitted by the current epoch, and workers may claim only a digest their
manifest and the epoch both admit. Activation changes the admission epoch and
traffic-routing generation under one durable deploy fence. Its preflight names
the old/new compatibility intersection and pending-job census, but that census
is evidence rather than synchronization. Rollback acquires the same fence and
cannot admit old traffic while new-only enqueue remains possible.

Rolling deploys may run old and new workers concurrently only when claim fences
and the admission epoch explicitly names their compatibility intersection.
Rollback must retain a compatible worker for jobs enqueued by the newer version
or fail closed before routing old traffic. Arguments are immutable; migration
creates a successor job with a fresh idempotency domain and current artifact
admission, links it to the old job, and terminally disposes the predecessor
with an audit reason.

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

Every enqueue, claim, supersession, settlement, cancellation, purge, replay,
restore, and migration updates authoritative rows, counters, and per-key slots
under one transaction invariant. Slots carry target incarnation, restore epoch,
key digest, job/attempt, claim, fence, and expiry. A registered read-only check
re-derives counters and slots from job/attempt rows; an authenticated repair
operation requires a same-snapshot dry-run digest, pauses the queue, and
atomically rebuilds them. Admission and claiming fail closed on mismatch.

The v1 scheduler uses weighted deficit round robin across queue classes and
FIFO-with-aging within a queue. Each nonempty class gains its declared positive
integer quantum on every scheduler round; one claim costs one unit. Within a
queue, each 60 seconds of trusted ready age raises effective priority by one up
to the declared priority maximum. A continuously eligible job is therefore
serviced within
`sum(activeClassWeights) * (priorityRange + 1) * maxClaimBatch`
successful claim opportunities, absent a saturated per-key slot. Target
receipts measure that bound under adversarial arrivals; adapters may use a
different algorithm only under a new profile/version.

Target reports include queue capacity, byte capacity, concurrency, rate limits,
lease bounds, oldest age, ready depth, claimed depth, ambiguous/dead depth,
counter/slot check status, starvation-bound observations, and saturation
counts.

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

`revalidatePrincipal` records a credential-free principal/authority subject,
tenant and resource identities, named policy plus schema/version, and every
authorization invalidation dependency required to recompute the current
decision. Each attempt evaluates the current policy and dependencies; the
enqueue-time decision is provenance, never current authority.

`capturedGrant` records issuer, audience, operation/resource ceiling,
not-before/expiry, generation, revocation identity, and policy-version facts.
Every attempt checks expiry and revocation. Expiry or revocation while an
external effect is in flight routes an unknown outcome to domain
reconciliation; it never guesses that the effect failed.

All queue and job ids are scoped to app, database, target, deployment, and
stream. Here `deployment` in an access decision means the stable logical
execution domain plus admitted deployment epoch—not equality with the producer
deployment—so a compatible successor worker can claim without weakening
cross-target isolation. Inspection, cancel, replay, drain, and purge operations
use the admin lane. Public status projects only jobs an application policy
allows the caller to observe.

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
superseded through a new restore epoch; their fencing tokens are never reused.
The restore epoch is allocated by the control authority outside the restored
snapshot and durably advanced before any restored app or worker may connect.
Target incarnation plus restore epoch participates in every claim, renewal,
progress/result mutation, per-key slot, host effect, and admin action. Restoring
an older database over the same logical target therefore cannot resurrect a
valid old fence.

Retention deletes canonical args and result bodies only after the declared
terminal window, leaving the minimal idempotency tombstone and audit digest for
the longest declared producer or external replay horizon. The tombstone retains
the complete canonical digest, queue/action/execution-domain identity, terminal
disposition, and predecessor/successor links; deleting it while the key can be
retried is forbidden. The v1 subsystem floor is 90 days. A domain such as
payments or webhooks may require longer or permanent retention, and generic
purge cannot shorten that horizon without an explicit destructive recovery
override recorded against the domain authority.

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

`durable-work-single-process-v1` requires `SingleProcess` or better and is
instantiated as independent storage tuples:
`durable-work-single-process-v1/sqlite` and
`durable-work-single-process-v1/postgres`. Each runs the same semantic and
fault corpus and may qualify independently; one does not gate or imply the
other. A local in-memory queue is never durable evidence. Multi-worker and
hosted-managed claims are independent and cannot be inferred from the
single-process proof.

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
- fault injection around every generated terminal-result commit boundary proves
  that the domain effect, idempotency row, attempt receipt, state, counters, and
  per-key slot settle together;
- an expired worker loses its fence and cannot publish after a successor claim;
- reclaim atomically supersedes the old attempt, increments attempt/fence once,
  and transfers the per-key slot without an observable pending window;
- process restart, graceful drain, forced kill, deploy, and rollback preserve
  the state machine, deployment admission epoch, signed artifact custody, and
  compatibility intersection;
- bounded retries, deterministic jitter, deadlines, cancellation, dead-letter,
  operator replay, and per-key concurrency behave exactly as declared;
- JS, Rust, and SQL golden vectors agree on `snapback-job-jitter-v1`, and the
  adversarial scheduler corpus stays within the frozen starvation bound;
- capacity admission rolls back the producing mutation and one saturated queue
  cannot consume reserved system capacity;
- row/counter/slot mismatch fails closed and the paused same-snapshot rebuild
  restores the invariant without changing job intent or attempt history;
- principal revocation, cross-app/database/target/stream ids, stale grants, and
  unauthorized inspection/control fail closed;
- secret values and webhook signing material do not appear in payloads, rows,
  logs, diagnostics, backups, or receipts;
- inbound duplicate capture and outbound duplicate delivery converge through
  stable event/idempotency ids;
- backup, destroy/replace, restore-paused, compatibility preflight, and explicit
  activation preserve a pinned job/result corpus, while an old restored fence
  remains invalid at the same logical target; and
- SQLite and single-process Postgres each run the same state-machine and fault
  corpus before that storage tuple may claim the profile.

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
2. Which control-plane object owns queue pause and the deployment admission
   epoch so invalid app code cannot unpause or bypass it? This must be resolved
   with LLP 0072 before acceptance.
3. What signed-manifest revocation policy allows a compatible old job to run
   without preserving known-vulnerable code indefinitely?
4. Should a later Postgres profile add multi-worker admission, or remain
   single-process until a separately reviewed distributed-fairness contract?
