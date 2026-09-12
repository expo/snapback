# LLP 1025: Digest final emission at hub scale — the diagnosis, and the shape that fits

**Type:** Research
**Status:** Active
**Systems:** Snapback 2 scheduled digest recipe (`snapback2/packages/compiler/fixtures/quarry-schedules/`, packaged guide `schedule.md`, `fanout.md`, `maintain.md`), certifier cost model (`snapback2/crates/snapback2-core/src/certificate.rs`, `certificate/search/closure.rs`, `cap.rs`), job driver (`snapback2/crates/snapback2/src/writer_jobs.rs`, `writer_timers.rs`), Quarry schema words, Clique benchmark M8
**Author:** Claude Fable 5.1, for Charlie Cheever
**Date:** 2026-09-12
**Revised:** 2026-09-12 (commission review: recipient custody and pinned-clock draining selected; receipt exemption withdrawn; remaining proposals shelved)
**Related:** [LLP 1023](./1023-clique-builder-jump.rfc.md) (records the unmet digest requirement), [LLP 1023.001](./1023.001-hub-scale-certified-reads.plan.md) §C "Digest and backfill", [LLP 1018.007.004](./1018.007.004-message-digest-recipes.plan.md) (the qualified 500-follow / 100-membership recipe), [LLP 1016](./1016-administrative-plane.rfc.md) D2/D3/D5, [LLP 1001](./1001-query-engine.spec.md) §"Maintained addresses" and §10, [LLP 1020](./1020-day-two-evolution-and-legible-ceilings.rfc.md), `rules/NOT-DOING.md` (ceiling freeze). Children: [1025.000](./1025.000-recipient-level-period-custody.plan.md) recipient-level custody (the recipe), [1025.001](./1025.001-timers-drain-before-chunks.rfc.md) timers drain before chunks, [1025.002](./1025.002-bounded-cascade-on-capped-references.rfc.md) bounded cascade, [1025.003](./1025.003-jobs-do-not-pay-receipt-custody.rfc.md) system programs and receipt custody, [1025.004](./1025.004-bounded-defer-in-chunk-bodies.rfc.md) `defer` in chunk bodies, [1025.005](./1025.005-missed-period-catch-up.rfc.md) missed-period catch-up.

## 1. Summary

The scheduled digest works at the qualified 500-follow / 100-membership
envelope (LLP 1018.007.004) and has no established recipe at the required
500-follow / **1,000-membership** envelope (LLP 1023 "Remaining decisions").
Two recipes were tested and both fail for reasons that are structural, not
incidental:

- **One transaction.** The compact final fold at 1,000 memberships certifies
  at 9,922,698 heap bytes and 8,691,704 closure bytes against ceilings of
  8,388,608 and 4,194,304. The compiler refuses it.
- **Chunked accumulation.** Every chunk fits, and the accumulated totals go
  stale: a chunk counts a chat's unread messages, the recipient loses
  membership before emission, and the total still includes them. The
  retained counterexample (LLP 1023) keeps 500 accumulated contributions
  after a contributing post is deleted and the owner restarts.

The diagnosis is that emission is **O(memberships) point reads inside one
transaction**, and at this schema each maintained point read costs about
8.7 KB of closure. No constant ceiling survives that shape; the next scale
step breaks it again. The fix is to make emission independent of the
membership count by moving the maintained group key from the *membership*
to the *recipient*, which is exactly what `maintain` exists for.

That alternative was costed on 2026-09-12 against the same published 0.0.29
binary and compiler as the retained probe (§5): it is **admitted** at 1,000
memberships and 500 follows with 1,848,418 closure bytes and 2,733,253 heap
bytes. Correctness at emission then needs no guard at all, because the
counter read and the emission are one transaction and every eligibility
transition is another. One residual remains (a message past its expiry whose
row timer has not fired yet), and it belongs to the driver, not the recipe.

The 2026-09-12 commission selects recipient custody and pinned-clock timer
ordering (1025.000, 1025.001). The audit withdraws 1025.003: jobs construct
and validate receipts internally, and their authoritative traces retain
first-image rows even if the outward receipt is discarded. The proposed heap
subtraction would underprice surviving memory. The other three proposals are
shelved with concrete reopening conditions (§7). The probe numbers below are
historical certificates, not qualification of the refined implementation.

## 2. The requirement, restated as obligations

From the Clique brief (M8) and LLP 1023.001 §C, a digest must:

1. Count eligible activity in the completed period `[periodStart, periodEnd)`:
   new followers, new posts by followed accounts, unread messages and the
   number of chats with unread messages.
