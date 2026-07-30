# LLP 0121: Transactional one-off scheduling

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Scheduled work, Background work, Developer experience, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0028, LLP 0070, LLP 0115, LLP 0116, Diary 0030, Diary 0031, Diary 0038, Diary 0039

## Summary

Convex lets a mutation schedule one-off durable work with a single call:
`ctx.scheduler.runAfter(0, ...)` enqueues transactionally, returns a durable
scheduler ID whose terminal state is inspectable in the `_scheduled_functions`
system table, and composes with ordinary live queries. Diary 0038's author
would still choose Convex for the Dispatch workload largely because of this
one primitive. Snapback's recurring cron (LLP 0028) is Accepted, shipped, and
carries the stronger deterministic proof story — forced ticks, an injected
clock, and an authenticated run ledger — but the app-authoring surface has no
equally obvious transactional one-off primitive, and the recorded result is a
near tie that splits "Convex wins authoring/composition; Snapback wins
deterministic recurring-work proof."

This Research document maps the option space around that gap. The central
corrective fact, established by LLP 0115's CV-9 audit, is that the design is
not missing: LLP 0070 (durable background work, Draft) already specifies
`ctx.jobs.enqueue` with same-transaction validation and insertion,
rollback-schedules-nothing semantics, `availableAt` delays, attempt policy,
idempotency keys, and its own job/attempt receipt family. What is missing is
an implementation, two named decisions (the deterministic drain seam and the
callee-class admission), and a position on the inspection surface — the piece
of Convex's primitive that no current Snapback document answers. This
document evaluates five paths and the test-seam question; it deliberately
makes no final call.

## What Convex does

**General Convex background** (product knowledge, labeled as such, not diary
evidence): `ctx.scheduler.runAfter(delayMs, fnRef, args)` and a `runAt`
sibling are available inside mutations and actions. Called from a mutation,
scheduling participates in the mutation's transaction — if the mutation rolls
back, no job exists; called from an action, it is best-effort at call time.
The call returns an ID into the `_scheduled_functions` system table, which
server functions can read back through the ordinary system-table query
surface, so job state (pending, in progress, succeeded, failed, canceled) is
observable with the same query machinery as application data;
`ctx.scheduler.cancel(id)` cancels pending work. Scheduled *mutations* rerun
safely under Convex's deterministic transaction model; scheduled *actions*
carry no such guarantee, and retry policy is application- or component-owned.
The idiomatic composition is exactly the Dispatch shape: a mutation commits
durable state and `runAfter(0, ...)` schedules an action that performs
egress and then invokes a follow-up mutation.

**Diary evidence.** Diary 0030 (Partiful bakeoff, Convex arm): "`runAfter`
returned a durable scheduler ID whose terminal state was inspectable in
`_scheduled_functions`" — with the friction note that scheduled IDs needed
string-storage and a cast back to the system-table ID type for inspection.
Diary 0031 (Research Room, Convex arm): "Scheduled mutations made four
separately committed progress updates straightforward," each observed live by
a second native client with no custom subscription server; every scheduled
progress mutation rechecked durable state, and cancellation fenced both
scheduled and explicitly injected late writes — the settlement behavior
tested well, not just the ergonomics. Diary 0038 (Dispatch rerun): "Convex's
`ctx.scheduler.runAfter(0, ...)` lets enqueue atomically register durable
follow-up work. It is a tiny and useful ordinary function primitive," against
which the author "would still choose Convex for a conventional product
backend because `runAfter` is the most directly useful scheduler primitive."
Diary 0039 §7 records the resulting near tie: Convex wins one-off scheduling,
Snapback wins recurring-work proof. The same diary also records the Convex
arm's weakness: its recurring minute job "still lacked Snapback's
deterministic force-tick seam."

## What Snapback does today

**Recurring cron is real and strong.** LLP 0028 is Accepted and shipped: the
scheduler and run ledger live in `src/cron.rs` (`claim_due_runs` takes an
injected `now_ms`, so due-ness is a pure function of a supplied clock), the
admin forced tick is served at `/_snapback/api/cron/tick` from
`src/admin.rs`, and the `SNAPBACK_CRON_DISABLED` switch parsed in
`src/server.rs` runs the server with the scheduler inert while the manual
tick keeps claiming and executing due runs. The acceptance kit wires this as
a first-class option: `demos/_kit/server-process.mjs` exposes `cronDisabled`,
sets the environment variable, and suites drive ticks deterministically
instead of racing the one-second ticker. Dispatch's rerun proof crossed
action → atomic mutation → durable event → live delivery → successful run in
the authenticated ledger (via `packages/snapback-admin-client` inspection)
without sleeping. This is the evidence model the gap-closing work must not
regress (LLP 0115, Governing constraint 1).

