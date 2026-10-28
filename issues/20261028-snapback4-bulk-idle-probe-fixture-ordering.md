# Fixtures that assert right after setup writes can race the bulk idle-probe interval

Status: Open
Date: 2026-10-28
Scope: snapback4 client fixtures; `serve_maintenance.rs` bulk thread (LLP 3000 "Contended read serving", SQW amendment). Found during the 0.4.44 publication.

`f9ca72e63d` (SQW, main, 2026-10-27) made an entirely empty bulk cycle wait to a
fixed 100 ms idle-probe deadline that commit notifications do not cancel
(`wait_after_empty_cycle`). That is intended and documented: "A newly enqueued
delivery/recount/job can wait up to that idle interval before the next ordinary
probe."

Measured pickup of the Following `feed:delivery` job after the setup `post`
commit on an idle dev server: 5-9 ms before `f9ca72e63d`, 25-75 ms after. A
per-commit bisect of Integration 28's main merge isolates `f9ca72e63d`
(evidence: `snapback4/reports/20261027-publication-0.4.44/linux/probe/`).

`retained-history.test.mjs` "MQ speculative events process" (test 54) then
failed in 2 of 3 full Linux publication suites at `2921a639cc`, and in 5 of 30
runner-alone runs; 0.4.43 (`6f3ef3b0d0`) passed 30 of 30 under the same
conditions. The job's synced commit landed between `client.sync()` and the held
query's server reply, so the answer was published provisional (26 server rows,
`complete: false`; LLP 3000.028#3.2). `c9c3a35461` fixed that fixture by
settling the Following delivery work before the client starts. The assertion is
unchanged, and the fixed file passed 15/15 alone and in two full 442-file pools.

## Follow-up

- Audit other fixtures for the same ordering assumption: a setup write that
  queues bulk work (Following delivery, maintained-column recount or backfill,
  jobs), followed by an assertion that presumes the server is quiescent.
- Candidate: `maintained-column-adoption.test.mjs` test 4 "column activation:
  wasm, device watch" hung once at its final `until(()=>between.length===2)`
  in the 0.4.44 linux-2 suite (load about 10). It then passed 47/47 alone and in
  the next three full suites. It saves schema edits under live watches, and
  maintained columns recount on the bulk thread. Not proven to be the same class.
- If a settle helper is wanted, observe the queued work itself (as `c9c3a35461`
  does with the timeline's owned Work table) rather than sleeping.
