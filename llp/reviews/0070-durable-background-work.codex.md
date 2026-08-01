# LLP 0070 durable background work review — Codex family

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-08-01
**Redaction:** not redacted
**Method:** full round-1, post-absorption — independent review per LLP 0005 of the RFC after the 2026-08-01 absorption of the shipped first slice; reviewer directed to verify the absorbed §First-slice text against shipped code (src/jobs.rs, ctx.jobs.enqueue, drain seam, jobs guide page, jobs_one_off_v1), the A6 arm + 0.1.8 re-verification evidence, the future-marking of the RFC-only remainder, the claim boundary, the a4-f4 clock question, and body-vs-absorbed consistency; read-only sandbox in a fresh worktree of origin/main at a8dcb148, blind to fable artifacts
**Target SHA-256:** `caa83b1694d9ec1ad236d25f6edf6258c4c2feaf8c9d4c9ec4d41b5f33968048`
**Instruction SHA-256:** `86011a79d633624115a7c4bc137447671803b5226902ea861dea5ecfed571f82`
**Status:** completed (first attempt, no retry needed)

### Verbatim review

Verified SHA-256: `caa83b1694d9ec1ad236d25f6edf6258c4c2feaf8c9d4c9ec4d41b5f33968048`. I read that exact 813-line RFC. I did not read any review artifacts, including any `*.fable.md`. This was a source-and-retained-evidence review; I did not build or run code.

## Overall assessment

The absorbed first slice is substantially faithful to what shipped. Transactional enqueue, receipt association, action-only callee admission, fenced attempts, injected-clock draining, job-status query, operator custody, guide coverage, and experimental capability registration all have concrete implementations.

The claim boundary is particularly good: `jobs_one_off_v1` remains experimental, hosted facts remain false, and neither the durable-work class nor SQLite tuple is claimed.

However, three contract issues prevent READY: idempotency equivalence is internally inconsistent, drain exhaustiveness is overstated, and the RFC-only remainder is not clearly separated from shipped behavior.

## Strengths

- The enqueue and producer-association design maps cleanly to the mutation transaction and receipt publication. Job insertion shares the application-write transaction, and rejected receipts omit enqueue facts.
- Callee admission matches the absorbed decision: both HostPlan and Ibex JS actions are admitted; mutations, queries, and unknown names fail closed.
- The job-status boot-admission repair is narrow and fail-closed, and the generated result contract now matches the Rust projection.
- The jobs guide accurately explains the primary authoring, status, custody, and capability surfaces, subject to the drain/idempotency qualifications below.
- The capability posture is unusually disciplined: registry maturity, artifact acknowledgment, local/remote-service scope, hosted exclusion, and the no-tuple boundary agree.
- The a4-f4 treatment is correct. Fresh `everyMs` schedules use the recent epoch-aligned slot, while stale persisted downtime recovery remains explicitly open in [LLP 0028](</Users/ccheever/projects/snapback/llp/0028-cron-scheduled-execution.rfc.md:718>). LLP 0070 neither silently resolves nor inherits that question.

## Concerns

1. **MATERIAL — Idempotency scope and equivalence are not settled consistently.**

   The full body says different action, arguments, or policy must fail reuse ([RFC line 330](</Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:330>)). The shipped section and guide instead scope keys to queue/action and describe canonical argument equivalence. The implementation compares argument digest and `maxAttempts`, but not `availableAt`/`delayMs`; a different action is a different database scope and therefore creates another job rather than failing ([runtime comparison](</Users/ccheever/projects/snapback/src/runtime.rs:1677>), [commit comparison](</Users/ccheever/projects/snapback/src/jobs.rs:447>)).

   Resolve by specifying one exact tuple:

   - key scope, including whether action is inside or outside it;
   - canonical intent fingerprint;
   - whether `delayMs`, absolute `availableAt`, and `maxAttempts` participate;
   - behavior for every divergent field.

   Then align the RFC, guide, diagnostic wording, implementation, and divergence tests.