**One-off work has a design but no implementation.** LLP 0070 specifies
`ctx.jobs.enqueue(reference, args, options)`: "Validation and insertion occur
in the same database transaction as the mutation's ordinary writes. If that
transaction rolls back, no job exists." It further specifies `availableAt`
(the `runAfter`-equivalent delay), bounded attempt policy with deterministic
jitter, scoped idempotency keys with fail-closed reuse, immutable jobs with
append-only attempt receipts, fenced claims, atomic terminal publication, and
a capability-class ladder (`Missing` → `CaptureOnly` → `SingleProcess` → …).
None of it exists in code: a sweep of `src/` finds no jobs/enqueue machinery
— cron is the only scheduled-work subsystem. LLP 0070 remains Draft, and its
2026-07-30 revision designates the `runAfter` case as the first
implementation slice, with two recorded gaps: a deterministic injected-clock
drain seam, and the callee-class admission question for the Dispatch-style
action→mutation shape.

**The claim boundary is explicit.** LLP 0070: "While this RFC is Draft, no
capability report may claim durable background work from an ad hoc loop or
cron sweep." And LLP 0028's 2026-07-30 amendment closes the door from the
other side: the run ledger's identity model (`jobName`, nominal slot,
schedule hash, definition generation) presupposes source-manifest definitions
and structurally rejects runtime-created entries, and local scheduler state
is a whole-blob snapshot persisted outside the mutation commit path, so a
transactional enqueue cannot be a small delta to cron. LLP 0115 OQ2 is
answered the same way: one-off work gets 0070's receipt family, not the cron
ledger.

## How they differ and why agents preferred Convex

Convex's advantage decomposes into three separable properties:

1. **Transactional enqueue with the deciding write.** The mutation that
   decides work is needed schedules it atomically — the read that justifies
   the job and the job's creation commit or roll back together. Snapback's
   cron cannot express "this specific thing, once, later" at all; the only
   current answer is app-authored state plus a recurring sweep.
2. **Near-zero ceremony.** One call, no queue declaration, no separate
   definition file, callable on any function reference. Snapback's cron
   requires a source-authored `defineCron` entry; LLP 0070 as written
   requires queue declarations and (in v1) generated host-plan action
   callees.
3. **Ordinary-query inspectability.** The returned durable ID resolves in a
   system table readable by ordinary (reactive) queries, so both acceptance
   suites and product UI observe completion without a privileged channel.
   Snapback's cron equivalent is authenticated admin inspection — excellent
   for proof, invisible to application code.

The diaries weight these differently. Diary 0038's decisive sentence is about
property 1 and 2 together ("tiny and useful ordinary function primitive");
Diary 0030's evidence is mostly property 3; Diary 0031's is properties 1 and
3 composed (scheduler-authored durable progress becoming realtime
automatically). Meanwhile every diary concedes the proof direction to
Snapback: the Convex arms could not force a tick or drain deterministically,
and Diary 0030's outbound-effect ledger shows what Convex apps hand-build
when they need attempt-state evidence — "known-success suppression, attempt
state, ambiguity, idempotency keys, and retry accounting required a custom
ledger." The competitive question is therefore not whether to copy Convex but
whether Snapback can match properties 1–3 while keeping receipts, fail-closed
capacity, and a no-sleep test seam Convex does not have.

## Option space

### Option 1 — Implement LLP 0070's first slice as CV-9 scopes it

Ship the `runAfter` case of `durable-work-single-process-sqlite-v1`: a
default queue, `availableAt = now + delay`, transactional enqueue inside the
mutation transaction, host-plan action callee, job/attempt receipts, and an
injected-clock drain. This is the path both LLP 0115 (CV-9) and LLP 0070's
own revision designate, and it has the double payoff of giving 0070 the
executable evidence its Draft status needs.

