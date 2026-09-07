# Independent review: ad hoc live-generation admission

**Candidate:** `cd610a50e9aab41c3e13620e0aefe8d6da5115f3`  
**Baseline:** `97b4a5b2c218162f8a20a03928574dbd50608106`  
**Reviewer:** one independent source reviewer; no peer, author, or other-family report consulted.  
**Qualification:** this is a frozen-snapshot pair review. It is not publication or full capability qualification. Muse ultra execution is unestablished here; no third review is claimed.

## Verdict

**READY**

The change deletes the redundant second `Generation::certify` on the same live owner generation for ad hoc run/enqueue, samples the owner clock only after that one live admission, and leaves compiler-output admission, rehearsal live-then-copy admission, plan admission, execution identity checks, and transaction/refusal behavior intact. I did not find a material supported-behavior counterexample in this snapshot pair.

## What the delta does

Seven files. Relative to baseline `State::adhoc` (`baseline/snapback2/crates/snapback2/src/writer_jobs.rs` 244–270), a successful ad hoc query, mutation, or job enqueue certified against the live generation twice on the writer thread: once in `adhoc`, then again inside `execute_adhoc_operator` / `enqueue_adhoc_job`. Both calls used `Runtime::certify_operator_program`, which reconstructs a `ProjectJson` from the live schema, declared programs, timer bindings, and effects and runs complete `Generation::certify` (`snapback2/crates/snapback2-core/src/registry_jobs.rs` 248–280). The candidate removes the writer-side pre-certify on the run/enqueue arm and keeps a single live certify inside those entries, with `now: impl FnOnce() -> i64` invoked only after that certify returns.

Plan still certifies once and does not sample execution time. Rehearsal still admits on the live runtime before the snapshot, then recertifies on the copy at execute/enqueue. Compiler-output admission remains a separate `compile_source` step whose certificate is not the execution certificate.

## Material findings

None.

I looked for a supported-behavior break on: missing live effect/schedule/program admission, clock sampled on a refused certify, offset dropped, compiler certificate used as live authority, skipped `plan_hash` / `schema_hash` / `bound_hash` checks, a commit on a refused admission, rehearsal skipping live admission, or a caller still passing `i64` now. I did not find one that names a current-main path and a minimal input.

## Scope-checked behavior

### 1. Same-live-generation certify is removed only on run/enqueue

Candidate `State::adhoc` (`snapback2/crates/snapback2/src/writer_jobs.rs` 244–272):

- `plan`: still `certify_operator_program` then `plan_job`; no clock closure.
- Job run: `enqueue_adhoc_job(..., now, source)` with no prior live certify.
- Query/mutation run: `execute_adhoc_operator(..., now)` with no prior live certify.

Those Runtime entries still certify once (`registry_jobs.rs` 38–39 and 292–293) before `now()`.

Callers of the new `FnOnce` signatures, all updated:

| Site | After admission |
| --- | --- |
| `writer_jobs.rs` 255–272 | `\|\| unix_millis().saturating_add(clock_offset_ms)` |
| `rehearsal.rs` 226–231, 258–261 | `\|\| self.now` (pinned `i64`) |
| `tests/jobs.rs`, `tests/timers.rs` | `\|\| 1`, counting/panic closures |

No remaining `enqueue_adhoc_job` / `execute_adhoc_operator` caller passes a bare `i64`. `packages/evaluator` has no such API; LLP 1016’s systems line is still correct that this plane does not run on the twin.

Declared `enqueue_job` / `execute_operator_at` still take `i64` and do not recertify; they resolve the live map. Out of this deletion’s target.

### 2. Compiler-output versus owner-generation authority

`POST /control/run` still compiles on the owner worker (`control_run.rs` 139–193) and hands IR to `Action::Adhoc` or `Target::Adhoc`. Compiler programs are named `__adhoc.*`. The writer then renames to `adhoc:{source_hash}` and certifies against the live `Runtime` generation, not against the compiler’s project hash.

Raw after-query events (`evidence/receipts/after-diagnostic.json` query):

- compiler: programs `["__adhoc.inspect","admin.clock"]`, `projectHash` `23927eb2…`, `ThreadId(12)`
- live: programs `["admin.clock","adhoc:3fc164dc…"]`, `projectHash` `29935a88…`, `ThreadId(8)`