2. **MATERIAL — The RFC-only remainder is not clearly enough marked as future.**

   The honest-gaps list is useful but incomplete. Immediately afterward, the general body states unimplemented behavior in present-tense normative language: atomic domain-result publication, lease renewal, `ctx.job` metadata, failure classifications, weighted fairness, authorization modes, admin controls, and recovery machinery. Examples include the generated terminal-result mutation ([line 390](</Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:390>)), weighted V1 scheduling ([line 524](</Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:524>)), and default `revalidatePrincipal` execution ([line 553](</Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:553>)).

   The body also still says “generated host-plan actions only” before correcting itself parenthetically to both runtime forms.

   Resolve by placing an explicit boundary before `## Semantics`: everything after it is the proposed complete future contract unless the shipped section explicitly says otherwise. Expand the honest-gaps inventory or make it explicitly non-exhaustive, and replace stale primary statements instead of correcting them parenthetically.

3. **MATERIAL — “Every due job” overstates the shipped drain.**

   The RFC and guide say one drain claims every job due at `nowMs` ([RFC line 171](</Users/ccheever/projects/snapback/llp/0070-durable-background-work.rfc.md:171>), [guide line 132](</Users/ccheever/projects/snapback/guide/backend/jobs.md:132>)). The implementation claims at most 64 per wave, with one wave by default. Waves therefore serve both cascade depth and pagination through a pre-existing due set. Values outside 1–16 are silently clamped rather than refused ([drain implementation](</Users/ccheever/projects/snapback/src/server.rs:2830>)).

   Resolve by either:

   - making each wave exhaust the pre-wave due set in bounded batches before advancing cascade depth; or
   - documenting the exact `64 × maxWaves` ceiling, returning truncation/remaining facts, and distinguishing batch pagination from cascade waves.

   Also state whether out-of-range `maxWaves` is rejected or clamped.

4. **should-fix — Evidence attribution needs sharper scoping.**

   A6’s 0.1.7 run proved enqueue/drain/receipt/admin behavior but boot-refused the declared job-status query. The 0.1.8 evidence separately proves RV-A6-F1 job-status boot/live transition and RV-A6-F2 guide/custody/dedup behavior ([capsule lines 66–67](</Users/ccheever/projects/snapback/demos/improvement-sweep/arms/reverify-0.1.8/run-capsule.json:66>)). The RFC cites only RV-A6-F2, although F1 is the boot witness. Moreover, the re-verification discovered the degraded-result advisory; its platform-owned result-contract repair is later current-source/in-tree evidence, not part of the original external 0.1.8 pass.

   Resolve with a compact evidence mapping: A6-04 → enqueue/drain/association; RV-A6-F1 → job-status boot/live; RV-A6-F2 → guide/dedup/lease custody; later codegen suite → zero-advisory result contract.

5. **detail — “Append-only attempts” is stronger than the storage representation.**

   Attempt rows are inserted at claim and later updated to fill completion/outcome fields. That is monotonic, one-row-per-attempt history, but not literally append-only storage.

   Resolve by saying “append-only attempt identities with a one-time terminal completion” or by adopting separate immutable attempt events.

## Verdict

**NOT READY.**

The architecture is strong and the shipped slice is credible, but the idempotency contract, drain bound, and shipped-versus-future boundary are load-bearing enough that the document has not yet reached the stated READY bar.

## Next step

Revise the RFC to settle idempotency equivalence, state the actual drain bound, and place an unmistakable future-design boundary around the remainder. Then update the evidence citations and request a focused Codex re-review of the new exact hash. The author remains responsible for any status transition.

*(Runner note: the verbatim body above is unaltered except that file citations the reviewer emitted as absolute paths into the disposable review worktree are mechanically rewritten to the equivalent paths under /Users/ccheever/projects/snapback/ to avoid dead worktree links; raw output is preserved in the session capture.)*