2. Run on the owner's schedule with every client closed.
3. Emit **once per user and period** across retries, queue delay and owner
   restart (logical-once; the provider's idempotency key covers external I/O).
4. At emission, exclude deleted or expired content and conversations the
   recipient can no longer access. Eligibility is judged at emission, not at
   accumulation, because it can change in between.
5. Write and emit nothing for an all-zero period.
6. Fit the required population: 500 follows and 1,000 memberships per
   recipient (the hub `u0001` has 100 groups and 900 DMs, LLP 1023.001 §A).

Obligation 4 is the one both tested recipes fail. Obligations 3 and 5 are
already solved by the unique `(principal, periodStart)` receipt written with
the application log and the effect in one chunk transaction, and by the
`running → queued` restart rule (LLP 1016 D3). Obligation 6 is the one the
compiler refuses.

## 3. What was tested and why each fails

### 3.1 One transaction: the cost anatomy

The retained probe (`benchmarks/runs/2026-09-12-snapback2-1023-release-0029/digest-distinct-probe/`,
source `75ee110fa`, 0.0.29) certifies the compact final fold with 1,000
memberships, 500 follows and a two-key maintain
`count periodUnread by membershipId, periodStart`. Reproduced byte-for-byte
on 2026-09-12 (§9):

| meter | certified | ceiling | ratio |
| --- | ---: | ---: | ---: |
| heap bytes | 9,922,698 | 8,388,608 | 1.18× |
| closure bytes | 8,691,704 | 4,194,304 | 2.07× |
| examined / index entries | 4,514 | 10,240 | 0.44× |
| steps | 117,835 | 1,000,000 | 0.12× |

The closure total decomposes exactly into two terms the diagnostic prints:

| closure term | bytes | what it prices |
| --- | ---: | --- |
| maintained-address closure: whole row pool and actual issuing metadata | 6,151,978 | 1,000 point reads' separately serialized keys, references and envelopes (1,109,000) plus 1,000 pooled `periodUnreadByMembershipPeriod` first images with table/id envelopes |
| public count absence evidence | 2,539,726 | the proof reserve for a missing public count group, per call (`cap.rs::count_absence_reserve`) |

The heap total is the same 6,151,978 bytes again, charged as "search
closure scratch" (`certificate.rs` adds the closure estimate to derived
scratch), plus 117,835 steps × 32 bytes (`HEAP_BYTES_PER_STEP`) = 3,770,720:
together 9,922,698 exactly. Everything else in the transaction (500 follow reads, the receipt, the
log, the effect) is what the qualified 100-membership form already paid:
3,080,678 closure and 3,758,319 heap (LLP 1018.007.004), which was itself
73% of the closure ceiling.

Two facts about these terms matter for the proposals:

- The terms include **custody**, but are not wholly disposable client-only
  memory. The original inference that no receipt is built for a job was
  false: the runner constructs it, bounds/containment validate it, and only
  the outward receipt is replaced. The authoritative trace retains first
  images and may share their allocation with the receipt. The closure
  bound also guards retained intermediate values. The [consumer audit](./1025.003-jobs-do-not-pay-receipt-custody.rfc.md)
  withdraws the full exemption and its predicted heap saving.
- The maintain's own read rule does not change the charge. A variant with
  the maintain at `read <- deny` certifies identically, because
  `cap.rs::public_count_probe` keys off the target table's uniform
  readability and index shape, not the maintain's rule.

### 3.2 Chunked accumulation: staleness is the design

A job is a sequence of independent sweeps; "no bindings cross a block" and
"each chunk reads current state" (LLP 1016 D2, D5). Accumulating a
recipient's total across chunks therefore records facts that were true at
each chunk's commit and are not re-validated at emission. The retained
counterexample keeps 500 accumulated contributions after a contributing post
is deleted and the owner restarts; the same shape loses membership between
the counting chunk and the emitting chunk. Filtering each earlier chunk is
insufficient by construction, which LLP 1023.001 §C already states.

### 3.3 Prune first plus a final guard: the guard dilemma

The tested repair was an earlier prune sweep plus a final due-expiry guard.
The assessment's finite counterexample: at `t0` the prune visits an unread
message with expiry `t2 > t0` and leaves it; the job processes other
recipients and reaches this one at `t3 > t2`; the guard correctly sees due
content. Then:

- An `if` guard suppresses this recipient while the chunk cursor advances.
  Nothing revisits the omitted recipient/period.
- A `require` guard parks the chunk. `store_jobs.rs::job_head` selects
  `queued` and `running` only, so a later timer turn that cleans every due
  row never resumes it; `registry_jobs.rs::resume_job_at` is an explicit
  operator action. Restart preserves the parked state.
- Removing the guard emits a count that may include the now-expired
  contribution.

"Prune first" also assumes a final-time snapshot that an ordinary earlier
sweep cannot be (LLP 1016 D2: the store keeps current rows only). This is
1025.004's motivation for the general case, and 1025.001's motivation for the
expiry case specifically.

## 4. The diagnosis: the shape, not the ceiling

At this schema the closure cost per membership read is about 8,692 bytes
(8,691,704 / 1,000; the per-read share of envelopes, first images and
absence evidence). The 4 MiB closure ceiling therefore admits fewer than
about 480 such reads in one transaction with nothing else in it. The
qualified 100-membership form fit; the required 1,000 cannot; 2,000 would
not fit under any ceiling the freeze in `rules/NOT-DOING.md` would plausibly
be raised to. Raising the client gzip budget is unrelated. Raising the
closure or heap ceilings is a constant against a linear term.

The term is linear because the recipe enumerates memberships to sum a count
that is *already maintained*, grouped by membership. Grouping by recipient
instead makes the sum one point read. The follows loop stays linear (a
followed author's post count cannot be pre-summed per follower without
fan-out at post time, LLP 1018.007.004 "Following-post activity"), and it
fits at the required 500.

## 5. The costed alternative

Delta against the retained `compact-final` project (patch and sources in
`benchmarks/runs/2026-09-12-snapback2-digest-emission-probe/`):

- **Schema.** Keep `periodUnread` (one row per message × recipient, carrying
  `membershipId`, immutable keys, `cap 50 by recipient, conversationId,
  membershipId` and `cap 50 by messageId`). Add `periodChats`: one row per
  `(recipient, conversationId, membershipId, periodStart)` that exists iff
  that chat has at least one pending row. Add two maintains:
  `count periodUnread by recipient, periodStart` and
  `count periodChats by recipient, periodStart`. Keep the membership-keyed
  maintain for the chat-row transition.
- **Writes.** `queueRecipeUnread` reads the membership-period count before
  inserting and inserts the `periodChats` row when it was zero.
  `clearRecipeUnread` deletes the pending row and, when the membership-period
  count reaches zero, deletes the `periodChats` row.
- **Job.** The 1,000-row membership loop becomes two point reads. A third
  chunk block prunes `periodChats` buckets strictly older than the completed
  period, after the existing `periodUnread` prune.

Certified with the same binary, compiler and Node as the retained probe:

| program | closure | heap | examined | steps | verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| `periodDigestSweep` (1,000 memberships, 500 follows) | 1,848,418 | 2,733,253 | 1,514 | 27,894 | admitted (44% / 33% of ceilings) |
| `queueRecipeUnread` (per recipient) | 8,353 | 25,689 | 103 | 621 | admitted |
| `clearRecipeUnread` | 9,169 | 9,801 | 3 | 99 | admitted |

What this proves: the emission cost no longer depends on the membership
count; the follows loop is the only scaling term left. What it does not
prove: a runtime witness at 1,000 memberships; the cost of the unsend,
expiry, leave and removal cleanup writes (each a capped 50-row loop, priced
like the existing custody writes); and the expiry-timing residual in §6 F6.

## 6. Findings and confidence

- **F1. The refusal is the shape.** Emission-time reads scale with
  memberships; each costs ≈ 8.7 KB of closure at this schema; no ceiling
  within the freeze admits 1,000. *High* (two byte-identical reproductions).
- **F2. The dominant custody terms cannot simply be removed.** 6,151,978 +
  2,539,726 = 8,691,704 exactly; the first is also charged to heap as scratch.
  *High* on the arithmetic. The original "no receipt consumer" inference is
  **refuted** by construction, validation and trace first-image retention;
  see the 1025.003 audit.
- **F3. The maintain's read rule is irrelevant to the charge.** *High.*
- **F4. Guards cannot repair accumulation under today's job machinery.**
  `if` loses the row, `require` parks the job, resume is operator-only.
  *High* (source facts recorded in the retained assessment).
- **F5. Recipient-level grouping makes emission O(1) in memberships and is
  admitted with room.** *High* for the certificate; the witness is owed.
- **F6. Under F5, emission needs no guard, except for a due-but-unfired
  expiry timer.** The background turn fires at most 64 timers, then runs a
  chunk with a fresh clock (`writer_timers.rs`, `writer_jobs.rs`). A message
  past `expiresAt` whose timer is still queued is visible to that chunk.
  *High* that the window exists; 1025.001 closes the ordering/clock window.
  Its invariant is no timer due at the chunk's pinned clock. Exact digest
  expiry additionally requires a synchronous cleanup target that succeeds;
  a rejected target, false predicate or job-enqueue target cannot establish
  universal absence of expired rows.
- **F7. The remaining failure class is discipline.** Every eligibility
  transition must pair a custody write; the assessment's holes (a purge that
  nulls the body without clearing custody; admin removal leaving an
  old-incarnation row) are unpaired writers. The guide already says "deny any
  unpaired writer". A cascade could pair deletes but cannot implement the
  conditional last-unread/distinct-chat transition, so it would not remove
  this recipe's complete discipline class. *High.*
- **F8. Missed periods are lost by design.** LLP 1016 D5 fires once for the
  latest missed period. Not a recipe bug; a product gap for digests
  (1025.005). *High.*

## 7. Commission decision and refined implementation order

On 2026-09-12 the user delegated evaluation, plan refinement and implementation
of worthwhile changes. This authorizes the selected work; it does not assert
prior acceptance of these drafts. Implementers are the Codex recipe and timer
lanes, integrated and verified in this commission.

| child | disposition | reason |
| --- | --- | --- |
| 1025.000 | Implemented | Two recipient-period reads replace the membership fold; pair all custody transitions and retain distinct-chat counts. |
| 1025.001 | Implemented | Pin one turn clock; fire up to 64 timers, then execute a chunk only when none remain due at that clock. |
| 1025.003 | Withdraw | The exemption subtracts memory still used by authoritative traces and internal validation. |
| 1025.002 | Shelve | Cascade cannot express the last-unread transition; no demonstrated customer warrants the grammar, pricing, successor and twin changes now. |
| 1025.004 | Shelve | Timer ordering removes the digest's need; rollback accounting and dependency progress need an exercised customer. |
| 1025.005 | Shelve | Useful future behavior, but FIFO does not protect buckets needed by a parked/resumed older job; failure and retention semantics come first. |

Implementation order: repair source transactions and the period-chat existence
invariant, replace the final membership fold with recipient counters, integrate
pinned-clock timer draining, then run compiled-recipe and copied-app witnesses.
Test hub-scale counts, eligibility transitions, aggregate privacy, quiet/replay
periods, restart and effect retry. Certify the cleanup paths as well as final
emission. Keep pruning in the same cutoff-bound job and update guide examples
together. Use existing checks and named warm lanes; no new registry, gate or
service. Keep all ceilings and the 500-follow envelope unchanged.

The selected source changes are implemented. All 70 copied production programs
certify; seven owner journeys and the disk-backed restart/outbox retry witness
pass. The simultaneous 1,000-chat / 500-follow owner run remains unqualified:
its test seed exceeded the unchanged transaction budget before execution. The
bounded follow-up and exact failed setup are linked from LLP 1025.000 §7.

The precise rule references are [LLP 1016 D1](./1016-administrative-plane.rfc.md#d1--the-system-principal-is-the-stores-owner)
(system execution), [D2](./1016-administrative-plane.rfc.md#d2--a-job-is-a-sequence-of-sweeps)
(current-state sweeps), [D3](./1016-administrative-plane.rfc.md#d3--the-driver)
(turns, cursor durability and parking), and [D5](./1016-administrative-plane.rfc.md#d5--schedules-row-timers-and-periods-on-the-owners-clock)
(logical period bindings and rejection settlement). These implemented sections
govern this change; the shelved children do not add constraints.

## 8. Decisions from the open questions

Keep `unreadChats` as a required field and retain its existence table. Keep
recipient-level totals owner-only. Client transitions need a readable scalar
for the membership-period zero crossing; the recipe must explicitly document
that aggregate's audience and prove source-row privacy rather than assume an
owner-only maintain can be read by a client mutation. Keep the declared 500
follows and 1,000 memberships and let the actual certificates price the row
shapes. Do not teach the old membership-fold form merely because a hypothetical
meter change could admit it. No missed-period catch-up or general "no expired
row exists" claim accompanies this work.

## 9. Sources and retained evidence

- Retained probe and read-only assessment:
  `benchmarks/runs/2026-09-12-snapback2-1023-release-0029/digest-distinct-probe/`
  (`assessment.json` SHA-256 `04c73bce…`, `summary.json` `d882c91a…`);
  source `75ee110fa1ccff019c994c667fd36b2d332ce8b7`, public version 0.0.29,
  binary SHA-256 `e0e3dae8…`, Node 24.18.0.
- This LLP's probe (three variants, certificates, patch, README):
  `benchmarks/runs/2026-09-12-snapback2-digest-emission-probe/`. Same binary,
  compiler shim and Node; `SNAPBACK2_COMPILER` and `SNAPBACK2_NODE` pinned
  as the README records.
- Source facts cited by the assessment at that commit: `jobs.rs`
  (`0e4665e7…`, chunk sweep bounds and refused chunks), `store_jobs.rs`
  (`4c0a1e81…`, `job_head` selects queued/running), `registry_jobs.rs`
  (`f01a1903…`, `resume_job_at` is operator action), `writer_jobs.rs`
  (`87f2f2e1…`, timers then one chunk), `writer_timers.rs` (`42630a72…`, at
  most 64 per turn).
- Qualified 500/100 recipe and certificate: LLP 1018.007.004 "Implemented
  application design and current proof".
- Job and schedule semantics: LLP 1016 D2, D3, D5; packaged guide
  `schedule.md`, `job.md`, `fanout.md`, `bounds.md`, `maintain.md`.