Those hashes differ, so execution is not using the compiler certificate. `Engine::execute_with_kind` still rejects `plan_hash != digest(program)` and `schema_hash != self.hashes.schema` (`engine/mod.rs` 579–591) before opening a write transaction. Job chunks still require `certificate.plan_hash == bound_hash(...)` and `certificate.schema_hash == self.hashes.schema` (`engine/jobs.rs` 16–23).

This matches current-main identities: `Generation::hash()` is schema-only (`registry.rs` 97–100); effects are a separate digest (`effects_hash`); `certify_operator_program` still feeds live `generation.effects` and `timer_bindings` into `Generation::certify`, which refuses undeclared emits (`registry.rs` 450–467). A successor that only drops effects keeps the same schema hash and still fails live ad hoc admission (`tests/jobs.rs` 1001–1068).

`Runtime::execute_adhoc` (`registry.rs` 878–886) still uses `Checker::check` only. That is the `data` adapter (`writer_data.rs` 148), not the operator `--file` / `/control/run` seat. Baseline D6 prose pointed at that checker path; candidate D6 points at `certify_operator_program`. The operator path already used the complete checker in baseline; this delta does not reintroduce the skip.

### 3. FnOnce clock / error ordering / offset

`execute_operator` pins `context.now` and `context.read_time` to the sampled `i64` (`engine/operator.rs` 14–23). Quarry `now` lowers to `Input::ReadTime` in queries and `Input::Now` in mutations (`packages/compiler/src/lower/expr.ts` 530–532). Queries that mention `ReadTime` get `read_time_granularity_ms: 1` (`compiler.ts` 269). Certification refuses `ReadTime` without that declaration (`certificate_policy.rs` 671–677). The engine then returns the pinned `i64` as `Value::Int` (`engine/runner.rs` 677–695). That is this tree’s value identity, not a separate evaluator.

Writer offset: `State::now` is `unix_millis().saturating_add(self.clock_offset_ms)` (`writer.rs` 1436–1438). The ad hoc closure copies `clock_offset_ms` then samples `unix_millis` only after admission (`writer_jobs.rs` 255–256). On the one writer thread, offset cannot change during `certify_operator_program`. The sample is later than baseline’s pre-second-certify `self.now()`, which is the intended ordering.

Refusal before time:

- Empty job body: `jobs.rs` 239–240 shape error → `RuntimeError::Schema`; test panic-clock is not invoked; `commit_seq` unchanged (`tests/jobs.rs` 901–931).
- Missing live effect after same-schema successor: Schema, panic-clock not invoked, seq unchanged (1001–1068).
- Extra job args at the core entry: clock **is** sampled, then `E_JOB_ARGS`, no commit (948–964). The comment is accurate: the wire already ran `job_args` (`writer_jobs.rs` 242) so `/control/run` extra/typed args never reach this core order. Diagnostic argument-refusal stays compiler 1 / live 0.

Rehearsal pin: `rehearsal_snapshot` evaluates `self.now()` as a `capture` argument (`writer_rehearsal.rs` 36–43) before `admit` inside `capture` (`rehearsal.rs` 89). That pin is unchanged from baseline and is not the run/enqueue FnOnce. Copy execute uses `|| self.now` (Copy `i64`); if copy recertify fails, the closure is not invoked. Receipt `now` still comes from the snapshot field.

### 4. Query / mutation / job / plan / control / rehearsal

| Path | Live certifies | Clock |
| --- | --- | --- |
| `/control/run` query/mutation | 1 (`execute_adhoc_operator`) | after admit, with offset |
| `/control/run` job enqueue | 1 (`enqueue_adhoc_job`) | after admit; `created_at` is that sample |
| `/control/run` plan | 1 in `adhoc` | none |
| dry-run ad hoc | live `admit` + copy execute/enqueue | pin from capture; copy FnOnce returns pin |
| kind/seat/arg/compiler refusal | 0 live | none |
| rejected mutation (`require false`) | 1 live, then execute | sampled; no commit (`after_commit` only on `Committed`) |

`ExecutionState::Rejected` is not a `RuntimeError`; `adhoc` still returns JSON state `rejected` without `after_commit` (`writer_jobs.rs` 270–276). Identity mismatch remains `Err(TraceSubset)` before the mutation transaction (`engine/mod.rs` 579–591, 607).

Chunk-time binding is unchanged: stored IR+certificate, reuse when `stored.schema_hash == generation.hash()`, else recertify (`registry_jobs.rs` 219–230). Restart still does not recompile source. Candidate D6 now states that; baseline D6 said a restart can recompile, which did not match this `job_program` path.

### 5. Tests added/updated

