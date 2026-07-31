# LLP 0070 — proposed amendment (2026-07-31): first-slice spec text

**Kind:** Dated proposed-amendment appendix to LLP 0070 (durable background
work). Not a numbered LLP document.
**Target:** LLP 0070, Status **Draft** at this writing. Per the amendment
convention for author-owned Draft proposals, this note does not edit 0070's
body; it records the spec text the first implementation slice contributes, for
the author (or a review cycle) to absorb into the RFC.
**Author:** Claude (Fable 5), executing `issues/20260730-move3-jobs-slice-0070.md`
(LLP 0115 CV-9 / LLP 0127 slice 3-jobs; program authority LLP 0130).
**Date:** 2026-07-31
**Implements against:** `src/jobs.rs`, `src/storage.rs`, `src/runtime.rs`,
`src/local.rs`, `src/server.rs`, `src/admin.rs`,
`packages/snapback-harness/ctx-bootstrap.js`, `packages/snapback-codegen/`.

## 1. The enqueue-association receipt shape (0127 decision 7 — 0070-owned)

Decision 7 assigned the enqueue-receipt association shape to LLP 0070, with
its wire projection flowing to LLP 0094 like every other receipt. The slice
implements — and this note proposes as 0070 spec text — **both halves of
LLP 0121 option 3**, with the job side durable and the mutation side bounded:

**Job-side (durable, unbounded-cardinality-safe).** Every job row carries its
producer association, immutable from insertion:

- `producerMutationId` — the exact `mutationId` the producing mutation's
  receipt carries (the client mutation id when the client supplied one;
  otherwise the server-minted receipt id). One identity names both halves.
- `producerSnapshotVersion` — the committed storage version the producing
  mutation's receipt reports as `snapshotVersion` (the actual field name, per
  LLP 0034 §3.2); equal for enqueue-only commits and write-carrying commits.
- `producerFunction` — the producing mutation's declared name.
- `producerPrincipal` — the resolved auth user id, when one existed
  (provenance only; never execution permission — 0070's enqueue-time
  authorization rule is unchanged).

"What did mutation M schedule" resolves from the job side by producer id;
the association is provable without growing the bounded receipt ring.

**Mutation-side (bounded, rollback-evidencing).** The mutation receipt
(`Receipt::Mutation`, LLP 0034 §3.2 family) gains one optional field:

```json
"enqueues": [ { "jobId": "…", "action": "notify", "availableAtMs": 1753… } ]
```

- Present only on **confirmed** receipts that enqueued at least one job;
  omitted when empty (the pinned pre-jobs wire shape is byte-identical).
- Bounded by construction: v1 caps enqueues at 16 per mutation, so the
  ring's size posture is preserved.
- Privacy (§3.3 discipline): opaque job ids, the declared action name, and
  the availability timestamp — never argument values or payloads.
- A **rejected** receipt never carries the field, and rollback leaves no job
  rows: the receipt pair is the inspectable form of
  rollback-schedules-nothing — evidence Convex's bare returned ID does not
  give (LLP 0121 finding 10).

**Wire projection.** The field rides the existing receipt surfaces (receipts
snapshot, live subscribe/unsubscribe echoes, mutation-response receipt) under
LLP 0094's ordinary envelope rules; `schemas/receipt.schema.json` is
regenerated from the Rust type. No new envelope kind is introduced.

## 2. Callee-class admission (LLP 0121 OQ2 — decided in this slice)

V1 admits **manifest-declared actions only**, in **both** runtime forms —
HostPlan-planned actions and Ibex JS actions — because both execute under the
generated host envelope (declared writes, `uses` grants, LLP 0009/0047
limits) that "generated host-plan actions only" exists to guarantee. This
reading admits the Dispatch shape the diaries measured: an action performing
egress and applying durable effects through `ctx.runMutation`, exactly as
cron already invokes actions today.

Not admitted in v1 (fail closed at staging, before any commit work):

- direct **mutation** callees (`SNAPBACK_JOB_CALLEE_NOT_ADMITTED`) — the
  later broader-callee capability;
- **query** callees (same code) — queries are never schedulable;
- undeclared names (`SNAPBACK_JOB_ACTION_UNKNOWN`).

A parity statement against Convex must therefore say: enqueue-side parity
with `runAfter` for **action** callees; Convex's scheduled-mutation
exactly-once class is intentionally not matched (LLP 0121 finding 11 — 0070
is uniformly at-least-once with fenced attempts and idempotency keys).

## 3. The deterministic drain seam (0121 OQ5/OQ9 — decided in this slice)

- **Shape:** set-based, not slot-based. `POST /_snapback/api/jobs/drain`
  with body `{ nowMs?, maxWaves? }` claims every job with
  `availableAt <= nowMs`, executes each claim, publishes each terminal
  transition, and returns the drain receipts synchronously. Due-ness, lease
  arithmetic, retry `availableAt`, and attempt timestamps are pure functions
  of the injected clock — acceptance never sleeps.
