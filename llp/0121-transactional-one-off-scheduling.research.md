# LLP 0121: Transactional one-off scheduling

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Scheduled work, Background work, Developer experience, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-07-30 (v0.2, round-1 dual-family review corrections — Fable
READY with one MATERIAL and four DETAIL citation-precision concerns, Codex
NOT READY with four BLOCKING and three MATERIAL findings; verbatim artifacts
in `reviews/0121-transactional-one-off-scheduling.fable.md` and
`reviews/0121-transactional-one-off-scheduling.codex.md`. All four Codex
blocking findings verified against the tree and applied: Option 2 now
separates cron-as-wakeup from cron-ledger-as-job-evidence (only the latter
is barred) and assesses the wakeup architecture on its merits;
"ordinary-query inspectability" is split into four surfaces with the diary
evidence re-mapped — 0070's terminal mutation already provides domain-result
reactivity; an execution-guarantees comparison and four-column table added
(Convex scheduled-mutation exactly-once vs scheduled-action at-most-once vs
0070 at-least-once/fenced/ambiguous, verified against the official Convex
docs on 2026-07-30); frozen-clock reproducibility reclassified from asserted
property to unresolved design requirement (0070's opaque job ids and random
claim ids defeat the v0.1 claim). Also applied: Codex MATERIAL E–G
(schedulable-reference narrowing; diary-attribution tightening, shared with
Fable concern 1; the job-side receipt-correlation Option 3 variant with the
actual `snapshotVersion` field named), the Codex suggestions (docs dated,
cost ranking qualified, `runAt` given its own analysis), and Fable concerns
2–5 (Diary 0038 quote re-attribution, the restored second conjunct
cross-referencing LLP 0117, the labeled `runAfter(0)` background claim,
hosted-target scoping) plus Fable's suggestions (ephemeral-timer dismissal,
LLP 0063 Step 6, LLP 0108 pointer; the CV-9 exit-criteria note is recorded
here as a pointer since only this file changes). No findings rejected; one
review paraphrase corrected rather than adopted — Convex cancellation is
stated per the docs' uniform two-case rule, not the Codex review's
three-way split.)
**Related:** LLP 0028, LLP 0063, LLP 0070, LLP 0108, LLP 0115, LLP 0116, LLP 0117, Diary 0030, Diary 0031, Diary 0038, Diary 0039

## Summary

