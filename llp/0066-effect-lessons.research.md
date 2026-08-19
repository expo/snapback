# LLP 0066: Effect — lessons for Snapback

**Type:** Research
**Status:** Review
**Systems:** API, Runtime, Sync, Cron, Background work, Developer experience, Client integration
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-20
**Revised:** 2026-07-20 (round-4 revision after dual-model review: scoped F4 to durable operation attempts with the settlement invariant — exhausted retries cannot terminally settle ambiguous outcomes — separated the retry control planes, corrected the receipt trust/schema description, scoped the conflict `retryPolicy` detail to the captured-read path, restated the observability join as version-based and contextual, and defined "prioritized" against the confidence section's own gate)
**Related:** LLP 0000, LLP 0001, LLP 0004, LLP 0007, LLP 0008, LLP 0028, LLP 0034, LLP 0037, LLP 0043, LLP 0044, LLP 0045, LLP 0047, LLP 0063, LLP 0067, LLP 0070, https://effect.website, https://www.npmjs.com/package/@effect/workflow

## Summary

Effect (effect.website) is a functional effect-system and runtime for
TypeScript: a unified `Effect<Success, Error, Requirements>` type carrying a
typed expected-error channel, tag-based dependency injection (Layers),
declarative retry policies (`Schedule`), structured concurrency, streams,
OpenTelemetry observability, and — in alpha — Effect Cluster /
`@effect/workflow` for durable, sharded, replayable workflows.

Most of Effect's value propositions Snapback addresses by different means;
the disposition matrix below classifies each one honestly rather than
claiming exact equivalence. Two are **prioritized opportunities** — where
"prioritized" means *first in line as reference input to in-flight design
work* (LLP 0070's review; a future retry-policy surface), not that
implementation is justified today: the Confidence section's use-case gate
still applies, and tracing is also a gap, deferred:

1. **Durable multi-step workflows.** Snapback's closest machinery is LLP
   0028's cron run ledger (leased claims, per-sequence result persistence,
   replay-returns-prior-result); what's missing is a *general, on-demand,
   portable* orchestration surface (the gap LLP 0044/0045 each note from
   their own corners, and which the concurrently-drafted LLP 0070 — named a
   platform prerequisite by LLP 0063 — now proposes to fill for background
   jobs). `@effect/workflow`'s persisted-activity-replay model is reference
   input to that design work — see F3 for what it adds beyond a job queue
   and what it cannot promise.
2. **Retry policy as declarative, verifiable data.** Cron already carries a
   manifest retry policy; client mutation replay is evidence-class-driven,
   not naive. The opportunity is narrower than "make retries data": a
   declared timing/attempt policy for failures *already classified
   retryable*, visible to manifests and the Contract verifier — see F4.

Effect's *programming model* should not be imported into Snapback's public
authoring surface — an `[inferred]` posture argued in F6, not a settled
decision.

### Disposition matrix

| Effect proposition | Snapback disposition |
| --- | --- |
| Typed expected-error channel | **Partial** — structured open-coded diagnostics + declared UI states; no closed per-operation error unions (F1) |
| Schema (single definition, derived codecs) | **Aligned, narrower scope** — Snapback-owned shared artifact shapes (F2) |
| Durable workflows (`@effect/workflow`) | **Gap, narrowed** — cron ledger is prior art; general surface missing; LLP 0070 in flight (F3) |
| `Schedule` retry policies | **Partial gap** — cron has manifest policy; mutation-replay timing policy undeclared (F4) |
| Observability / OpenTelemetry tracing | **Gap, deferred** — correlation primitives exist, no span model (F5) |
| Layers / tag-based DI | **Unassessed** — server functions get capabilities via `ctx`, not injected service graphs; no concrete Snapback problem identified |
| Structured concurrency (fibers) | **Unassessed** — handler model is run-to-completion async (LLP 0009's conformance contract); no user-facing concurrency surface to structure |
| Streams | **Unassessed** — live queries (LLP 0008) + ephemeral state cover current streaming needs; no general stream-processing surface |
| The `Effect` type / monadic composition | **Non-adoption posture recommended `[inferred]`** (F6) |

## How to read this — provenance and confidence

Effect-side claims come from public documentation read 2026-07-20 — no
source-code verification:

- https://effect.website (module overview; error-management and Effect-type
  docs; positioning quotes)
- https://www.npmjs.com/package/@effect/workflow (workflow/activity/idempotency
  model; alpha, pre-1.0 — 0.19.x at read time; Effect core is on its 3.x line)
