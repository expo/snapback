# Snapback 4 write stack: witness follow-ups from the landing reviews

**Status:** Open
**Opened:** 2026-10-24
**Area:** snapback4 committer (`program_batch.rs`, `committer/{wave,parallel,outcome}.rs`), HTTP mutation intake
**Related:** LLP 3000.009.001.000.002 §3.1, §3.3, §6; `issues/20261024-snapback4-exact-row-counts-delete-and-index.md`

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