Convex lets a mutation schedule one-off durable work with a single call:
`ctx.scheduler.runAfter(0, ...)` enqueues transactionally, returns a durable
scheduler ID whose terminal state is inspectable in the `_scheduled_functions`
system table, and composes with ordinary live queries. Diary 0038's author
would still choose Convex for the Dispatch workload largely because of this
one primitive (the decisive sentence's second conjunct — a more mature
installed TypeScript workflow — belongs to LLP 0117's front, not this one).
Snapback's recurring cron (LLP 0028) is Accepted, shipped, and carries the
stronger deterministic proof story — forced ticks, an injected
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
document evaluates five paths, the execution-guarantee delta, and the
test-seam question; it deliberately makes no final call.

## What Convex does

**General Convex background** (verified against the official Convex docs —
the Scheduled Functions guide and Scheduler API reference at docs.convex.dev,
consulted 2026-07-30; the docs are rolling and undated, so the consultation
date is the version pin — not diary evidence):
`ctx.scheduler.runAfter(delayMs, fnRef, args)` and a `runAt` sibling are
available inside mutations and actions, and schedule public or internal
mutations and actions — queries
are not schedulable. Called from a mutation, scheduling participates in the
mutation's transaction — if the mutation rolls back, no job exists; called
from an action, it is best-effort at call time. The call returns an ID into
the `_scheduled_functions` system table, which server functions can read back
through the ordinary system-table query surface, so job state (pending, in
progress, succeeded, failed, canceled) is observable with the same query
machinery as application data, with completed results retained for seven
days. `ctx.scheduler.cancel(id)` follows a uniform two-case rule: a function
that has not started running will not run; one that has started continues,
but any functions it schedules will not run. Execution guarantees split by
callee class: scheduled *mutations* are guaranteed exactly-once (internal
errors are retried automatically; developer errors fail), while scheduled
*actions* run at most once and fail permanently on transient errors — retry
policy for actions is application- or component-owned. A single function may
schedule up to 1,000 functions with 8 MB of total arguments. The idiomatic
composition is exactly the Dispatch shape: a mutation commits durable state
and `runAfter(0, ...)` schedules an action that performs egress and then
invokes a follow-up mutation.

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
backend because `runAfter` is the most directly useful scheduler primitive
and the installed TypeScript workflow is more mature" — the second conjunct
belongs to LLP 0117's front, not this one. Diary 0039 §7 records the
resulting near tie: Convex wins one-off scheduling, Snapback wins
recurring-work proof. Diary 0038 also records the Convex arm's proof
weakness: its recurring minute job could be deployed and inspected as
source, but "the acceptance suite still lacked Snapback's deterministic
force-tick seam."

## What Snapback does today

**Recurring cron is real and strong.** LLP 0028 is Accepted and shipped: the
scheduler and run ledger live in `crates/snapback/src/cron.rs` (`claim_due_runs` takes an
injected `now_ms`, so due-ness is a pure function of a supplied clock), the
admin forced tick is served at `/_snapback/api/cron/tick` from
`crates/snapback/src/admin.rs`, and the `SNAPBACK_CRON_DISABLED` switch parsed in
`crates/snapback/src/server.rs` runs the server with the scheduler inert while the manual
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
None of it exists in code: a sweep of `crates/snapback/src/` finds no jobs/enqueue machinery
— cron is the only scheduled-work subsystem. LLP 0070 remains Draft, and its
2026-07-30 revision designates the `runAfter` case as the first
implementation slice, with two recorded gaps: a deterministic injected-clock
drain seam, and the callee-class admission question for the Dispatch-style
action→mutation shape.

**The claim boundary is explicit.** LLP 0070: "While this RFC is Draft, no
capability report may claim durable background work from an ad hoc loop or
cron sweep" — and LLP 0063 Step 6 stands behind it, requiring maintainer
acceptance and an executable target-specific witness before jobs count at
all. And LLP 0028's 2026-07-30 amendment closes the door from the
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
   definition file, callable on any schedulable reference — public or
   internal mutations and actions; queries are not schedulable (official
   Convex docs, 2026-07-30). Snapback's cron requires a source-authored
   `defineCron` entry; LLP 0070 as written requires queue declarations and
   (in v1) generated host-plan action callees.
3. **Ordinary-query inspectability.** The returned durable ID resolves in a
   system table readable by ordinary (reactive) queries, so both acceptance
   suites and product UI observe completion without a privileged channel.
   Snapback's cron equivalent is authenticated admin inspection — excellent
   for proof, invisible to application code.

Property 3 is not one surface. "Ordinary-query inspectability" bundles at
least four distinct needs, and they price differently:

- **Domain-result reactivity.** The scheduled work's terminal mutation
  writes ordinary application data, and existing live queries observe it.
  LLP 0070's generated terminal-result mutation already provides this — it
  applies the domain result in one ordinary application-data transaction —
  so this surface needs no new inspection machinery at all.
- **Job-lifecycle visibility to product code.** Reading the job row itself
  (pending, claimed, terminal) from application queries — Convex's
  `_scheduled_functions` read.
- **Operator and acceptance inspection of attempts.** 0070's admin lane;
  cron's current authenticated posture.
- **Producer correlation.** Evidence tying a mutation to the jobs it
  enqueued (Option 3's subject); neither product offers it today.

Re-read against this split, the diary evidence mostly needs the first
surface. Diary 0031's four separately committed progress updates were domain
writes observed by an ordinary second-client live query, and Diary 0039's
Dispatch sentence — "the live query observes completion" — likewise observes
domain state, not the scheduler row. Only Diary 0030 exercised job-status
inspection proper (reading `_scheduled_functions` terminal state in
acceptance, with the ID-cast friction). The genuinely undecided question is
therefore narrower than v0.1 stated: domain-result reactivity falls out of
0070's design as specified; what remains open is the job-lifecycle surface
and its authorization vocabulary.

The diaries weight the properties differently. Diary 0038's decisive
sentence is about properties 1 and 2 together ("tiny and useful ordinary
function primitive"); Diary 0030's evidence is mostly the job-status side of
property 3; Diary 0031's is properties 1 and 3 composed — where the
property-3 half is domain-result reactivity. Meanwhile the concessions to
Snapback differ by diary and must not be pooled: the force-tick absence is
evidenced only in the rerun arm (Diary 0038: "the acceptance suite still
lacked Snapback's deterministic force-tick seam"); Diary 0030's concession
is the hand-built outbound-effect ledger — "known-success suppression,
attempt state, ambiguity, idempotency keys, and retry accounting required a
custom ledger" — plus "preserve Snapback's stricter authority and settlement
model"; Diary 0031's is "preserve Snapback's stronger settlement
vocabulary," while its Convex arm's own settlement behavior tested strong,
as quoted above. The competitive question is therefore not whether to copy
Convex but whether Snapback can match properties 1–3 while keeping receipts,
fail-closed capacity, and a no-sleep test seam Convex does not have.

### Execution guarantees are not the same thing

The three properties cover transactionality, ceremony, and inspectability,
but ergonomic resemblance is not behavioral parity: the two systems make
materially different delivery promises. Convex facts below are verified
against the official docs (2026-07-30); 0070 facts come from the RFC's
§State machine, §Execution and retries, and §Atomic result publication.

| | Convex scheduled mutation | Convex scheduled action | LLP 0070 job | Snapback cron run |
| --- | --- | --- | --- | --- |
| Enqueue | transactional from a mutation; best-effort from an action | same | transactional in the producing mutation; actions enqueue only via an explicit mutation | source-manifest definition, not runtime enqueue |
| Delivery | exactly-once (internal errors auto-retried) | at-most-once; transient errors fail permanently | at-least-once invocation; effects deduplicated by stable idempotency keys | per-slot claim under missed-run policy and `NoOverlap` |
| Retry ownership | platform | application or component | platform, bounded policy with deterministic jitter; unlimited retry invalid | schedule recurrence, not retry |
| Ambiguity | not a first-class state | left to the application (Diary 0030's custom ledger) | explicit `ambiguous` terminal state plus domain-owned reconciliation | outcome classes in the run ledger |
| Cancellation | not-started never runs; started continues but its scheduled functions do not run | same rule | `pending → cancelled` pre-claim; post-claim is a cooperative request — a verified completed effect may still publish success, unknown publishes `ambiguous` | n/a (definitions are source-owned) |
| Evidence | one status row; results retained 7 days | same | immutable job rows plus append-only attempt receipts; ≥30-day tombstone floor | authenticated run ledger |
| Deterministic seam | none observed in the diaries | none observed | designed gap: set-based injected-clock drain | shipped: forced tick plus injected clock |

Authorization propagation of scheduled calls on the Convex side was not
verified in the consulted pages and is deliberately omitted; 0070's side is
designed (fail-closed `revalidatePrincipal` default, plus `system` and
`capturedGrant` modes over durable credential-free authority inputs).

Two consequences for parity language. First, a Snapback `runAfter` built on
0070 is semantically closer to Convex's scheduled *action* strengthened with
platform retries, fencing, and receipts than to Convex's exactly-once
scheduled mutation: 0070's non-goals expressly never promise exactly-once
execution or effects. For the Dispatch shape — egress then a follow-up
mutation — that trade is arguably the honest one, since Convex's
exactly-once covers only a mutation's writes and Diary 0030 catalogues what
its action path leaves to the app; but "arguably stronger" is a different
claim than "the same," and any "runAfter-class" statement must say which
semantics it matches, rejects, or exceeds (open question 10). Second,
cancellation is not a deferrable detail: the two models differ observably
after start (Convex's descendants-do-not-run rule versus 0070's cooperative
request resolving to success or `ambiguous`), so acceptance suites porting
Convex-shaped scenarios will notice.

## Option space

One mechanism family is named only to dismiss it: a non-durable in-process
one-off timer (the analogue of Convex's best-effort action-path scheduling)
would be honest only as ephemeral state, fails the diaries' durable bar —
enqueue evidence, restart survival, terminal-state inspection — and is not
analyzed further.

### Option 1 — Implement LLP 0070's first slice as CV-9 scopes it

Ship the `runAfter` case of `durable-work-single-process-sqlite-v1`: a
default queue, `availableAt = now + delay`, transactional enqueue inside the
mutation transaction, host-plan action callee, job/attempt receipts, and an
injected-clock drain. This is the path both LLP 0115 (CV-9) and LLP 0070's
own revision designate, and it has the double payoff of giving 0070 the
executable evidence its Draft status needs.

What it gives against Convex: property 1 at the enqueue boundary (0070's
enqueue paragraph is verbatim the rollback exit criterion — though delivery
semantics on the far side of the queue differ; see §Execution guarantees),
the delay vocabulary (`runAfter(d)` is `availableAt = now + d`; `runAt` is
`availableAt = t`), plus receipts Convex does not have — immutable job rows
and append-only attempts versus a single mutable status row. What it does
not automatically give: property 2 depends on the default queue truly
requiring zero app-side declaration
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

`runAt` also deserves more than a spelling note. Treating it as
`availableAt = t` leaves four sub-questions the slice must pin: past
timestamps (immediately eligible, or rejected as invalid?); a maximum
horizon (a job a year out interacts with retention windows, queue-capacity
counters, and deploy-compatibility epochs in ways `runAfter(seconds)` never
exercises); overflow discipline (checked unsigned 64-bit milliseconds,
matching 0070's jitter arithmetic); and clock domain (trusted server time
only — 0070 already bars clients from forging `availableAt`, and an
app-supplied wall-clock timestamp must not smuggle a second clock past the
injected-clock seam).

Evidence interaction: strongest of all options. Cost: judged highest of the
five, though the ranking is directional, not an estimate (§Confidence) —
even the first slice needs the job state machine, fenced claims, atomic
terminal publication, and capacity admission that rolls back the producing
mutation.

### Option 2 — Cron-adjacent shapes: separate the wakeup from the evidence

v0.1 treated "cron-sweep shim" as one design; review correctly split it
into three cases, only one of which is barred.

**Case 1 — an app-authored outbox with no platform claim.** Mutations
insert rows into a pending-work table (transactionally — that half is
honest) and a `defineCron` sweeper drains them, with status and attempts in
app schema. This is Option 4 below: permitted, unreceipted, and priced by
the diaries.

**Case 2 — the cron ledger as job evidence: barred, and rightly.** The
tempting shortcut is to present the sweep's cron receipts as the jobs'
evidence. LLP 0070's claim boundary bars claiming durable background work
from an ad hoc loop or cron sweep while the RFC is Draft, and the concrete
reason is worth spelling out: the evidence this shape produces is about the
*sweeper*, not the jobs. The cron run ledger would record "sweep run
succeeded" while individual jobs inside the sweep failed, retried, or
vanished — a job-granularity violation of the recorded-never-dropped rule
that a cron-level receipt structurally cannot see. The identity mismatch is
not stylistic: runtime-created entries have no `jobName` in the source
manifest, no nominal slot, and no schedule hash, so they cannot appear in
the run ledger at all (LLP 0028's 2026-07-30 amendment), which means the
per-job attempt state, terminal disposition, and idempotency accounting
would be app-invented rows with no receipt family — precisely the
hand-built ledger Diary 0030 catalogued as Convex's weakness. A capability
report claiming one-off scheduling from this shape would fake fenced
claims, attempt receipts, and capacity admission it does not have. It also
inherits sweep cadence — a `runAfter(0)` job waits up to a tick — and would
borrow cron's forced tick as its test seam.

**Case 3 — cron or the ticker as a *wakeup* for a 0070 queue: a live
implementation architecture, not a shim.** A worker that drains 0070's job
table when the existing one-second scheduler loop (or a source-authored
cron entry) wakes it keeps all job evidence where 0070 puts it: every
enqueue, claim, retry, and terminal transition updates the authoritative
job/attempt rows and counters transactionally, and the cron ledger — if a
cron entry is even involved — records only that the wakeup ran. 0070 itself
draws exactly this line for hosted timers: a platform timer must be treated
as "a lossy wakeup over the durable job table, never as the delivery
guarantee."
The claim boundary does not touch this case, because the capability claim
would issue from 0070's conformance corpus, not from the sweep. Assessed as
an Option 1 architecture: it reuses a shipped, fault-proven ticker
(near-zero added idle cost); its latency floor is the tick — a
`runAfter(0)` job waits up to a second, which is fine for tests driven
through the drain seam but bounds the interactive answer to open question 6
unless an enqueue-commit wakeup is added; manual drive stays honest because
the jobs test seam remains 0070's set-based drain (a forced cron tick may
*wake* the worker but is not the jobs seam); and the couplings to decide
are the flag relationship — does `SNAPBACK_CRON_DISABLED` also idle the
jobs worker, or does a sibling flag? (open question 5) — and whether tying
the worker to the cron scheduler's lifecycle constrains 0070's later
multi-worker capability classes.

In short: case 1 with no capability claim is merely Option 4; case 2 is
exactly what the claim boundary exists to prevent; case 3 is not a shim at
all but one candidate answer to Option 1's wakeup question.

### Option 3 — Scheduler-as-mutation-receipt, jobs observable as data

Treat one-off scheduling as a first-class *effect of the mutation*, recorded
in the mutation's own receipt. Today's surfaces, named precisely:
`MutationOutput` carries `version` plus an opaque `receipt` object
(`packages/snapback-client/index.d.mts`), and the retention-ring mutation
receipt carries `mutationId` and — when confirmed — the committed
`snapshotVersion` (`crates/snapback/src/live_wire.rs`, LLP 0034 §3.2); "commit version" is
informal, and `snapshotVersion` is the actual field. The direct shape: that
receipt would also carry `{ jobId, reference, availableAt }` for every
enqueue in its transaction, making rollback-atomicity not just true but
inspectable — the receipt proves what was scheduled with the write, which is
evidence Convex's bare returned ID does not give.

A simpler correlation variant deserves equal standing: leave the mutation
receipt untouched and have the job row (or an enqueue receipt in 0070's own
family) carry the producer `mutationId` and committed `snapshotVersion`.
The association is then provable from the job side without growing a
bounded receipt whose privacy posture is deliberately narrow —
retention-ring receipts carry opaque ids, versions, table names, and
reasons, never
row data or argument values (LLP 0034 §3.3) — and without a cardinality
question: one mutation may enqueue many jobs (Convex caps the analogous
fan-out at 1,000 per function), so direct embedding buys size, retention,
and privacy questions the correlation shape avoids. The costs run the other
way in query ergonomics and rollback coverage: "what did mutation M
schedule" needs an index over jobs by producer rather than one receipt
read, and a rolled-back mutation leaves no job rows — the direct shape
could prove the *absence* of enqueues on a rejected receipt, where the
correlation shape proves nothing. Fair costing of the pair (cardinality,
retention, privacy, rollback evidence, query ergonomics) belongs to open
question 4.

The second half is the inspection surface — the job-lifecycle surface of
the §How they differ split; domain-result reactivity needs nothing here:
make job state observable through the ordinary query and live-query
machinery, Convex's `_scheduled_functions` inspectability in Snapback's
vocabulary. Three candidate shapes, in ascending Snapback-nativity:

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
compose with the acceptance kit's non-vacuous check discipline.

Determinism itself is *not* already designed for — v0.1 overclaimed this.
0070's retry jitter is a pure function of job id and attempt, which is
necessary but nowhere near sufficient: the job id is an opaque allocation
from Snapback's trusted id source, the claim id is specified random, and
lease timestamps and worker provenance ride the claim — so a frozen clock
alone leaves job identities, claim identities, the jitter values derived
from those ids, and therefore the row bytes unrepeatable across runs, and
settles nothing about ordering among simultaneously due jobs (0070's final
tie-breaker is canonical job-id bytes, deterministic only if job ids are)
or across cascade waves. Frozen-clock reproducibility is an unresolved
design requirement with three parts: pick the bar — byte-identical rows,
structurally equivalent normalized receipts, or deterministic externally
observable outcomes (LLP 0028's frozen-clock bar is the donor standard, not
proof it transfers); name the injected identity/randomness sources (job-id
allocation, claim ids) or the receipt normalization that erases them; and
pin stable ordering plus the cascade bound under the drain. Open question 9
records this.

One development-experience note the seam does not cover: Convex's
`runAfter(0)` runs promptly after commit in ordinary dev use (general
Convex background, not diary evidence — no diary measured one-off
completion latency), so the single-process worker needs a low-latency
wakeup on enqueue commit (the sibling of cron's ticker) or interactive use
will feel worse than tests do.

## Findings

1. The gap is recorded independently in three diaries across two bakeoff
   generations (0030, 0031, 0038/0039) and is a named reason Diary 0038
   would still choose Convex for Dispatch. It is an authoring-surface gap,
   not an evidence gap — though the concessions to Snapback differ by diary
   and must not be pooled: the missing force-tick seam is evidenced in the
   rerun arm (Diary 0038), while 0030 and 0031 concede the effect-ledger
   and settlement-vocabulary directions instead.
2. The design already exists. LLP 0070 specifies transactional enqueue,
   rollback-schedules-nothing, `availableAt` delays, idempotency, attempt
   policy, and a receipt family; no new RFC is needed. What is needed is
   implementation plus 0070's two recorded decisions (drain seam, callee
   class) plus an inspection-surface position no document currently takes.
3. Nothing is implemented: `crates/snapback/src/` contains cron only (`crates/snapback/src/cron.rs`,
   `crates/snapback/src/admin.rs`, `crates/snapback/src/server.rs` carry the scheduler, forced tick, and
   disable switch); no jobs/enqueue machinery exists anywhere in the tree.
4. Cron structurally cannot host the primitive. The run ledger's identity
   model rejects runtime-created entries and its persisted state sits
   outside the mutation commit path — LLP 0028's 2026-07-30 amendment closed
   this deliberately, and LLP 0115 OQ2 assigns one-off receipts to 0070.
5. Convex's advantage decomposes into three properties — transactional
   enqueue, near-zero ceremony, ordinary-query inspectability. CV-9's slice
   delivers the first at the enqueue boundary (delivery semantics still
   differ; Finding 11), delivers the second only if the default queue needs
   no app-side declaration, and leaves only part of the third undecided:
   domain-result reactivity falls out of 0070's terminal mutation, so the
   open surface is job-lifecycle visibility and its authorization
   vocabulary. Judged by the diaries' own frame, parity requires an
   explicit answer to all three.
6. The callee-class admission is load-bearing for any parity claim: 0070 v1
   admits generated host-plan actions only, while the measured Convex case
   schedules plain mutations and egress-performing actions. Deciding this
   before the slice ships is what separates "runAfter-class" from a narrower
   primitive wearing its name.
7. Only the cron-ledger-as-job-evidence case is barred, and for a concrete
   evidentiary reason, not taste: it would put sweeper receipts where job
   receipts belong, letting per-job failures hide inside successful sweep
   runs and faking a per-job terminal-state surface the ledger cannot
   express. The bar does not touch the distinct cron-as-wakeup
   architecture, whose evidence lives in 0070's job/attempt receipts
   (Option 2, case 3).
8. The deterministic seam transplants but does not copy: a set-based
   injected-clock drain, not a slot-based tick, with cascade/quiescence
   semantics as a genuinely new design question. Deterministic jitter alone
   does not make frozen-clock drains reproducible — 0070's opaque job ids
   and random claim ids defeat that — so the reproducibility bar and the
   identity/randomness seam are unresolved design requirements, not
   established properties.
9. The two-primitive posture with distinct evidence families is the
   documented and defensible direction; unification would migrate shipped,
   fault-proven cron evidence to satisfy a symmetry no diary asked for.
   Convergence belongs at the vocabulary, admin-drive, and guide layers.
10. Option 3's receipt idea is a chance to over-deliver rather than merely
    catch up: recording enqueues in the mutation's own receipt makes
    transactional scheduling *inspectable*, which Convex's returned ID does
    not offer — and Diary 0030's ID-cast friction shows even Convex's
    inspection surface leaves room to win. The job-side correlation
    variant (producer `mutationId` plus `snapshotVersion` on the job row)
    proves the same association without growing the bounded receipt.
11. Execution guarantees differ by design and must be stated in any parity
    claim: Convex splits exactly-once scheduled mutations from at-most-once
    scheduled actions, while 0070 is uniformly at-least-once with fenced
    attempts, stable idempotency keys, and an explicit `ambiguous` terminal
    state, and the cancellation models diverge observably after start. A
    0070-backed `runAfter` most resembles a strengthened scheduled action;
    it is not an exactly-once scheduled mutation, and nothing in the
    diaries requires it to be.

## Confidence

High confidence: the contents of LLP 0028, 0070, and 0115 and the four
diaries (read directly for this document); the code facts (cron surfaces in
`crates/snapback/src/cron.rs`, `crates/snapback/src/admin.rs`, `crates/snapback/src/server.rs`, `demos/_kit/`, and the
absence of any jobs implementation, verified by search on 2026-07-30).
Medium-to-high confidence: the general-Convex background (scheduler API
shape, schedulable callee classes, system-table states, seven-day result
retention, exactly-once versus at-most-once guarantees, the cancellation
rule, and scheduling limits), verified against the official Convex docs —
the Scheduled Functions guide and Scheduler API reference — on 2026-07-30;
the docs are rolling and undated, so the consultation date is the version
pin. Authorization propagation of scheduled calls on the Convex side was
not verified and remains omitted. Low confidence: relative implementation
costs across options (including Option 1's "highest"), which are
directional judgments, not estimates.

## Open questions

1. Does the first slice's default queue require zero app-side declaration —
   and if 0070's queue-declaration machinery must still exist underneath,
   what are the paved defaults (concurrency, capacity, retention) that make
   `enqueue` a one-liner?
2. Callee classes: does the Dispatch action→mutation shape fit generated
   host-plan admission, or does parity require admitting plain mutations
   and broader actions in v1 (0070's recorded decision)?
3. What is the inspection surface for the job-lifecycle surface
   specifically (domain-result reactivity already falls out of 0070's
   terminal mutation): admin-only, a queryable system table, or a generated
   declared job-status (live) query — and what authorization vocabulary
   scopes what a caller may observe?
4. Should the producing mutation's receipt record its enqueues as effects,
   or should job rows carry the producer `mutationId` and `snapshotVersion`
   instead (Option 3's two shapes, with their cardinality/retention/
   privacy/rollback/ergonomics costing) — and does that belong to 0070, to
   the result-contract family (LLP 0108), or to a new owned Spec?
5. Drain semantics: quiescence vs. bounded waves for cascading enqueues,
   the flag relationship to `SNAPBACK_CRON_DISABLED`, and where the drain
   lives on the admin surface — including whether the existing one-second
   scheduler loop may serve as the worker's wakeup while cron and jobs keep
   separate ledgers and ownership (Option 2, case 3).
6. What does interactive (non-test) latency look like for `availableAt =
   now` jobs in the single-process profile — is there an enqueue-commit
   wakeup, and is its latency a reported target fact?
7. Should codegen offer `runAfter`-shaped sugar over `ctx.jobs.enqueue`, or
   is one spelled primitive with a delay option the better surface for a
   contracts-first system?
8. Is a `CaptureOnly` intermediate landing (transactional enqueue plus
   inspection, no worker) worth shipping for honest incremental capability,
   or does it complicate the story for no diary-visible gain?
9. What deterministic-drive output is normative — byte-identical rows,
   normalized receipts, or deterministic externally observable outcomes —
   and how are job ids, claim ids, lease timing, worker identity, ordering,
   and cascades controlled or normalized under deterministic acceptance?
10. Which Convex semantics does the primitive intend to match, reject, or
    exceed: scheduled-mutation exactly-once, scheduled-action at-most-once,
    cancellation-after-start behavior, status retention, authorization
    propagation, and scheduling limits?
11. What is the hosted-target story for one-off work once the
    single-process slice lands — does this front owe a successor note, or
    is it wholly 0070's concern (its Dynamic Workflows candidate
    assessment stands at blocked-on)?

## Relationship to LLP 0115 and owning documents

This document is research context for LLP 0115's CV-9 and changes no
ownership: LLP 0070 owns the durable-work contract and its first slice;
LLP 0028 owns cron and contributes the deterministic-seam donor pattern; the
inspection-surface question (open question 3) has no owner yet and would
need one — likely a 0070 amendment or a small owned Spec — before Option 3's
surface half could proceed. Nothing here re-litigates the retired gaps of
Diary 0039, and nothing here is a decision.

Scope note: everything above is the single-process slice CV-9 designates.
On the hosted target, cron is fault-proven across local and Cloudflare
targets, but one-off durable work has no hosted candidate beyond LLP 0070's
Dynamic Workflows assessment, whose verdict is blocked-on and whose
platform timer is lossy — a wakeup, never a delivery guarantee. Hosted
one-off scheduling is out of scope for this front (open question 11). When
LLP 0115 absorbs this document, Finding 5's paved-default-queue conditional
and open question 3 are candidates to travel with CV-9's slice ticket and
exit criteria, which currently test property 1 and the seam but not
ceremony or inspection.

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