- Effect's Cluster announcement (x.com/EffectTS_/status/1922246618285318472)
  and the community-maintained DeepWiki pages on cluster/sharding internals
- Secondary 2026 ecosystem writing (dev.to, pristren.com, noqta.tn) for
  adoption and learning-curve impressions — *impressions from secondary
  sources*, tagged as such where used

Effect core is stable; `@effect/workflow` and Cluster are alpha and may
move. Snapback-side claims cite the governing LLPs and code. This document
deliberately uses a coarser tagging scheme than LLP 0001's per-claim
vocabulary: the block above declares the observed sources once, in-repo
citations carry their evidence inline, and `[inferred]` marks synthesis —
the same information, with less per-sentence ceremony. Recommendations are
`[inferred]`.

## Findings

### F1. Typed errors — partial correspondence, not equivalence

Effect's error channel tracks a **typed union of expected errors** through
composition; tag-aware helpers narrow the remaining union as variants are
handled, and handling every variant is what reduces it to `never` —
partial handling is permitted. Two honest limits: *defects* (unexpected
errors) live outside the channel, and a caller can run an effect without
first eliminating its error channel — exhaustive handling is an available
discipline, not an execution requirement. Snapback's machinery is related but different in kind:

- **Runtime diagnostic structure:** stable machine-readable codes with
  `code`/`severity`/`details`, asserted on codes not prose
  (`guide/operating/diagnostics.md`). Codes are open strings and
  **multi-owner**: the framework emits `SNAPBACK_*` codes
  (`crates/snapback/src/diagnostic.rs`), while declarative mutations carry app-authored
  typed failure codes (`elseError` / `guard` in
  `packages/snapback-codegen/define.mjs`) that the runtime emits verbatim.
  There is no generated, closed error union per operation (LLP 0004 types
  arguments and success results, not failure sets).
- **UI lifecycle state:** Contract's declared async arms (`loading` /
  `error` / `empty` / `ready` — defined on the Exact side, Exact LLP 0216;
  this repo evidences the `empty` vs `error` branching in
  `guide/clients/contract-adapter.md`) model *presentation states*, not
  typed operation failures.

For an agent-authored UI surface, declared states plus stable codes are
arguably the better trade than threading an error type through every
signature — a judgment about ergonomics, not an equivalence. A narrower
opportunity worth recording (explicitly **deferred; no recommendation
now**): a **federated diagnostic catalog** — framework codes registered by
their producing packages (Rust core, but also the codegen, client, and
Contract JavaScript packages that originate framework diagnostics),
app-authored codes declared in the plan/manifest layer that already owns
them, an unknown/generic fallback for opaque handlers —
from which codegen could emit per-operation-family discriminated unions and
Contract match helpers. Per LLP 0037, authority follows the natural owner,
which here is plural; closed unions cannot be promised for opaque handlers
without changing their contract. Revisit if agent-authored apps demonstrably
mis-handle failure codes. `[inferred]`

### F2. Schema as single definition with derived codecs — aligned, scoped

Effect Schema derives encoder and decoder from one definition and turns
parse failures into typed errors. Snapback applies the same
single-source-of-truth principle to **Snapback-owned shared artifact
shapes**: Rust types generate committed JSON Schemas with a CI drift gate
(LLP 0037; `crates/snapback/src/schema_export.rs`). Application data-model declarations are
app-owned, source-authored JavaScript (`schema.mjs`, per
`guide/getting-started/your-first-backend.md`), so the analogy is scoped —
the systems enforce different things. The concrete difference `[inferred]`:
Snapback's derivation is committed-and-CI-gated for the cross-language
artifacts it owns; Effect's is broader (any user schema) but has no
equivalent drift gate. No change recommended.

### F3. Durable workflows — a narrowed gap, with real prior art in-repo