What it gives against Convex: property 1 fully (0070's enqueue paragraph is
verbatim the rollback exit criterion), delay semantics fully (`runAfter(d)`
is `availableAt = now + d`; `runAt` is `availableAt = t`), plus receipts
Convex does not have — immutable job rows and append-only attempts versus a
single mutable status row. What it does not automatically give: property 2
depends on the default queue truly requiring zero app-side declaration
(0070's queue-declaration machinery must have a paved implicit default, or
the ceremony reappears); property 3 is not addressed at all — 0070's
inspection is the admin lane plus a policy-gated public status projection,
with no live-query composition. The callee-class gap is load-bearing:
Convex's everyday case schedules plain mutations and arbitrary actions,
while 0070 v1 admits generated host-plan actions only, and whether Dispatch's
action-performing-egress-then-nested-mutation shape fits that admission is
0070's own open decision. A slice that ships without resolving it risks
claiming "runAfter-class" for a narrower callee set than the diaries
measured. One honest staging note: 0070's `CaptureOnly` capability class
(transactional enqueue and inspection, no worker) would let a first landing
claim exactly what it proves — though it would not move the diary score,
which requires observed completion.

Evidence interaction: strongest of all options. Cost: highest — even the
first slice needs the job state machine, fenced claims, atomic terminal
publication, and capacity admission that rolls back the producing mutation.

### Option 2 — A cron-sweep shim (barred, and rightly)

The tempting shortcut: mutations insert rows into a pending-work table
(transactionally — that half is honest), and a `defineCron` sweeper claims
due rows every tick. LLP 0070's claim boundary bars shipping this as durable
background work while the RFC is Draft, and the concrete reason is worth
spelling out: the evidence it produces is about the *sweeper*, not the jobs.
The cron run ledger would record "sweep run succeeded" while individual jobs
inside the sweep failed, retried, or vanished — a job-granularity violation
of the recorded-never-dropped rule that a cron-level receipt structurally
cannot see. The identity mismatch is not stylistic: runtime-created entries
have no `jobName` in the source manifest, no nominal slot, and no schedule
hash, so they cannot appear in the run ledger at all (LLP 0028's 2026-07-30
amendment), which means the shim's per-job attempt state, terminal
disposition, and idempotency accounting would be app-invented rows with no
receipt family — precisely the hand-built ledger Diary 0030 catalogued as
Convex's weakness. A capability report claiming one-off scheduling from this
shape would fake fenced claims, attempt receipts, and capacity admission it
does not have. The shim also inherits sweep cadence — a `runAfter(0)` job
waits up to a tick — and would borrow cron's forced tick as its test seam.
As an *internal* app pattern with no capability claim it is merely Option 4;
as a platform primitive it is exactly what the claim boundary exists to
prevent.

### Option 3 — Scheduler-as-mutation-receipt, jobs observable as data

Treat one-off scheduling as a first-class *effect of the mutation*, recorded
in the mutation's own receipt: the receipt that today carries the commit
version would also carry `{ jobId, reference, availableAt }` for every
enqueue in that transaction, making rollback-atomicity not just true but
inspectable — the receipt proves what was scheduled with the write, which is
evidence Convex's bare returned ID does not give. The second half is the
inspection surface: make job state observable through the ordinary query and
live-query machinery, Convex's `_scheduled_functions` inspectability in
Snapback's vocabulary. Three candidate shapes, in ascending Snapback-nativity:

