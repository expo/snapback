I couldn’t save `review.md` because this session’s filesystem is read-only. The standalone review follows.

**Verdict: READY**

Reviewed candidate `cd610a50e9aab41c3e13620e0aefe8d6da5115f3` against baseline `97b4a5b2c218162f8a20a03928574dbd50608106`, using only the supplied frozen snapshots and factual receipts. No material supported-behavior regression was found.

The change removes one redundant live-generation certification from ordinary ad hoc query, mutation, and job enqueue requests. It preserves the separate compiler-output admission, plan admission, rehearsal boundaries, and existing execution and transaction checks.

The source review supports that conclusion:

- **The removed admission uses the same inputs.** The baseline writer certifies, samples time, then enters a runtime method that certifies again. The candidate retains the runtime certification and supplies a deferred clock callback. Both execute synchronously within one writer turn; successor application and clock advancement cannot interleave. The callback captures only the offset. See [candidate writer entry](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2/src/writer_jobs.rs:228) and [baseline writer entry](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/baseline/snapback2/crates/snapback2/src/writer_jobs.rs:244).

- **Live admission remains complete.** `certify_operator_program` reconstructs the project from the current schema/auth, declared programs, separately stored schedule bindings, and effect declarations, then calls `Generation::certify`. It does not substitute schema-hash equality for those dependencies. Compiler-output certification remains separately in `Compiler::compile_source`; the submitted IR is subsequently admitted against the owner’s current generation. No request-spanning certificate cache or new authority surface is introduced. See [live admission](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2-core/src/registry_jobs.rs:249) and [compiler admission](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2/src/project.rs:216).

- **Clock and refusal ordering are preserved at the owner boundary.** The new runtime entries invoke `FnOnce` exactly once after successful admission and never invoke it on admission failure. The writer retains `unix_millis().saturating_add(clock_offset_ms)`, including saturation. The sample still precedes execution/input validation and enqueue work. This is one execution-clock sample, not a claim that the entire request reads time only once: existing logging and surrounding writer work have their own clock reads.

- **Argument validation has two stages.** Wire conversion rejects malformed JSON shapes, unknown arguments, and conversion failures before live admission. Missing required arguments and deeper value restrictions still reach core validation after the execution-clock sample. For example, `mutation change(n: int): return n` with `{}` follows that latter path in both snapshots. Mutation ID reservation also retains its existing position before core input validation; this patch does not promise rollback of allocator reservations. See [wire conversion](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2/src/writer_values.rs:30), [operator runtime](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2-core/src/registry_operator.rs:55), and [core validation](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2-core/src/engine/mod.rs:991).

- **Plan and rehearsal boundaries remain distinct.** Plans retain their single live certificate and do not sample execution time. Rehearsal still admits on the live runtime before creating the copy, carries the already captured writer clock and cloned generation, and separately admits the ad hoc program on the copy. Its callbacks return the pinned value rather than reading wall time. Declared operations and job cancel/resume/chunk paths retain their existing behavior. See [snapshot capture and admission](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2/src/rehearsal.rs:83) and [writer rehearsal boundary](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2/src/writer_rehearsal.rs:25).

- **The current identities and transaction checks remain intact.** These snapshots use value model `i53-codepoint-bytes-v2` and certificate evaluator label `bounded-spike-rust-1`. Ordinary execution checks the current value model, program digest, schema hash, and query write-site restriction. It does not independently compare the evaluator label. Job chunks retain their separate kind, bound-plan, schema, and persisted job-hash checks. The patch neither removes these checks nor adds stronger ones. Mutation constraints, bounds, rollback, and atomic commit/outbox behavior remain downstream; job cursor/progress writes still commit with each chunk, with refusal parking handled after rollback. See [ordinary execution checks](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2-core/src/engine/mod.rs:568) and [chunk execution](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2-core/src/engine/jobs.rs:7).

I inspected every caller of the changed runtime methods, the CLI/control dispatch and seat admission, writer serialization, compiler admission, plan/rehearsal paths, persisted-job binding, error mapping, and relevant execution/transaction code. I also read the required agent instructions, rules, LLP 1000, LLP 1016 D6 and relevant engine/loop sections, and the packaged operator/job guides.

The new tests cover refused admission without clock invocation, single successful samples, post-sample enqueue argument refusal, query/mutation clock propagation, and effect removal under an unchanged schema hash. The owner test exercises an advanced development clock through ad hoc query and mutation execution. These tests support the change; they are not themselves instrumentation proving certification counts. See [new core tests](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2-core/tests/jobs.rs:900) and [owner clock coverage](/Users/ccheever/clique-improvement/reviews/adhoc-admission-dedup-r1/astra/snapback2/crates/snapback2/tests/owner_cases/rehearsal.rs:243).

Checks actually performed during this review were read-only:

- Verified all 940 manifested leaves in each snapshot, using the frozen changed-file hashes for the candidate; no mismatches.
- Verified the patch hash and applied its hunks in memory: it reproduces exactly the seven changed candidate files.
- Verified retained stdout/stderr hashes against terminal receipts.
- Reconciled all 12 diagnostic request pairs with raw certification events, input hashes, thread identities, statuses, and responses.

The retained native receipts show **68 passing tests**, with three distinct measurement tests ignored. These are prior executions, not tests executed by this reviewer. Initial owner jobs/operator groups failed before readiness with `E_ASSET_NOT_READY`; those failures remain recorded. The subsequent locked default-image helper build precedes distinct successful `-with-media` receipts using the same test commands, environments, and 30-second deadlines.

The first baseline diagnostic failed its observer’s same-thread assertion after recording the fifth response, a rehearsal. Raw events show matching admission inputs on different live/copy threads, consistent with the source. The corrected baseline tail runs only the remaining seven requests; the candidate records all twelve once. The retained counts reconcile as follows:

| Request | Baseline total | Candidate total |
|---|---:|---:|
| Query, mutation, enqueue, transaction rejection | 3 each | 2 each |
| Plan | 2 | 2 |
| Each rehearsal kind | 3 | 3 |
| Kind, seat, conversion refusal | 1 each | 1 each |
| Compiler refusal | 0 | 0 |

These counts establish fewer certification invocations in that diagnostic. They do not establish a speedup or benchmark result.

No native build, product test, or diagnostic execution was performed during this review. The first local hash-check command failed because its shell heredoc required a temporary file; the corrected in-memory command completed despite macOS cache-write warnings. No unresolved suspected issue requires an independent native probe.

This report supplies one independent source review. No peer report was consulted. Fresh-pair review does not supply publication or full capability qualification. Muse ultra execution remains unestablished in this setup, and no third review is claimed.