**What exists.** LLP 0028's cron execution model is substantial
durable-execution machinery: stable slot identities with leased claims and
attempt counters; each nested mutation's result row committed *in the same
transaction* as app rows and journal; retries that reach an
already-committed mutation sequence receive the prior result rather than
committing again; recovery is at-least-once, and **external egress may
repeat** even when mutations are deduplicated (LLP 0028; implemented in
`targets/cloudflare/src/coordinator.js`, covered by
`targets/cloudflare/test/acceptance.cron-recovery.mjs`). LLP 0044 (asset pipeline)
and LLP 0045 (notifications outbox) each note the absence of a *general*
durable background-job subsystem. The concurrently-drafted **LLP 0070**
(durable background work; fenced leases, at-least-once delivery, idempotency
keys at external boundaries, outcome classes including
`ambiguousExternalEffect`) proposes that general job surface, motivated by
LLP 0063's platform prerequisites. As of this writing 0070 does not
reference Effect; this finding is input to its review.

**What `@effect/workflow` adds beyond a job queue.** LLP 0070 is job-shaped:
one action per job, retried as a unit. `@effect/workflow` is *multi-step*: a
workflow's execution ID derives from its name plus a payload-derived
idempotency key; an **activity** (step) executes once unless an explicit
`Activity.retry` policy allows further attempts (each attempt has its own
identity), and its committed result is persisted so a retried workflow
*replays* — skipping completed activities instead of re-running them. That
per-step persisted ledger is **the same transactional result-ledger
pattern** as LLP 0028's mutation-sequence replay — with the caveat that
0028's keying is scheduler-specific and positional, and stable *workflow*
step identity across code edits, branches, loops, and version upgrades is an
unsolved design problem, not a free generalization. The generalization
list, if Snapback ever builds it: invocation surface, stable step identity,
long-lived control flow (durable timers/signals/waits), external
activities, compensation, retention/GC, portability, local/hosted parity —
the step classes below are the floor, not the ceiling.

**What no design can promise.** Step-result-at-commit gives exactly-once
*semantics for database mutations* only, where the ledger row and app rows
share a transaction (the LLP 0028 property). For external effects —
payments, email, arbitrary APIs — recovery can only control *re-attempt
policy*, not the provider-side outcome: a crash between provider acceptance
and result persistence leaves the true outcome ambiguous, zero,
at-most-once, or effectively-once *only if* the provider offers idempotency
keys or status lookup (and actions are not globally transactional —
LLP 0047). A workflow layer must therefore type its steps (non-exhaustive):

1. **Database mutations** — atomically ledgered; replay returns prior
   results (exactly-once).
2. **External activities** — provider idempotency keys, status lookup, or an
   intent/outbox row; an explicit ambiguous state when none exists
   (LLP 0070's `ambiguousExternalEffect` is the right vocabulary;
   connectionless retention-ring receipts — LLP 0034 §3, "D2 — receipts" —
   prove mutation settlement, not arbitrary activity results, and don't
   cover this).
3. **Pure computation** — replayable for free, cacheable optionally.

With that split stated, the "smaller lift than a Temporal-style engine"
claim should be read as bounded: smaller because Snapback already has the
per-application version authority, the transactional ledger pattern, and
the settlement vocabulary — not because durable request/reply state, step
identity, fencing, retention, and replay come for free. `[inferred]`

### F4. Retry policy as data — a partial gap, not a green field

The round-1 draft of this document claimed Snapback retry behavior is
"uniform and hard-coded"; that is wrong, and the corrected picture sharpens
the opportunity. This finding scopes itself to **durable operation
attempts** — cron re-runs, mutation redelivery, future job retries. The
*lifecycle* retry planes (bounded-exponential connection reconnect, LLP
0008; render-first attachment retry in the Contract adapter) are separate
control planes a policy surface composes with, not rows in it. Within the
durable-operation scope, three mechanisms exist today:

- **Cron re-runs** declare policy in the manifest: jobs carry `retryPolicy`
  (today `{ mode: 'NextTick' }` — advancing to the next nominal invocation —
  with unsupported modes rejected fail-closed at validation:
  `SNAPBACK_CRON_RETRY_MODE_UNIMPLEMENTED`, `crates/snapback/src/cron.rs`;
  `packages/snapback-codegen/index.mjs`; LLP 0028).