- **Admin API only** (today's cron posture): preserves the authority story
  and matches `packages/snapback-admin-client`, but application code and
  product UI cannot observe job state, and the pre-guide cron-inspection
  ambiguity complaint (retired in Diary 0039) gets a successor.
- **A queryable system table**: closest to Convex, but an ambient
  always-present table sits poorly with Snapback's declared-capability
  posture, and its authorization story ("public status projects only jobs an
  application policy allows the caller to observe," per 0070) needs
  row-level policy machinery Snapback does not have generically.
- **A generated, declared live query**: codegen emits a job-status query
  (live where the app declares it) scoped by an app-declared observability
  policy, appearing in the capability manifest like any other operation.
  This matches the manifest-and-contracts custody model and gives the live
  path an explicit declaration rather than ambient reactivity.

This option is complementary to Option 1, not an alternative mechanism: it
is the evidence-and-observability layer over 0070's enqueue. Its value is
that it names the half of Convex's primitive (property 3) that CV-9's slice
scope currently leaves undecided.

### Option 4 — Endorse the app-layer outbox as the paved answer

Do not build a primitive; document the pattern: apps declare a pending-work
table, insert rows transactionally in mutations, sweep with a `defineCron`
action or drain opportunistically, and track status/attempts/idempotency in
app schema, with the guide providing a recipe and perhaps kit helpers. The
transactional half really is free today — any mutation can insert a pending
row atomically — and the pattern claims nothing it does not have, so no
boundary is violated. But the diaries price this accurately: it is the
Convex custom-effect-ledger experience (Diary 0030) imposed on every
Snapback app that needs one-off work, it duplicates state-machine code of
wildly varying quality across apps, its evidence is unreceipted app rows,
and it permanently scores as the composition loss Diary 0038/0039 recorded,
because the bakeoff measured exactly the ceremony this option preserves. As
a *bridge posture* — the documented interim answer while Option 1 lands — it
is defensible; as the endorsed terminal answer it concedes CV-9.

### Option 5 — Unify recurring and one-off, or keep two primitives

Full unification would make cron a producer into the durable-work queue and
migrate execution and evidence to job/attempt receipts, retiring the run
ledger: one state machine, one inspection surface, one deterministic seam.
LLP 0070 already gestures at the producer half ("a cron handler may enqueue
one durable job with a schedule-derived idempotency key"). But the identity
tension LLP 0115 records cuts against the rest: the cron ledger's identity
(nominal slot, schedule hash, definition generation) carries
recurring-specific semantics — strict-next missed ticks, no-overlap keyed by
logical job, demand gating, jitter seeds — that a generic job row does not
express, and the run ledger is Accepted, shipped, and fault-proven across
local and Cloudflare targets. Migrating it to satisfy a symmetry instinct
risks the no-evidence-regression constraint for no diary-recorded gain
(nobody complained there were two ledgers; they complained one primitive was
missing). The keep-two posture — cron ledger answers "what slot was due and
what happened to it," job/attempt receipts answer "what work exists and how
its attempts went," with the boundary cross-referenced in both RFCs — is the
currently documented direction. The convergence worth considering is
shallower: shared outcome-classification vocabulary, a single admin
time-advance surface driving both seams, and one guide page that teaches
when to reach for which primitive.

### The deterministic test seam for one-off work

Snapback's differentiator is that the Dispatch proof never sleeps, so the
one-off primitive needs a seam of the same quality, and LLP 0070's revision
records it as a gap. The cron donor pattern is inert-scheduler-plus-forced-
tick (`SNAPBACK_CRON_DISABLED`, `/_snapback/api/cron/tick`, the kit's
`cronDisabled`), but the jobs sibling is not literally a tick: cron's seam is
*slot-based* (advance nominals, claim due slots), while a jobs drain is
*set-based* — claim every job with `availableAt <= t` for an injected `t`
and run each to a terminal state, returning receipts synchronously. Open
sub-questions the seam design must pin: cascade semantics (a job's mutation
may enqueue follow-up jobs — does one drain call run to quiescence, one
wave, or a bounded depth, and how is nontermination refused?); whether the
worker-inert switch is the same flag or a sibling; and how drain receipts
compose with the acceptance kit's non-vacuous check discipline. Determinism
itself is already designed for: 0070's retry jitter is a pure function of
job id and attempt, so a frozen clock plus drain yields identical rows,
matching LLP 0028's frozen-clock bar. One development-experience note the
seam does not cover: Convex's `runAfter(0)` runs promptly after commit in
ordinary dev use, so the single-process worker needs a low-latency wakeup on
enqueue commit (the sibling of cron's ticker) or interactive use will feel
worse than tests do.

## Findings

1. The gap is recorded independently in three diaries across two bakeoff
   generations (0030, 0031, 0038/0039) and is the named reason Diary 0038
   would still choose Convex for Dispatch. It is an authoring-surface gap,
   not an evidence gap: every diary concedes the proof direction to
   Snapback.
2. The design already exists. LLP 0070 specifies transactional enqueue,
   rollback-schedules-nothing, `availableAt` delays, idempotency, attempt
   policy, and a receipt family; no new RFC is needed. What is needed is
   implementation plus 0070's two recorded decisions (drain seam, callee
   class) plus an inspection-surface position no document currently takes.
3. Nothing is implemented: `src/` contains cron only (`src/cron.rs`,
   `src/admin.rs`, `src/server.rs` carry the scheduler, forced tick, and
   disable switch); no jobs/enqueue machinery exists anywhere in the tree.
4. Cron structurally cannot host the primitive. The run ledger's identity
   model rejects runtime-created entries and its persisted state sits
   outside the mutation commit path — LLP 0028's 2026-07-30 amendment closed
   this deliberately, and LLP 0115 OQ2 assigns one-off receipts to 0070.
5. Convex's advantage decomposes into three properties — transactional
   enqueue, near-zero ceremony, ordinary-query inspectability. CV-9's slice
   delivers the first outright, delivers the second only if the default
   queue needs no app-side declaration, and leaves the third undecided.
   Judged by the diaries' own frame, parity requires an explicit answer to
   all three.
6. The callee-class admission is load-bearing for any parity claim: 0070 v1
   admits generated host-plan actions only, while the measured Convex case
   schedules plain mutations and egress-performing actions. Deciding this
   before the slice ships is what separates "runAfter-class" from a narrower
   primitive wearing its name.
7. The cron-sweep shim is barred for a concrete evidentiary reason, not
   taste: it would put sweeper receipts where job receipts belong, letting
   per-job failures hide inside successful sweep runs and faking a per-job
   terminal-state surface the ledger cannot express.
8. The deterministic seam transplants but does not copy: a set-based
   injected-clock drain, not a slot-based tick, with cascade/quiescence
   semantics as the genuinely new design question. Deterministic jitter in
   0070 already makes frozen-clock drains reproducible.
9. The two-primitive posture with distinct evidence families is the
   documented and defensible direction; unification would migrate shipped,
   fault-proven cron evidence to satisfy a symmetry no diary asked for.
   Convergence belongs at the vocabulary, admin-drive, and guide layers.
10. Option 3's receipt idea is a chance to over-deliver rather than merely
    catch up: recording enqueues in the mutation's own receipt makes
    transactional scheduling *inspectable*, which Convex's returned ID does
    not offer — and Diary 0030's ID-cast friction shows even Convex's
    inspection surface leaves room to win.

## Confidence

High confidence: the contents of LLP 0028, 0070, and 0115 and the four
diaries (read directly for this document); the code facts (cron surfaces in
`src/cron.rs`, `src/admin.rs`, `src/server.rs`, `demos/_kit/`, and the
absence of any jobs implementation, verified by search on 2026-07-30).
Medium confidence: the general-Convex background paragraphs (scheduler API
shape, system-table states, mutation-vs-action guarantees), which come from
product knowledge rather than this repository's evidence and are labeled as
background throughout; specific operational details like retention windows
are deliberately omitted. Low confidence: relative implementation costs
across options, which are directional judgments, not estimates.

## Open questions

1. Does the first slice's default queue require zero app-side declaration —
   and if 0070's queue-declaration machinery must still exist underneath,
   what are the paved defaults (concurrency, capacity, retention) that make
   `enqueue` a one-liner?
2. Callee classes: does the Dispatch action→mutation shape fit generated
   host-plan admission, or does parity require admitting plain mutations
   and broader actions in v1 (0070's recorded decision)?
3. What is the inspection surface: admin-only, a queryable system table, or
   a generated declared job-status (live) query — and what authorization
   vocabulary scopes what a caller may observe?
4. Should the producing mutation's receipt record its enqueues as effects
   (Option 3), and does that belong to 0070, to the result-contract family,
   or to a new owned Spec?
5. Drain semantics: quiescence vs. bounded waves for cascading enqueues,
   the flag relationship to `SNAPBACK_CRON_DISABLED`, and where the drain
   lives on the admin surface.
6. What does interactive (non-test) latency look like for `availableAt =
   now` jobs in the single-process profile — is there an enqueue-commit
   wakeup, and is its latency a reported target fact?
7. Should codegen offer `runAfter`-shaped sugar over `ctx.jobs.enqueue`, or
   is one spelled primitive with a delay option the better surface for a
   contracts-first system?
8. Is a `CaptureOnly` intermediate landing (transactional enqueue plus
   inspection, no worker) worth shipping for honest incremental capability,
   or does it complicate the story for no diary-visible gain?

## Relationship to LLP 0115 and owning documents

This document is research context for LLP 0115's CV-9 and changes no
ownership: LLP 0070 owns the durable-work contract and its first slice;
LLP 0028 owns cron and contributes the deterministic-seam donor pattern; the
inspection-surface question (open question 3) has no owner yet and would
need one — likely a 0070 amendment or a small owned Spec — before Option 3's
surface half could proceed. Nothing here re-litigates the retired gaps of
Diary 0039, and nothing here is a decision.

It is part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling (this document) |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics |
