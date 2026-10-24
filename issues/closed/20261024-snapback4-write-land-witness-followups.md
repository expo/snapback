# Snapback 4 write stack: witness follow-ups from the landing reviews

**Status:** Closed
**Closed:** 2026-10-24
**Opened:** 2026-10-24
**Area:** snapback4 committer (`program_batch.rs`, `committer/{wave,parallel,outcome}.rs`), HTTP mutation intake
**Related:** LLP 3000.009.001.000.002 §3.1, §3.3, §6; `issues/closed/20261024-snapback4-exact-row-counts-delete-and-index.md`

No code defect is open here; each item is a witness that would not go red on
the regression it is meant to lock. All came from blind reviews (Sol, Grok)
of the write stack before landing.

1. **HTTP intake age (both reviewers).** `accepted_http_age_prevents_a_fresh_fallback_budget_and_keeps_queue_progress`
   calls `ProgramCommand::accepted_at` directly. Deleting `.accepted_at(accepted)`
   at `serve_committer.rs` (~185) leaves every test green. Add an HTTP witness:
   delayed body intake + conclusive COMMIT abort → no fresh retry; and a
   remaining-budget (~50 ms left) request that does retry and commits. Cover a
   grouped batch and named fallback with aged members.
2. **Parallel waves (Grok, Low).** `parallel_differential` compares inline vs
   pool execution of the same speculate-then-merge; its `guarded` members all
   hit one counter and are never speculated. Only `chains()` exercises merge
   conflicts. Add an adversarial differential where speculated members collide
   on rows, versus N=1 serial `invoke_program`.
3. **`Wave::take` (Grok, Low).** It trusts the closure rather than re-checking
   every recorded read kind; add an assertion or witness that a non-row read
   kind can never reach speculation.
4. **Worker join outside the deadline (Grok, Low).** The first attempt's
   parallel join has no cancellation; bounded by the 32-member cap. Record the
   bound or add a check before COMMIT selection that covers the join time.

Note on review disposition: one reviewer (Sol) also asked that first attempts
be refused before COMMIT once the 100 ms allowance has passed. The accepted
design (§3.1) bounds retries only; the first execution runs and COMMIT stays
uncancellable. Reopen that as a design change, not as a defect.


## Resolution — 2026-10-24, lane FF1

1. **HTTP intake age.** Three real HTTP witnesses in
   `serve_committer_intake_tests.rs` wait for 100 Continue and delay body
   delivery. They cover expired solo and grouped COMMIT aborts, an expired
   named-member recovery, a successful retry with about 50 ms remaining,
   exact durable/attempt counts and subsequent queue progress. Removing
   `.accepted_at(accepted)` causes 0 passed/3 failed: solo/group/named
   survivors incorrectly commit at heads 1/3/2. Restoring the forwarding
   passes the full eight-test HTTP round-trip scope. Nontransactional
   sequences prove the actual abort/retry paths executed.
2. **Adversarial parallel differential.** `colliding_parallel_matches_n1_*`
   runs distinct-target speculation with cyclic, diamond and reverse read
   dependencies, data-dependent branches and post-write refusals. Three
   seeds, N=8/32 and four rounds compare complete outcomes/meters/history
   against N=1 calls on both stores and require real conflict reruns.
   Disabling recorded-row conflict validation causes both witnesses to
   fail (12 other focused tests pass). They pass with validation restored.
3. **Read-kind guard.** `Wave::take` exhaustively destructures ReadSet and
   discards prepared outcomes with spans, authority, receipt or unsupported
   dependencies, re-executing after predecessors. New kinds require a
   compiler-visible validation decision. The planted-kind witness fails on
   the original implementation, which accepts all four kinds, and passes
   after this guard.
4. **Join bound.** The pool itself now asserts at most 32 private jobs.
   The 33-job witness fails before this assertion and passes after it.
   Together with the existing meter and worker limit, join drains at most
   32 metered interpretations using at most min(CPUs - 2, 8) workers.
   Default interpreter work is at most 32 million steps for these jobs;
   this is not a hard wall-clock or RSS bound. Only first attempts enter
   the wave; their join and COMMIT remain uncancelled under the accepted
   retry-only deadline rule. No first-attempt deadline policy was changed.

The temporary negative-control mutations were restored byte-for-byte.
Full final qualification, the paired W4/W5 diagnostic and process cleanup
are recorded in the FF1 JOURNAL entry and LLP 3000.009.001.000.002 §6.


## Resolution correction — 2026-10-24, FF1 fix round 1

The original read-kind guard rejected unique plain-index `Exists` spans that
`Closure::new` admits. It now validates coverage against the fetched base and
accepts those stable membership/absence spans. Overlays exclude population and
index-key changes; returned images still conflict by identity with predecessor
writes. Uncovered spans, authority, receipts and unsupported reads still rerun.
The planted-kind test retains those unsupported cases. New real-selector
witnesses on both stores require 32 distinct membership-authorized updates and
covered absences to stay buffered without reruns, and require a colliding
predecessor read to rerun and produce the serial value. The strict-span negative
control fails these witnesses. Final checks and cleanup are recorded in the
FF1 fix-round JOURNAL entry; no throughput measurements were run this round.