- **Client mutation replay** is evidence-class-driven: connectivity
  ambiguity stays queued for redelivery under the same `clientMutationId`;
  a rejection carrying a **provider-core receipt** — origin response
  evidence within the active authority/trusted-origin context (LLP 0043),
  *not* transferable authenticity: `Receipt::Mutation` is Rust-typed with a
  committed generated JSON Schema (`crates/snapback/src/live_wire.rs`,
  `crates/snapback/src/schema_export.rs`) but carries no signature, and the local target
  has no public TLS edge (LLP 0000) — settles as failure
  (`packages/snapback-contract/index.mjs`). Replay preserves strict FIFO
  ordering and stops at unresolved ambiguity (LLP 0043).
- **Non-retryable classes** are marked as such: the captured-read conflict
  path emits `SNAPBACK_MUTATION_CONFLICT` with a machine-readable
  `retryPolicy: "reject"` detail (`crates/snapback/src/storage.rs`; the explicit `readSet`
  conflict path shares the code but not yet the detail field), and the
  guide documents conflicts as reconcile-don't-retry
  (`guide/backend/mutations.md`).

The actual gap: **declarative timing/attempt/deadline policy for failures
already classified retryable**, uniform across the durable-operation retry
sites (cron attempts, outbox redelivery, LLP 0070's future job retries —
whose `retryable`/`terminal`/`ambiguousExternalEffect` outcome classes are
the natural attachment point). Four concerns stay separate in any such
surface: **failure eligibility** (is this class retryable at all —
conflict/auth/validation never are), **retry schedule** (backoff, caps,
deadlines), **delivery evidence** (receipt present or absent), and
**terminal settlement** — with one invariant: *exhausting attempts or a
deadline may pause automation or escalate to an operator, but can never
convert a receipt-less or externally-ambiguous outcome into terminal
success or failure* (LLP 0043's ambiguity rules). Effect's `Schedule` is
the reference *shape* — composable backoff/jitter/cap policies separated
from the retried code — but it is an executable value, not a serialization
format; a Snapback version would be a small closed data schema over those
four separated concerns, which is also what a verifier can actually check:
policy declaration and runtime conformance, not operational outcomes. Two
constraints any design inherits: per-mutation delay interacts with the
outbox's FIFO ordering guarantee (delaying the head blocks the queue —
ordering domains would need to be explicit, and operation-level delay must
compose with, not fight, connection-level backoff), and eligibility stays
separate from scheduling. `[inferred]`

### F5. Observability conventions

Effect ships OpenTelemetry tracing as a first-class runtime concern.
Snapback has `/inspect`, the admin console, and structured diagnostics, but
**no OpenTelemetry or operational distributed-span instrumentation** (the
`HostCallTrace` machinery in `crates/snapback/src/runtime.rs` records V8/Ibex conformance
traces — a different purpose; LLP 0000 lists broader observability as future
work). A correlation *substrate* exists as a **version-based contextual
join**, not direct causal propagation: receipts carry mutation identity and
snapshot version, live envelopes carry version without mutation identity
(`crates/snapback/src/live_wire.rs`), and the join holds only for confirmed,
version-advancing mutations within one application version stream (rejected
or no-op mutations need not produce fan-out). A future span model would
strengthen these existing edges — e.g. propagating correlation identity
into envelopes — rather than invent them. A real gap, deferred behind
operating-at-scale demand. `[inferred]`

### F6. The programming model — a non-adoption posture, argued

Effect is viral the way async is viral: once one function returns an Effect,
its callers tend to `[inferred]`. Secondary sources consistently report a
steep human learning curve (generators, Tag DI, Layers) — an impression,
not a measured claim, and human learning-curve reports do not establish
*agent* ergonomics. The argument from Snapback's side: the authoring surface is
deliberately plain — schema objects, async handlers, structured results —
because agents (and humans) reason locally over it (LLP 0000), and the
disposition matrix shows Snapback covers the guarantees it needs
structurally where they matter most (diagnostics, drift-gated schemas,
settlement semantics) while genuinely lacking others (workflows, tracing)
for which adopting Effect's *model* is neither necessary nor sufficient.

Scope of the posture `[inferred]`: keep Effect values and monadic
composition out of Snapback's **public authoring surface and serialized
contracts**. Isolated internal or tooling dependencies are a separate,
need-driven evaluation — nothing here forbids them. Revisit trigger: if a
comparative authoring exercise (identical Snapback tasks, plain-async vs an
Effect-style prototype, measuring generated-code correctness, repair
cycles, and diagnostic quality) ever shows agents perform better against an
Effect-shaped surface, this posture should be re-argued with that evidence.
This is the same learn-don't-adopt posture the corpus applied to TigerBeetle
(LLP 0054).

## Confidence

High confidence in the Effect-side descriptions as summaries of the public
docs read 2026-07-20 (the F1 error-model description now states the
documented expected-error/defect split; workflow/Cluster internals are
explicitly alpha and docs-derived). High confidence in the corrected
repo-facing claims in F1–F5, which were verified against code and LLPs
during review. Medium confidence in F3's generalization list and step-type
split — design input for LLP 0070's review, not a settled design. Low
confidence on priority: the first concrete use case demanding a general
workflow facility has not been named. Candidates visible in-corpus —
LLP 0044's asset derivation chains, LLP 0045's notification fan-out,
LLP 0070's own payment-command/webhook-reconciliation motivation — read
today as *job* demands with domain intent tables, not yet multi-step
workflow demands; that assessment should gate the work.

## Recommendations

All `[inferred]`.

1. **Feed F3 into LLP 0070's review loop** (and cross-reference the two
   documents): evaluate 0070's job/lease model against
   `@effect/workflow`'s per-step persisted-replay design; decide explicitly
   whether multi-step workflows are a second consumer of 0070's queue
   (jobs-with-step-ledger) or a later separate subsystem; keep the step-type
   split and the no-transactionally-exactly-once-external-effects statement
   in whichever design wins. Default the ledger to the existing
   per-application authority (LLP 0007 warns against intra-application
   sharding) — Effect's entity-sharding layer solves a multi-node problem
   Snapback's local target does not have. When the gap is accepted as real,
   record it as a guide capability-index GAP row (LLP 0061 discipline). A
   design lead worth carrying: step identities could be *generated,
   manifest-declared artifacts* with drift detection (the LLP 0037 move),
   rather than derived from code position; and each external step could be
   required to declare its settlement capability (transactional /
   provider-idempotent / provider-queryable / compensatable / inherently
   ambiguous) so the verifier can reject unsafe automatic-retry policies
   before deployment.
2. **Treat `Schedule` as the reference shape** if/when retry timing policy
   becomes declarative: a closed failure-class → policy table in the
   manifest, attached first to LLP 0070's outcome classes and cron's
   existing `retryPolicy`, with eligibility and ordering domains kept
   separate from scheduling.
3. **Hold the F6 non-adoption posture for the public authoring surface**,
   with its stated scope and revisit trigger; evaluate any internal/tooling
   use of Effect on its own need-driven merits.

## Open questions

- What is the first concrete use case that needs a general workflow
  facility rather than LLP 0028's ledger plus a domain-specific intent
  table (LLP 0044/0045 pattern)? This should gate prioritization.
- Workflows as a second consumer of LLP 0070's queue, or a separate
  subsystem? (F3's sketch reads as the former.)
- What constitutes stable step identity across code edits, reordered
  branches, loops, retries, and deployed-version upgrades — and how do step
  results interact with LLP 0043's retention/GC discipline and LLP 0007
  portability (export/migrate/restore of in-flight workflows)?
- The provider-core receipts described in F4 already have a committed
  generated schema; the open questions are narrower: should *consumers*
  runtime-validate receipts against it, and do receipts ever need
  cryptographic binding for transport across less-trusted intermediaries —
  and against what trust root?
- Can per-operation-family diagnostic unions coexist with app-authored codes
  and opaque JavaScript handlers without changing the handler contract
  (F1's federated-catalog question)?
- Does a declarative retry delay create ordering-domain semantics the
  outbox must expose (head-of-line blocking vs. declared independent
  domains), and does retry timing attach to a logical operation, an
  attempt, or a nominal cron slot?
- Should the retry-policy table also govern the local cron target, where
  today no retry logic executes at all (fail-closed `NextTick` only)? The
  local/hosted parity question applies to F4 as much as F3.
