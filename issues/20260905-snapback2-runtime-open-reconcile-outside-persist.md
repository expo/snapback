# snapback2: `Runtime::open` reconciles jobs outside the transaction that persists the generation

**Status:** Open
**Systems:** snapback2, snapback2-core (`registry.rs`, `store_jobs.rs`), jobs, schedules
**Severity:** P3
**Owner:** J2's successor path (LLP 1016 D5 succession; the open path J2 and J3 share)
**Author:** Claude Fable 5.1, LLP 1016 closing round
**Date:** 2026-09-05
**Related:** LLP 1016 D2 (identity and succession), D3 (the driver; park, never stop);
reviews `j1b-r2-muse.md` §3.3 and `j1b-r2-grok.md` §3.2

## The gap

`Runtime::open` (`snapback2/crates/snapback2-core/src/registry.rs`, the `open`
function) persists the generation and then reconciles `_jobs` in separate
statements: the `match installed` arms call `persist_generation` /
`persist_generation_transaction` (each committing on its own), and only
afterwards does `crate::store_jobs::reconcile(&store.conn, &generation,
succession)` run, followed by a further standalone
`UPDATE _jobs SET state='queued' WHERE state='running'`.

A crash between the persisted generation and the reconcile leaves a store
whose installed generation is the new one while `_jobs` rows still bind the
old `program_hash`/`generation`, with no park recorded. The successor path
already does this correctly: `apply_successor` runs
`store_jobs::reconcile(&transaction, &next, true)` and
`persist_generation_transaction(&transaction, &next)` inside one transaction
(`registry.rs`, the two adjacent calls), and `store_timers::reconcile` runs
inside `persist_generation_transaction` itself. Only the open path is split.

## The covering behaviour

Nothing runs wrong because of the gap; it is a missing record, not a wrong
execution. The chunk driver re-checks the executable on every chunk:
`Runtime::run_chunk_at` reads the row through `bound_program`, which compares
`bound_hash(program, certificate, schema)` with the row's `program_hash` and
parks the job with `E_JOB_GENERATION` (the cause in the message) when they
differ, when the declaration is missing, or when a persisted plan no longer
decodes; `resume_job_at` reads through the same mapping. So a job the open
path failed to park is parked by its next chunk instead, with the same
envelope. Proofs:
`snapback2/crates/snapback2-core/tests/jobs.rs::executable_mismatch_at_chunk_time_parks_with_the_generation_envelope_and_keeps_the_cursor`
and
`snapback2/crates/snapback2/tests/owner_cases/jobs_queue.rs::executable_mismatch_at_chunk_time_parks_the_job_and_the_owner_keeps_serving`.

What the gap does cost: between the crash and the next background turn,
`/control/jobs`, `dev --status`, and `trace <job>` show the job as `queued`
rather than `parked`, and a `--cancel` in that window succeeds against a row
whose executable is already gone.

## The fix shape

Reconcile inside the same transaction that persists the generation, as the
successor path already does:

- Move `store_jobs::reconcile` (and the `running → queued` reset) into
  `persist_generation_transaction` beside `store_timers::reconcile`, taking
  the `succession` flag as an argument, so every caller — `open`'s three
  arms, `apply_successor`, and the reset path — gets one atomic
  persist-and-reconcile.
- Keep the chunk-time re-check; it is the D3 rule, not a stopgap, and stays
  the guard against a plan edited under a queued job (which no reconcile can
  see).
- One test: open a store whose installed generation was persisted without
  reconciliation (write the meta rows by hand on a closed store, as
  `reopen_with_plan` does in `tests/jobs.rs`), and assert the queued job is
  parked on open, not on its first chunk.

Filed from the J1b fix-round reviews' shared follow-up; the closing round
did not take it because the change touches the open path every lane shares
and belongs with J2's successor work rather than a hygiene round.