- **Cascades:** bounded waves (default 1, cap 16), never run-to-quiescence;
  jobs enqueued by a wave's actions become claimable by the next wave when
  due. Nontermination is refused by the cap, not detected.
- **Determinism bar (OQ9):** deterministic externally observable outcomes
  plus stable job identity — not byte-identical rows. Job ids are allocated
  through the invocation's ctx-answer ledger (LLP 0051 D1), so enqueue
  replay reproduces them and tests can assert on returned ids. Claim order
  is pinned: `availableAt` ascending, then canonical job-id bytes. Claim ids
  remain random and are explicitly **non-normative** (provenance on attempt
  receipts; no assertion may depend on them).
- **Flags (OQ5):** `SNAPBACK_JOBS_DISABLED` is the sibling of
  `SNAPBACK_CRON_DISABLED`, deliberately separate: cron and jobs are
  separate subsystems with separate ledgers. The autonomous jobs worker is
  its own one-second loop (the ticker-as-wakeup posture of LLP 0121 option
  2 case 3 — the loop is a wakeup; the job/attempt rows are the only
  evidence). Interactive latency for `availableAt = now` jobs is therefore
  bounded by ~1s in the single-process profile (OQ6's v1 answer, a
  reported fact, not a contract).

## 4. The paved default queue (0121 OQ1 — decided in this slice)

`ctx.jobs.enqueue(action, args, options?)` requires zero app-side
declaration. Every v1 job lands on the `default` queue with paved published
limits: 16 enqueues/mutation, 64 KiB canonical args, 30-day delay horizon,
attempts 1..=8 (default 1), 30 s lease, claim batch 64, backoff base 1 s
capped 60 s with the RFC's v1 jitter profile (ceiling 1000 ms). 0070's full
queue-declaration machinery remains RFC-only; when it lands, the `default`
queue becomes a declared queue with these values as defaults.

## 5. The inspection surface (0121 OQ3 — decided in this slice)

Two surfaces, per LLP 0121's four-way split:

- **Job-lifecycle visibility to product code:** a **generated declared
  job-status query** (`defineJobStatusQuery({ auth })` →
  `HandlerPlan::JobStatusQuery`) — an ordinary declared operation with an
  ordinary contract, live-capable through the ordinary subscription
  machinery; never an ambient system table. The projection is
  privacy-bounded lifecycle facts only (ids, action/queue names, state,
  counters, timestamps, diagnostic codes, producer association) — never
  argument values or results. V1 authorization vocabulary: the operation's
  own declared auth requirement plus knowledge of the opaque job id;
  per-job row-level policy is a later vocabulary.
- **Operator/acceptance inspection:** the admin lane —
  `GET /_snapback/api/jobs`, `GET /_snapback/api/jobs/{id}` (job +
  append-only attempts), and the drain endpoint's synchronous receipts.

Domain-result reactivity needs nothing here (it falls out of the terminal
mutation, as 0121 established); producer correlation is §1.

## 6. Idempotency-key semantics, narrowed for v1

The RFC's rule — same scoped key + identical canonical bytes returns the
existing job; divergent reuse fails `SNAPBACK_JOB_IDEMPOTENCY_KEY_REUSED` —
is implemented with one narrowing: the identical-reuse fast path resolves at
handler execution time against the read snapshot. If an identical job with
the same key lands between that snapshot and commit, the commit fails closed
with the typed `SNAPBACK_JOB_IDEMPOTENCY_KEY_RACED`; a retry of the mutation
converges on the existing job. Divergent reuse fails closed in both places.

## 7. What the slice deliberately does not implement (honest gaps)

All of the following remain RFC-only; the claim boundary stands and nothing
below is claimed by any capability fact:

queue declarations and capacity counters/admission (a saturated queue cannot
yet refuse enqueue); per-key concurrency slots; cancellation (both cases);
the `ambiguous` terminal state and domain reconciliation; deadlines;
operator replay / successor jobs; retention windows and idempotency
tombstones; webhook capture/delivery machinery; the `revalidatePrincipal` /
`capturedGrant` authorization modes (v1 executes callees as the same system
authority cron actions use); artifact-digest pinning and queue-admission
epochs; restore fences; Postgres and every hosted/multi-worker tuple
(hosted stays blocked-on per the RFC's Dynamic Workflows assessment).

## 8. Capability posture

The registry id `jobs_one_off_v1` (experimental for as long as LLP 0070 is
Draft) advertises the implemented surface on the local and remote-service
single-process SQLite targets only; hosted target facts stay false. Its
presence asserts current-contract compatibility, never a
durable-background-work capability class or the
`durable-work-single-process-sqlite-v1` tuple — the RFC's §Acceptance corpus
is far from covered, and LLP 0063 Step 6's maintainer-acceptance gate stands.
Artifacts binding the surface must acknowledge the experimental contract
(LLP 0058 capability maturity); codegen emits the acknowledgment.
