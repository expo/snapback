**Reviewer family:** GPT (author-side pass; not independent)
**Provider / runtime:** OpenAI Codex API agent
**Date:** 2026-07-26
**Redacted:** no
**Method:** manual

# Review of LLP 0070: Durable background work

This is an author-side critical pass over the committed Draft at Snapback
`42ba4d501f31e089018b210c2c675db8891a59a3`. Because the draft is attributed
to Charlie Cheever / Codex, this review does **not** count as the independent
cross-family review appropriate for a durable execution and recovery
protocol.

## Overall assessment

The RFC has the right core: transactional enqueue, at-least-once execution,
fenced claims, stable idempotency at external boundaries, bounded retry,
artifact compatibility, explicit authority modes, and restore-paused
recovery. Keeping cron as schedule authority and making domain RFCs retain
their own state machines is particularly good.

The normative state machine is incomplete and internally contradictory. It
calls terminal state immutable while allowing `dead → pending`; it introduces
`cancelRequested` without defining its exits; and it does not pin the atomic
relationship between a fenced result mutation and job completion. Artifact
activation also has a time-of-check race with concurrent enqueue. These must
be resolved before implementation because different workers/storage adapters
would otherwise make different durability guarantees.

## Strengths

- `## Job identity and enqueue` correctly makes queue admission share the
  producer mutation's transaction and rejects changed-byte idempotency reuse.
- `## Claims and fencing` recognizes that lease expiry cannot terminate the
  old process and requires fences on later publication.
- `## Execution and retries` distinguishes ambiguous external effects from
  ordinary retryable failures and forbids generic queue code from guessing.
- `## Artifact and deploy compatibility` treats queued ABI/artifact identity
  as a deployment constraint rather than silently running old payloads on new
  code.
- `## Authorization and isolation` avoids serializing end-user credentials and
  provides explicit system/revalidation/captured-grant modes.
- `## Inspection, audit, and recovery` starts restored queues paused and
  requires a new restore epoch before claims resume.
- The hosted-candidate section is appropriately skeptical and identifies the
  transactional-outbox and platform-timer gaps rather than inferring support.

## Concerns

### Critical — terminal immutability contradicts `dead → pending`

The state-machine section says terminal state is immutable, then permits
`dead → pending` for operator replay. It also says replay creates a "new
attempt generation," without defining whether this mutates the dead job,
creates a successor job, or appends an attempt row.

Keep the original job terminal. Operator replay should transactionally create
a new successor job/generation with:

- a fresh `jobId` or an explicit `(jobId, generation)` identity;
- a new enqueue idempotency domain;
- a typed predecessor link and reason;
- copied or explicitly migrated canonical args/policy;
- a fresh artifact compatibility check; and
- no erasure or reopening of the dead predecessor.

The state diagram and every counter/retention rule must use the same choice.

### Critical — fenced result publication and completion are not one specified transaction

The RFC says result mutations receive the fence, but it does not require the
application result effect and `claimed → succeeded` transition to commit
together. If a worker commits an application mutation, crashes, loses its
lease, and a successor reruns the action, the system can publish the effect
twice even when the stale worker is later prevented from marking success.

Define a generated terminal-result mutation that atomically:

1. verifies app/database/target/stream/restore epoch, job generation, state,
   claim id, fence, and artifact;
2. applies the domain result using a stable job-effect idempotency record;
3. appends the attempt/outcome receipt; and
4. transitions the job to its terminal or retry state.

Actions needing multiple mutations must use domain idempotency on each effect
and an explicit checkpoint protocol; the queue cannot imply atomicity across
them. Fault tests must cover every commit boundary.

### Critical — deployment compatibility admission has a concurrent-enqueue race

Activation may check that all pending jobs use supported digests, but an old
producer can enqueue another old-only job immediately after that check while
traffic and workers roll. Conversely, a new producer can enqueue a new-only
job before a rollback compatibility check completes.

Add a versioned deployment/queue admission epoch:

- producers may enqueue only artifact digests admitted by the current epoch;
- activation changes the admitted producer/worker digest sets atomically with
  routing or under a durable deploy fence;
- workers claim only digests their manifest proves;
- rollback preflight is fenced against new-generation enqueue; and
- old/new overlap has an explicit compatibility intersection.

A point-in-time query over pending rows is evidence, not the synchronization
mechanism.

### Major — `cancelRequested` and deadline races have no complete outcomes

The RFC defines entry into `cancelRequested` but not transitions from it or
the precedence among success, terminal failure, cancellation, lease expiry,
and deadline. A cancellation signal cannot undo an external effect already in
flight. A worker can observe cancellation, stop locally, and later receive a
successful provider response.

Specify a CAS transition table. At minimum:

- pending cancellation can win atomically before claim;
- claimed cancellation is a request, not proof of no effect;
- a verified completed effect may still produce success after the request;
- unknown external outcome produces an ambiguity/manual-reconciliation state,
  not `cancelled`;
- deadline stops new work/publication but cannot classify an in-flight
  external result; and
- successor claims cannot start until the prior lease/fence rule permits them.

Add a durable `ambiguous`/domain-reconciliation disposition or make it a
required domain-owned terminal result with a clear queue state.

### Major — claim expiry/reclaim is not an executable transition

The text says expired `claimed` jobs become eligible and also lists
`claimed → pending` after expired lease. Define whether a worker:

- first CASes an expired claim back to pending, then claims it; or
- atomically supersedes the claim and increments the fence in one transaction.

The second avoids an observable unclaimed window. Whichever is selected must
pin attempt-number increments, priority/available-at behavior, audit rows,
per-key slot transfer, and stale-renewal rejection.

