# snapback2: custody-b review residuals — job plans under a retained audience, `deliver` on a maintain, a test's name

**Filed:** 2026-09-10 (orchestrator, landing lane `custody-b`, LLP 1019 D2)
**From:** `reviews/custody-b-r2-codex.md` (LAND WITH FIXES), items M1, M2, and the minor test-name note

1. **Job plans understate historical-audience costs.** Named and ad hoc planning pass the
   portable certificate to `plan_job`, whose `job.per_chunk` ceilings are the current cap's;
   chunk execution specializes the certificate with the installation's retained audience
   bound `A` (`certificate/delivery.rs`, `engine/jobs.rs`). After lowering a membership cap to 3
   with `A = 10` retained, a delete job's plan shows the cap-3 reserve while execution prices
   ten recipients. Execution is still checked against the enlarged certificate; the defect is
   the operator's plan. Fix: specialize each chunk for the live plan too, keep the portable
   certificate's identity, and surface a specialization refusal in the plan instead of the
   smaller portable figures. Test: ten original recipients, cap lowered to 3, plan a delete job;
   the displayed write/scan/heap/step ceilings equal the effective chunk certificate.
2. **Reject `deliver` on a maintained content table at admission.** The RFC excludes delivery
   of maintains, but the raw-schema validators (`delivery.rs`, `schema.rs`) admit a maintain
   target carrying a `deliver` line; maintained writes then reach `finish_row_change` with no
   delivery reserve and fail containment. Refuse with the existing delivery-shape diagnostic and
   an actionable rewrite.
3. The compiler check "incarnation repairs fit required fields" compiles a handwritten
   repair-shaped mutation rather than the runtime-emitted rewrite; rename it or connect it to an
   emitted repair (`packages/compiler/src/delivery-checks.ts`).

Owner: the custody-c lane (LLP 1019 D4–D6) absorbs 1 and 2 with its D5/D6 work; 3 is a
one-line rename.

4. **(grok r2) Production jobs certify under total visibility**, so `E_STRUCTURAL_FANOUT` from
   item 7d does not fire on `enqueue` of a `ProgramKind::Job`: `jobs.rs` sets every rule to
   `Allow` before `Checker::job_chunk()`, under which `uniform_visibility` is true and the
   reserve adds nothing; the unit test used a user schema with `.principal = viewer`. Either
   price the chunk's delivery reserve under the owner's visibility too, or state in the RFC that
   the job path relies on the chunk's structural page reserve.

