# LLP 0070: Durable background work

**Type:** RFC
**Status:** Review
**Systems:** Background work, Actions, Webhooks, Cron, Storage, Runtime, Auth, Secrets, Deployment, Admin, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-08-23 (author ruling: outbound webhooks advertise
at-least-once delivery; stable idempotency keys enable cooperative receiver
deduplication but never an exactly-once claim).
2026-08-02 (CV-9 executable-evidence amendment: the shipped
single-process SQLite slice now retains a file-backed crash/reopen witness.
It commits and claims attempt 1, closes the only connection without a finish,
reopens the same database, advances to the stored lease boundary, atomically
records `lease_expired` / `SNAPBACK_JOB_LEASE_EXPIRED`, allocates attempt 2
with a strictly greater fence, rejects the stale first publication, and
persists attempt-2 success plus the terminal job projection. This closes the
crash/reopen evidence remainder for the runAfter-class slice without adding a
`ctx.scheduler` alias or widening the complete-RFC capability claim.)
2026-08-01 (loop CONVERGED dual-family READY — Fable round 1,
Codex round 3, zero unresolved concerns; artifacts
reviews/0070-durable-background-work.{fable,codex}.md. Status
advances Draft -> Review with the shipped first slice absorbed and
reality-reconciled; acceptance is the author's call.) 2026-08-01 (v3, Codex round-2 application: the shipped/future
boundary block now scopes its normative-shipped claim to §First slice as
shipped precisely, instead of "everything above" — which had wrongly
encompassed the Summary's future-subsystem prose; the §Semantics enqueue
rule repeats the literal idempotency tuple (canonical-args SHA-256 digest
plus `maxAttempts`, with `delayMs`/`availableAt` excluded) rather than the
looser "attempt policy" gloss, and the guide's "byte-identical canonical
args" is corrected to digest equality; the A6-04 evidence row states "one
observed execution and no rerun on a repeat drain — a single-run
observation, not an exactly-once-effects claim". Status stays Draft.)
2026-08-01 (v2, round-1 review application: both round-1
reviews applied — Fable READY with five minor findings, Codex NOT READY
with three material and two lesser. Codex M1: idempotency scope and
equivalence settled to what `crates/snapback/src/jobs.rs`/`crates/snapback/src/runtime.rs` actually do —
keys scoped to (queue, action), the identical-reuse fingerprint is the
canonical-args digest plus `maxAttempts`, `delayMs`/`availableAt`
deliberately excluded, a different action is a different scope and creates
an independent job — with the body §Semantics telling, the shipped
section, and the guide aligned to that one tuple. Codex M2: an explicit
shipped/future boundary now precedes §Semantics; everything after it is
the proposed complete contract unless §First slice as shipped says
otherwise; the host-plan-only admission sentence is rewritten primary
rather than corrected parenthetically, and the honest-gaps list is marked
non-exhaustive with the present-tense §Semantics machinery it does not
repeat. Codex M3 / Fable F1: the drain is documented at its shipped bound
— up to 64 claims per wave, `maxWaves` silently clamped to 1..=16, waves
serving both cascade depth and pagination of a large due set, ceiling
64×waves per call. Codex SF: evidence attribution mapped precisely
(A6-04 → enqueue/drain/association; RV-A6-F1 → job-status boot/live;
RV-A6-F2 → guide/dedup/lease custody; the zero-advisory result contract
is later in-tree codegen-suite evidence, not part of the external 0.1.8
pass). Codex detail: attempt rows are append-only identities with a
one-time terminal completion, not literally append-only storage. Fable
F2: the shipped lifecycle-state union is stated with its unreachable
`cancelled` member and planned `ambiguous` widening; F3: the job-status
projection's producer association is scoped to three fields with
`producerPrincipal` durable but privacy-excluded; F4: realistic receipt
example timestamp; F5: secret-read-root lifecycle cross-reference noted
against the open g1-f5 ticket. Status stays Draft.)
2026-08-01 (first-slice absorption: the dated 2026-07-31
amendment note's spec text — enqueue-association receipt shape, callee-class
admission, deterministic drain seam, paved default queue, inspection
surfaces, idempotency narrowing, honest gaps, capability posture — is
absorbed into the body as §First slice as shipped, reconciled against what
actually landed since: the e25ab2a3 slice landing, the 01ddd8e2 job-status
boot-admission fix and the platform-owned job-status result contract, the
secret-read-lease custody on admin jobs inspection, the bdf4763c cron
epoch-seeding fix with LLP 0028's amended §Inspection and the still-open
a4-f4 downtime-recovery trusted-clock question, the experimental
`jobs_one_off_v1` registration, and the A6 arm plus 0.1.8 re-verification
receipts. The two 2026-07-30 additions under §Decisions still requiring
ratification are marked resolved by the shipped slice; the amendment file is
tombstoned as a pointer. Status stays Draft — ratification is the review
loop's call, and no durable-background-work capability class is claimed.)
2026-07-30 (Diary 0039 competitive evidence and first-slice
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
**Related:** LLP 0003, LLP 0004, LLP 0007, LLP 0009, LLP 0012, LLP 0014,
LLP 0018, LLP 0028, LLP 0034, LLP 0036, LLP 0044, LLP 0045, LLP 0046,
LLP 0047, LLP 0051, LLP 0058, LLP 0063, LLP 0069, LLP 0083, LLP 0086,
LLP 0087, LLP 0094, LLP 0115, LLP 0121, LLP 0127, LLP 0137

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

## First slice as shipped (2026-07-31; absorbed 2026-08-01)

This section is normative for the implemented surface. It absorbs the dated
2026-07-31 amendment note (now a tombstone pointer at
`llp/0070-durable-background-work.amendment-2026-07-31-first-slice.md`)
and reconciles it against everything that landed through 2026-08-01. The
slice landed as e25ab2a3 (`crates/snapback/src/jobs.rs`, storage/runtime/server wiring,
codegen jobs authoring) and was completed by the 01ddd8e2 job-status
boot-admission fix. The executable evidence maps as follows:

- **A6-04-SCHEDULING** (external-consumer LLP 0137 A6 arm, 10/10 on the
  public 0.1.7 closure;
  `demos/improvement-sweep/arms/a6-snapback-web/run-capsule.json`):
  transactional enqueue, the bounded `enqueues` receipt fact, producer
  association, the injected-clock drain (one observed execution and no
  rerun on a repeat drain — a single-run observation, not an
  exactly-once-effects claim), and the admin lane — while the declared
  job-status query boot-refused on that closure (the a6-f1 defect
  01ddd8e2 fixed).
- **RV-A6-F1** (0.1.8 re-verification;
  `demos/improvement-sweep/arms/reverify-0.1.8/run-capsule.json`): the
  job-status boot fix verified externally — the declaring app boots and
  the projection serves live transitions.
- **RV-A6-F2** (same capsule): the guide recipe, idempotent-enqueue
  dedup, and the secret-read-lease custody route.
- **In-tree suites** (`crates/snapback/src/jobs.rs`/`crates/snapback/src/server.rs`/`crates/snapback/src/local.rs` tests,
  `packages/snapback-codegen/jobs-authoring.test.mjs`): the state-machine
  and fault corpus, rollback-schedules-nothing, drain receipts, admission
  narrowness, and — later than the 0.1.8 pass — the platform-owned
  job-status result contract with zero degraded advisories.

**2026-08-02 crash/reopen evidence.**
`crates/snapback/src/jobs.rs::tests::file_backed_crash_reopen_expires_attempt_and_fences_successor`
extends the first-slice fault corpus across a real SQLite close/reopen
boundary. The fixture leaves attempt 1 claimed with no finish, proves the
persisted lease remains exclusive until its exact boundary, then proves the
successor transaction records attempt 1 as `lease_expired` with
`SNAPBACK_JOB_LEASE_EXPIRED` before creating attempt 2 at a strictly greater
fence. A retained pre-crash claim cannot publish, while attempt 2 can finish
and the reopened database exposes the exact two-attempt ledger and terminal
job state. This is evidence for the shipped first slice only; the broader
restart/deploy/artifact corpus in §Acceptance and the complete
`durable-work-single-process-sqlite-v1` tuple remain unclaimed. The witness
passes through the existing storage state machine unchanged, so no production
code or parallel `ctx.scheduler` vocabulary is warranted by this delta.

The RFC remains Draft; nothing here claims a durable-background-work
capability class or the `durable-work-single-process-sqlite-v1` tuple
(§Capability posture below). The authoring surface is documented for
consumers in `guide/backend/jobs.md`.

### Enqueue-association receipt shape (0127 decision 7 — 0070-owned)

Both halves of LLP 0121 option 3 ship, with the job side durable and the
mutation side bounded.

**Job-side (durable, unbounded-cardinality-safe).** Every job row carries
its producer association, immutable from insertion:

- `producerMutationId` — the exact `mutationId` the producing mutation's
  receipt carries (the client mutation id when the client supplied one;
  otherwise the server-minted receipt id). One identity names both halves.
- `producerSnapshotVersion` — the committed storage version the producing
  mutation's receipt reports as `snapshotVersion` (LLP 0034 §3.2); equal
  for enqueue-only commits and write-carrying commits.
- `producerFunction` — the producing mutation's declared name.
- `producerPrincipal` — the resolved auth user id, when one existed
  (provenance only, never execution permission; the enqueue-time
  authorization rule in §Authorization and isolation is unchanged).

"What did mutation M schedule" resolves from the job side by producer id;
the association is provable without growing the bounded receipt ring.

**Mutation-side (bounded, rollback-evidencing).** The mutation receipt
(`Receipt::Mutation`, LLP 0034 §3.2 family) gains one optional field:

```json
"enqueues": [
  { "jobId": "…", "action": "notify", "availableAtMs": 1785578000000 }
]
```

- Present only on **confirmed** receipts that enqueued at least one job;
  omitted when empty (the pinned pre-jobs wire shape is byte-identical).
- Bounded by construction: v1 caps enqueues at 16 per mutation, so the
  ring's size posture is preserved.
- Privacy (§3.3 discipline): opaque job ids, the declared action name, and
  the availability timestamp — never argument values or payloads.
- A **rejected** receipt never carries the field, and rollback leaves no
  job rows: the receipt pair is the inspectable form of
  rollback-schedules-nothing — evidence Convex's bare returned ID does not
  give (LLP 0121 finding 10). The A6 arm observed exactly this pair on the
  packaged closure (A6-04-SCHEDULING).

**Wire projection.** The field rides the existing receipt surfaces
(receipts snapshot, live subscribe/unsubscribe echoes, mutation-response
receipt) under LLP 0094's ordinary envelope rules;
`schemas/receipt.schema.json` is regenerated from the Rust type. No new
envelope kind is introduced.

### Callee-class admission (LLP 0121 OQ2 — decided)

V1 admits **manifest-declared actions only**, in **both** runtime forms —
HostPlan-planned actions and Ibex JS actions — because both execute under
the generated host envelope (declared writes, `uses` grants, LLP 0009/0047
limits) that "generated host-plan actions only" exists to guarantee. This
reading admits the Dispatch shape the diaries measured: an action
performing egress and applying durable effects through `ctx.runMutation`,
exactly as cron already invokes actions today.

Not admitted in v1 (fail closed at staging, before any commit work):

- direct **mutation** callees (`SNAPBACK_JOB_CALLEE_NOT_ADMITTED`) — the
  later broader-callee capability;
- **query** callees (same code) — queries are never schedulable;
- undeclared names (`SNAPBACK_JOB_ACTION_UNKNOWN`).

A parity statement against Convex must therefore say: enqueue-side parity
with `runAfter` for **action** callees; Convex's scheduled-mutation
exactly-once class is intentionally not matched (LLP 0121 finding 11 —
this RFC is uniformly at-least-once with fenced attempts and idempotency
keys).

### Deterministic drain seam (0121 OQ5/OQ9 — decided)

- **Shape:** set-based, not slot-based. `POST /_snapback/api/jobs/drain`
  with body `{ nowMs?, maxWaves? }` claims due jobs
  (`availableAt <= nowMs`) in pinned order **up to the claim batch of 64
  per wave**, executes each claim, publishes each terminal transition,
  and returns the drain receipts synchronously. Due-ness, lease
  arithmetic, retry `availableAt`, and attempt timestamps are pure
  functions of the injected clock — acceptance never sleeps. One drain
  call's ceiling is therefore 64 × waves; a due set larger than that
  needs further calls.
- **Waves and bound:** bounded waves (default 1; `maxWaves` outside
  1..=16 is silently clamped, not refused), never run-to-quiescence; a
  wave ends early only when a claim returns empty. Waves serve **both**
  purposes: jobs enqueued by a wave's actions become claimable by the
  next wave when due (cascade depth), and a pre-existing due set larger
  than 64 is paginated across successive waves by the same mechanism.
  Nontermination is refused by the cap, not detected.
- **Determinism bar (OQ9):** deterministic externally observable outcomes
  plus stable job identity — not byte-identical rows. Job ids are
  allocated through the invocation's ctx-answer ledger (LLP 0051 D1), so
  enqueue replay reproduces them and tests can assert on returned ids.
  Claim order is pinned: `availableAt` ascending, then canonical job-id
  bytes. Claim ids remain random and are explicitly **non-normative**
  (provenance on attempt receipts; no assertion may depend on them).
- **Flags (OQ5):** `SNAPBACK_JOBS_DISABLED` is the sibling of
  `SNAPBACK_CRON_DISABLED`, deliberately separate: cron and jobs are
  separate subsystems with separate ledgers. The autonomous jobs worker is
  its own one-second loop (the ticker-as-wakeup posture of LLP 0121
  option 2 case 3 — the loop is a wakeup; the job/attempt rows are the
  only evidence). Interactive latency for `availableAt = now` jobs is
  therefore bounded by ~1s in the single-process profile (OQ6's v1
  answer, a reported fact, not a contract).
- **Cron cross-reference (2026-08-01).** The donor seam's own clock
  hazard was fixed at source: a never-run `everyMs` cron job now seeds its
  first nominal at the most recent epoch-aligned slot rather than slot 0
  (bdf4763c; LLP 0028 §Inspection and query surface, amended 2026-08-01
  per 0137 a4-f4), so a catch-up run's nominal-bound trusted clock is
  within one interval of wall clock. Whether a **downtime-recovery**
  catch-up run (a stale persisted nominal) should also clamp its trusted
  clock remains LLP 0028's open design question; the jobs drain seam is
  unaffected because drain clocks are injected per call, but any future
  jobs downtime-recovery policy must answer the same question rather than
  inherit an implicit one.

### Paved default queue (0121 OQ1 — decided)

`ctx.jobs.enqueue(action, args, options?)` requires zero app-side
declaration. Every v1 job lands on the `default` queue with paved
published limits: 16 enqueues/mutation, 64 KiB canonical args, 30-day
delay horizon, attempts 1..=8 (default 1), 30 s lease, claim batch 64,
backoff base 1 s capped 60 s with the RFC's v1 jitter profile (ceiling
1000 ms). This RFC's full queue-declaration machinery remains RFC-only;
when it lands, the `default` queue becomes a declared queue with these
values as defaults.

### Inspection surfaces (0121 OQ3 — decided)

Two surfaces, per LLP 0121's four-way split:

- **Job-lifecycle visibility to product code:** a **generated declared
  job-status query** (`defineJobStatusQuery({ auth })` →
  `HandlerPlan::JobStatusQuery`) — an ordinary declared operation with an
  ordinary contract, live-capable through the ordinary subscription
  machinery; never an ambient system table. The projection is
  privacy-bounded lifecycle facts only (ids, action/queue names, state,
  counters, timestamps, diagnostic codes, and the producer association's
  `producerMutationId`/`producerSnapshotVersion`/`producerFunction` —
  `producerPrincipal` stays durable row provenance, deliberately
  privacy-excluded from the projection) — never argument values or
  results. The shipped lifecycle-state union is the literal
  `pending | claimed | succeeded | dead | cancelled`: `cancelled` is
  emitted in the type but **unreachable** in v1 (cancellation is on the
  honest-gaps list), and `ambiguous` is absent, to be widened into the
  union later under the experimental acknowledgment when that terminal
  state ships. V1 authorization vocabulary: the
  operation's own declared auth requirement plus knowledge of the opaque
  job id; per-job row-level policy is a later vocabulary. Two facts
  landed after the amendment note and are part of the shipped contract:
  the reserved `_snapback_jobs` logical stream the generated plan reads
  is admitted by the load-time schema-reference preflight **only** for
  read positions on JobStatusQuery-runtime functions (01ddd8e2, fixing
  the A6 f1 boot refusal; writes naming it, and any other runtime
  declaring it, keep the refusal), and the generated plan carries its own
  complete platform-owned result contract (a literal lifecycle-state
  union in the emitted types), so declaring the query is the whole
  authoring step with zero degraded advisories (see the closed ticket
  `20260801-0137-reverify-jobstatus-declaration-degraded-advisory.md`).
- **Operator/acceptance inspection:** the admin lane —
  `GET /_snapback/api/jobs`, `GET /_snapback/api/jobs/{id}` (job plus its
  attempt history: append-only attempt identities with a one-time
  terminal completion — a row is inserted at claim and completed once
  with its outcome, one row per attempt, never rewritten thereafter),
  and the drain endpoint's synchronous receipts. In **sessions auth
  mode** these reads can carry application-adjacent data, so the admin
  token alone is deliberately insufficient: the request must also
  present an operator-minted, TTL- and budget-bounded secret-read lease
  (`x-snapback-secret-read-lease`, minted through the ready-file-only
  CLI proof), or it refuses with `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`.
  Dev auth mode takes the ordinary admin credential. This custody landed
  with the slice's fix lane and is the shipped admin-lane posture for
  jobs inspection. (Custody-lifecycle cross-reference: the chain's proof
  root, `<ready>.secret-read-root`, is a descriptor-scoped sidecar —
  removed at server teardown with its parent ready descriptor, per the
  LLP 0017 custody split, unlike the reattach-by-design `<db>.*`
  sidecars. The G1 arm observed the pre-fix orphaning; fixed and
  regression-pinned per the closed ticket
  `20260801-0137-g1-orphaned-secret-read-root-sidecar.md`, with the
  packaged closure picking the fix up at the next release cut.)

Domain-result reactivity needs nothing here (it falls out of the terminal
mutation, as LLP 0121 established); producer correlation is the
enqueue-association section above.

### Idempotency-key semantics, as shipped

The shipped contract is one exact tuple (this is also the normative
telling for §Semantics' enqueue rule above):

- **Scope.** A key is scoped to `(queue, action)` — in v1, queue is
  always `default`. The **same key under a different action is a
  different scope**: it never matches, never fails, and creates an
  independent job. (The `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`
  diagnostic's prose mentions "different action" loosely; the scope rule
  above is what executes.)
- **Identity fingerprint.** Within one scope, an enqueue is *identical*
  when the canonical-args SHA-256 digest **and** `maxAttempts` both
  match. `delayMs` (and therefore the derived absolute `availableAt`) is
  **deliberately excluded**: a re-enqueue of the same intent with a
  different delay returns the existing job with its original
  `availableAt`, `deduplicated: true`.
- **Identical reuse** resolves at handler execution time against the
  read snapshot (including read-your-enqueues within the same
  invocation's buffer) and returns the existing job.
- **Divergent reuse** — same scope and key, but digest or `maxAttempts`
  differs — fails closed with `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`, at
  handler time and again at commit.
- **Commit-time race.** If an identical job under the same scoped key
  lands between the handler's snapshot and its commit, the commit fails
  closed with the typed `SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED`; a retry of
  the mutation converges on the existing job.

### What the slice deliberately does not implement (honest gaps)

All of the following remain RFC-only; the claim boundary stands and
nothing below is claimed by any capability fact:

queue declarations and capacity counters/admission (a saturated queue
cannot yet refuse enqueue); per-key concurrency slots; cancellation (both
cases); the `ambiguous` terminal state and domain reconciliation;
deadlines; operator replay / successor jobs; retention windows and
idempotency tombstones; inbound webhook capture machinery; the
`revalidatePrincipal` / `capturedGrant` authorization modes (v1 executes
callees as the same system authority cron actions use); artifact-digest
pinning and queue-admission epochs; restore fences; Postgres and every
hosted/multi-worker tuple (hosted stays blocked-on per the Dynamic
Workflows assessment below).

This list is **not exhaustive**: the design sections after the boundary
below also describe, in present-tense contract language, machinery the
slice does not ship — among others the generated atomic terminal-result
mutation, conditional lease renewal, the `ctx.job` execution metadata
surface, generated failure-classification policy, weighted deficit
round-robin scheduling and priority aging, the admin
pause/resume/cancel/replay controls, and the backup/restore recovery
fences. The rule is the boundary statement before §Semantics, not this
enumeration: only what §First slice as shipped states is implemented.

### Capability posture

The registry id `jobs_one_off_v1` (experimental for as long as LLP 0070
is Draft) advertises the implemented surface on the local and
remote-service single-process SQLite targets only; hosted target facts
stay false. Its presence asserts current-contract compatibility, never a
durable-background-work capability class or the
`durable-work-single-process-sqlite-v1` tuple — the §Acceptance corpus is
far from covered, and LLP 0063 Step 6's maintainer-acceptance gate
stands. Artifacts binding the surface must acknowledge the experimental
contract (LLP 0058 capability maturity); codegen emits both the
capability requirement and the acknowledgment when the surface is
declared — `defineSchema(..., { requiredCapabilities })` deliberately
refuses the id, which admits schema-level target capabilities only.

---

**Shipped/future boundary.** The section **§First slice as shipped**
(above) — and only that section — describes the implemented surface and
is normative for it; the Summary and target-profile prose before it
describe the proposed subsystem, not shipped behavior. Everything below
this line — §Semantics through §Decisions still requiring ratification —
is the proposed complete future contract of this Draft RFC, written in
present-tense contract language as RFC convention, and is **unshipped
unless §First slice as shipped explicitly states otherwise**. Where a
sentence below and the shipped section differ (admission wording,
idempotency tuple, drain bound), the shipped section is the record of
what exists; the text below is what is being proposed for ratification.

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
writes. If that transaction rolls back, no job exists. Idempotency keys are
scoped to `(queue, action)`. Within one scope, an enqueue is identical —
and returns the existing job — exactly when the canonical-args SHA-256
digest **and** `maxAttempts` both match; `delayMs` (and the derived
absolute `availableAt`) is excluded from the identity fingerprint.
Divergent reuse of the same key — digest or `maxAttempts` differs — fails
as `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED`; the same key under a different
action is a different scope and creates an independent job. The identical
commit-time race code and the resolution ordering are §First slice as
shipped, idempotency-key semantics.

The first profile admits manifest-declared actions only — in both runtime
forms, HostPlan-planned and Ibex JS — because both execute under the
generated host envelope: generated validators, read/write/secret grants,
and the LLP 0009/0047 execution limits (§First slice as shipped,
callee-class admission). Direct mutation and query callees are excluded
and fail closed; broad execution of arbitrary trusted application actions
is a later capability.

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

**Delivery ruling (2026-08-23).** Outbound webhook delivery is
**at-least-once**. Every retry preserves the logical delivery identity and
stable idempotency key, but an arbitrary receiver may ignore that key; a crash
or transport-uncertainty window may therefore produce a duplicate. Snapback
does not advertise exactly-once delivery. Receivers that require a single
observable effect must deduplicate by the supplied delivery/idempotency
identity.

**Implementation checkpoint (external-automations bundle, 2026-08-10).** The
outbound slice is implemented as a reusable host delivery primitive with
durable logical-delivery and attempt tables activated alongside the external
API. Durable watches are its first consumer. The existing LLP 0070 job remains
the sole scheduler, claim fence, exponential-backoff clock, attempt ceiling,
and dead-letter driver. A watch firing reserves one immutable canonical JSON
body and one bounded `watch:{watchId}:{ordinal}` idempotency key; every retry
reuses both.

The final effect boundary accepts HTTPS only, resolves all DNS answers, rejects
loopback, private, link-local, metadata, documentation, multicast, reserved,
and otherwise non-global IPs, then pins the validated address set into ureq's
custom resolver so connect cannot perform a second DNS lookup. Environment
proxies and redirects are disabled, and connect/read/write each have a
15-second bound. Tests alone may admit HTTP when every pinned answer is
loopback. The receiver gets `Idempotency-Key`, `X-Snapback-Delivery-Id`, and
`X-Snapback-Signature: sha256=<HMAC>` over the exact canonical body. Signing
material lives only in the owner-only LLP 0036 config store; protected rows and
attempt diagnostics contain its opaque reference, never its value or an
unrestricted response body. 2xx succeeds; 408/425/429/5xx and transport/DNS
unavailability retry; other HTTP responses dead-letter immediately; exhaustion
records `SNAPBACK_WEBHOOK_DEAD_LETTERED` on both ledgers.

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
   evidence a hosted mapping must match. *(Partially stale as of
   2026-08-01: the first slice now has executable evidence — the in-tree
   state-machine/fault tests and the external A6/0.1.8 receipts in §First
   slice as shipped — but the complete §Acceptance corpus is still not
   covered and the tuple remains unclaimed, so the blocked-on verdict is
   unchanged.)*
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
and an executable target-specific witness before jobs or webhooks count. The
shipped first slice's experimental `jobs_one_off_v1` registration is inside
this boundary, not an exception to it: it advertises current-contract
compatibility for the implemented surface only and claims no
durable-background-work capability class or storage tuple (§First slice as
shipped, capability posture).

## Decisions still requiring ratification

The 2026-07-26 author-side review application proposes generated host-plan
actions only for the first implementation; a 30-day generic tombstone floor
that extends to every longer domain replay horizon; queue pause, restore epoch,
and deployment admission in the external control authority; `ambiguous` as a
terminal queue disposition plus domain-owned reconciliation; and independent
single-process SQLite and Postgres tuples, with SQLite first. These choices are
not accepted merely because they are written here. Independent storage/fault
review and maintainer ratification remain prerequisites before implementation
can satisfy LLP 0063. *(2026-08-01: the first slice now carries several of
these proposals in shipped code with executable evidence — SQLite first,
manifest-declared action callees, the drain seam — which changes the
evidence available to the review, not the ratification requirement.)*

Two additions from the 2026-07-30 Diary 0039 absorption (LLP 0115 CV-9),
both **resolved by the shipped slice** (2026-08-01; details in §First slice
as shipped):

- **Deterministic drive seam — resolved.** The gap this bullet named — no
  injected-clock manual-drive operation, with LLP 0028's
  `SNAPBACK_CRON_DISABLED` + admin manual tick as the donor pattern — is
  closed by the shipped set-based drain
  (`POST /_snapback/api/jobs/drain { nowMs?, maxWaves? }`) and the
  `SNAPBACK_JOBS_DISABLED` sibling switch. As predicted, the cron run
  ledger's identity model was not borrowed: drain receipts live in the
  job/attempt ledger with replay-stable job ids.
- **Callee-class admission — resolved.** V1 admits manifest-declared
  actions in both runtime forms (HostPlan and Ibex JS) under the generated
  host envelope; the Dispatch-style action→mutation shape fits that
  admission. Direct mutation/query callees fail closed as the later
  broader-callee capability, and the Convex parity statement is scoped to
  action callees accordingly (LLP 0121 finding 11).