- `adhoc_admission_precedes_clock_sampling_and_execution_input_errors`
- `adhoc_query_and_mutation_use_one_supplied_clock_sample`
- `adhoc_effect_admission_uses_current_declarations_even_with_the_same_schema_hash`
- Owner control test advances `/control/clock` by 86400000 ms, runs `query inspect(): return now`, requires `data > wall_now + 86000000`, then a mutation `return now` with `data >=` that query (`owner_cases/rehearsal.rs` 245–293).

Those cover ordering, one sample, offset, query ReadTime vs mutation Now, and live effects independent of schema hash.

## Evidence receipts (facts, not conclusions)

I did not run these processes. The files under `evidence/` are retained receipts.

- `evidence-facts.md` / `frozen-vs-tested.json`: candidate `cd610a50…` vs parent `97b4a5b2…`; 940 Git-derived leaves; Rust/test bytes equal the tested Linux projection; LLP wording is the only post-build source difference.
- `check-summary.json`: `test-jobs`, `test-timers`, `test-rehearsal-unit`, `test-owner-rehearsal` exit 0. `test-owner-jobs` and `test-owner-operator` exit 101; `*-with-media` counterparts exit 0. `test-jobs.stderr` is empty; `test-jobs.stdout` records the three new tests ok (20 passed, 1 ignored measurement). `test-owner-rehearsal.stdout` records 4/4 ok including `control_run_source_modes_and_declared_job_route_share_operator_admission`.
- Initial owner reds: `E_ASSET_NOT_READY` because the media helper was absent; those reds remain on the non-media receipts. Not treated as an admission-logic failure.
- `diagnostic-before.terminal.json` exit 1: observer same-thread assertion on rehearsal live-versus-copy (two live certifies, writer vs copy thread). `diagnostic-corrected.py` skips that assertion for `dry-run` and skips already-completed before names in `before-tail`. `diagnostic-after.terminal.json` exit 0.
- `certification-counts.json` / `after-diagnostic.json`: ordinary query/mutation/enqueue/rejected mutation live 2→1, compiler 1 retained; plan 2→2; rehearsals 3→3; kind/seat/arg 1→1; compiler refusal 0→0. Count reduction is not a speedup or benchmark claim.
- After query response `state: complete`, `seq: 0`; after mutation `state: committed`, `seq: 1`. Matches query-no-commit / mutation-commit.

## Checks actually performed

Read-only. No product build, no test re-run, no network, no spawn, no worktree besides this frozen pair.

- `AGENTS.md`, `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, LLP 1001 §4 (generation hash / certify), LLP 1002 §5 (one writer thread, `/control/clock`), LLP 1016 D6 (candidate and baseline), packaged `guide/operator.md` and `guide/job.md`.
- Full `revision.patch` and every remaining caller of `execute_adhoc_operator` / `enqueue_adhoc_job` / `certify_operator_program` in candidate and baseline.
- `certify_operator_program` → `Generation::certify` (effects, programs, `timers::certify` bindings) → `run_operator` / `enqueue_certified_job` → `Engine::execute_operator` / `execute_job_chunk` identity checks.
- Compiler `now` lowering and query granularity; engine `Input::Now` / `Input::ReadTime` as `Value::Int`.
- New tests, owner clock assertions, rehearsal admit-before-copy, control_run compile-then-Adhoc.
- `evidence-facts.md`, `check-summary.json`, `certification-counts.json`, observer scripts, synthetic project text in those scripts, raw before/after/before-tail admission events and owner terminals.

## Remaining scope limits

- Isolated exact snapshots only. I did not read author/self-review/other-family reports or moving worktrees.
- I did not re-execute native tests. Receipts are not my execution. Where a receipt and the source agree, I treat the source as the behavior spec and the receipt as a prior observation.
- No cache, new auth mode, allocator, or unrelated migration/search change is in this patch; those were not reviewed as if they were.
- `execute_adhoc` (data verb) and declared operator `self.now()`-then-execute are unchanged and outside the redundant-live-certify deletion.
- Chunk-time reuse of a stored certificate when only effects changed (same schema hash) is pre-existing D2 binding, not introduced here; enqueue after that successor is what the new effect test covers.
- Fresh pair review does not supply publication or full capability qualification.

No independent native probe is required to settle a suspected defect. If a supervisor wanted confirmation only, the already-scoped Linux jobs/rehearsal tests plus the twelve `/control/run` observer cases are the same bounds as the retained receipts.