### Major — artifact digest pinning lacks executable artifact custody

A digest says which bytes are wanted, not where trusted executable bytes come
from or whether their dependencies, generated `uses` grants, schema ABI, and
runtime profile are still admissible. Retaining arbitrary old app code can
also retain revoked behavior or secret access indefinitely.

Define a signed/content-addressed artifact manifest that binds action code,
dependency closure, generated ABI, validator, authorization mode, read/write
sets, secret grants, target runtime, and compatibility/migration policy.
Activation must prove the bytes are present and admitted. A revoked artifact
must quarantine work; it must not merely remain runnable because a row names
its digest.

### Major — job deployment identity conflicts with rolling execution

Every job is scoped to an immutable deployment identity, while the RFC expects
later compatible deployments to execute it. Distinguish:

- producer deployment (audit/provenance);
- logical queue/execution domain (stable across compatible deploys);
- worker deployment (claim provenance); and
- restore epoch/target incarnation (fencing).

If the producer deployment remains part of access scope, define exactly how a
successor deployment is authorized to claim it without weakening cross-target
isolation.

### Major — authorization revalidation inputs are not durable facts

`revalidatePrincipal` is the fail-closed default, but the job needs a
credential-free identity and resource/policy input sufficient to repeat the
current decision. Pin the principal/authority subject, tenant/resource ids,
named policy, relevant policy schema/version, and invalidation dependencies.
Do not re-use enqueue-time authorization as current authority.

`capturedGrant` also needs issuer, audience, operation/resource ceiling,
not-before/expiry, generation, revocation identity, and attempt-time
revocation checks. Expiry or revocation during an ambiguous external effect
must route to domain reconciliation, not a guessed failure.

### Major — idempotency tombstone lifetime is domain-dependent

Generic retention cannot safely delete the digest behind an enqueue
idempotency key while producers or external systems can still retry it. After
deletion, the same key could create a second job. Retain at least key, complete
canonical digest, action/queue identity, terminal disposition, and successor
link through the declared producer/external replay horizon.

The generic subsystem should enforce a floor; domains such as payments and
webhooks may require longer or permanent audit retention. Open question 2
must close before acceptance.

### Major — queue capacity counters and per-key slots need recovery invariants

Transactionally updated counters are only correct if every enqueue, terminal
transition, cancellation, purge, replay, restore, and migration updates them
under one invariant. Per-key concurrency slots likewise need generation,
lease/fence, reclaim, and restore rules. Add a rebuild/check operation that
derives counters/slots from authoritative rows and fails closed on mismatch.

Fault tests should stop between every row/counter/slot mutation; storage
adapters must not implement these as eventually reconciled hints if admission
depends on them.

### Moderate — fairness and priority claims are not defined

"Bounded fairness" and "cannot create unbounded starvation" need an algorithm
and measurable bound: for example weighted deficit round-robin across queue
classes with an aging rule and a maximum number of higher-priority claims
before an eligible lower-priority job is serviced. Without a bound, two
adapters can both claim conformance while one starves.

### Moderate — deterministic jitter needs a versioned formula

Pin hash, input framing, attempt numbering, range mapping, rounding, and
trusted-time application. Otherwise JS/Rust/SQL implementations can schedule
different retries from the same job. Include golden vectors.

### Moderate — progress and late diagnostics require bounded non-authoritative storage

Progress must be explicitly non-authoritative, size/rate bounded, redacted,
and fenced. Late diagnostics from stale workers must not contain results or
secret-bearing exceptions and should have a separate retention class.

### Moderate — restore fencing must survive replacement at the same target

A database restore can roll back per-job fencing tokens. The restore epoch
must be part of every claim, renewal, result mutation, per-key slot, host
effect, and admin action, and it must come from authority outside the restored
snapshot or be advanced atomically before workers can connect. Target identity
alone is insufficient when replacing the same logical target.

### Moderate — the first profile should not require an unproved Postgres tuple

Acceptance currently requires both SQLite and single-process Postgres before
either may claim the profile, while the Summary names SQLite or Postgres
storage. Decide whether these are separate target tuples under one semantic
suite. Coupling them may delay a correct SQLite profile without strengthening
its evidence.

## Suggestions

1. Add a normative transition table containing current state, event, guards,
   next state, fence/version changes, counter/slot changes, and allowed domain
   effects.
2. Model jobs and attempts separately: immutable Job intent, append-only
   Attempt/Claim records, one current-state projection, and successor Jobs for
   replay/migration.
3. Implement the deterministic conformance store/worker with a complete
   fault-injection matrix before wiring real domain handlers.
4. Make the single-process runtime use the same claim/fence protocol even
   though an in-memory shortcut would be easier; otherwise the first proof
   does not exercise the contract.
5. Treat platform timers as lossy wakeups over a durable ready-job query on
   every target, as the hosted-candidate section already recommends.

## Open questions for the author

1. Is an ambiguous external outcome a queue state, a required domain result,
   or both?
2. Which authority stores queue pause and the deployment admission epoch so
   invalid app code cannot unpause or bypass it?
3. What artifact retention/revocation policy allows old jobs to run without
   preserving known-vulnerable code indefinitely?
4. Should SQLite and Postgres be independent profile tuples with identical
   semantic conformance?

## Recommended next step

Revise and remain `Draft`. Resolve the terminal/replay contradiction, atomic
result publication, cancellation/deadline table, claim supersession,
deployment admission epoch, artifact custody, restore epoch, authorization
revalidation, and idempotency-retention rules. Then obtain an independent
non-GPT review and a storage/fault-injection review before the author
considers `Accepted`.
