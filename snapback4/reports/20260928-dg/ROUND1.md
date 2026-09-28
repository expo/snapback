# Lane DG round 1 — scope the audience and helper diagnostics

Completed the round-1 changes requested after Astra READY and Grok READY
WITH CHANGES. First ran `git fetch origin && git merge origin/main`:
already up to date, with no conflicts. Starting HEAD was round 0,
`dc507b531`; origin/main remained `a745b110f`. Read the original prompt,
round-0 report and journal entry, both reviews in full, and LLP 3000.028.
Nothing pushed or published; no tools installed or shared paths changed.

## Changes and regression evidence

1. **M6 scope.** Only `public_conflict`, after proving inherited horizon-free
   public sync and a conflicting read, describes lost offline aggregate/absence
   coverage. The generic view-sync rewrite is exactly “remove this sync line
   to inherit, or replace it with `online only`”. Tests cover an unsynced public
   source, an explicitly online-only source, and both builder public conflicts.
   Both generic repairs compile and leave source and view unsynced. Existing
   ergonomics and residency assertions now expect the generic repair.
2. **M8 scope.** The caller chain, named job and partial-total wording require
   `call_chain.len() > 1` and nonempty `helper_job_callers`. Other non-uniform
   query prefixes get `use first N` with a cursor, or the deciding-column repair.
   Negative assertions cover the existing `prefix_reads` loop/merge shapes and
   a query-only helper. They exclude helper/system/job/partial-total claims.
3. **Job costs.** Compiler-only `BoundProgram.job_bound_helpers` records helpers
   whose expansion under a job contains a non-uniform meter-bounded read.
   Only those jobs receive the helper/preview paragraph in `why`/`check --cost`.
   This works on the unchanged builder, without requiring an invalid preview
   to be added first. Inline job reads, a harmless helper, and a helper with a
   uniform owner prefix get no digest advice. Each scan/point retains its
   structural visibility line. The existing 16,384-row job ceiling stays.
4. **Negative and transitive coverage.** Public-conflict rewrites and the
   grouped note reject source-narrowing advice. A job now reaches `digestCounts`
   through `jobCounts` in a regression. Astra's sibling case calls `harmless`
   before `digestCounts` and asserts the exact ordered chain excludes it.
5. **Registry and docs.** N_MAINTAIN_SYNCED's one-liner names no horizon and
   the offline aggregate/absence loss. The bounds/maintains cards state the
   diagnostic scope, and LLP 3000.028 §10 plus its Revised line record it.

No core, device, authority, disclosure, runtime meter, schema/IR serialization,
dependency, version or budget changes. The metadata above is compiler-side
inspection context, not a new runtime capability. Original builder compile,
job IR compatibility and the existing runtime witnesses remain covered.

## Validation

Final affected targets total **278 passing tests**, one intentionally ignored
external full-store test. This includes the **whole guide, 92/92**, and the
**CLI check target, 75/75**. The ignored test requires the copied calibration
store and passed in round 0; it was not rerun for these presentation changes.
The 100-chat/two-page and oversized-recipient runtime witnesses both pass.

| Target | Final result | Evidence under `logs/round1/` |
| --- | --- | --- |
| `audience_bounds` | 8 passed | `restored.log.gz` |
| `audience_bounds_runtime` | 2 passed, 1 ignored | `affected.log.gz` |
| `ergonomics` | 22 passed | `affected.log.gz` |
| `guide` (entire target) | 92 passed | `affected.log.gz` |
| `helper_placement` | 8 passed | `affected.log.gz` |
| `maintains` | 14 passed | `affected.log.gz` |
| `prefix_reads` | 10 passed | `affected.log.gz` |
| `residency_notes` | 40 passed | `restored.log.gz` |
| `server_opt_in` | 7 passed | `affected.log.gz` |
| CLI `check` (entire target) | 75 passed | `cli.log.gz` |
| Diagnostics registry, explicit rerun | 1 passed | `diagnostics-registry.log.gz` |
| Root ref-check | 522 LLP docs, 9,751 refs; 0 errors/unchecked | `ref-check.log.gz` |
| Wasm build/budget | Passed, byte-identical to round 0 | `wasm.log.gz` |

The registry command is Snapback 4's `guide::every_emitted_code_is_explained`
test, which checks emitted codes against `guide::CODES`. Snapback 1's generated
line-pinned registry does not apply inside the Snapback 4 fence.

Commands from `snapback4/`, using Rust 1.97.0, Node 24.13.1, wasm-bindgen
0.2.127 and the existing worktree cache:

```sh
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
export RUST_TEST_THREADS=8 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo test -p snapback4-lang --test audience_bounds --test audience_bounds_runtime --test prefix_reads --test helper_placement --test maintains --test residency_notes --test ergonomics --test server_opt_in --test guide --no-fail-fast
cargo test -p snapback4 --test check --no-fail-fast
# After correcting the residency expectation and restoring all mutations:
cargo test -p snapback4-lang --test audience_bounds --test residency_notes --no-fail-fast
cargo test -p snapback4-lang --test guide every_emitted_code_is_explained -- --exact
bash scripts/build-wasm.sh
# Repository root:
./ref-check --verbose
git diff --check
```

**`scripts/test.sh` was not run**, as instructed for round 1. The supervisor's
landing suite is next; no full-suite green claim follows from this report.

## Failure ledger

All observed test failures are **ours**, either reproduced round-0 defects,
deliberate mutations, or the corrected expectation below. No baseline or
environmental test/build failures occurred.

Before the fixes, the new/strengthened tests produced six failures:

- `generic_view_sync_refusal_does_not_claim_coverage_from_an_unsynced_source`:
  generic rewrite incorrectly claimed coverage loss.
- `query_only_helper_gets_the_generic_prefix_repair`: no job calls the helper,
  but the refusal still claimed job/partial-total context.
- `guide_and_why_keep_the_replica_and_partial_total_consequences`: registry
  one-liner omitted no-horizon and absence-loss facts.
- `prefix_reads::nonuniform_meter_domains_refuse_but_an_explicit_page_compiles`:
  the ordinary query incorrectly received M8's helper/job explanation.
- `check::audience_bounds::builder_why_names_inherited_horizon_and_the_jobs_actual_meter`:
  scan/point visibility was replaced by the blanket system-job line.
- `check::audience_bounds::unrelated_job_costs_keep_visibility_without_digest_advice`:
  an unrelated job received the digest paragraph and lost its visibility line.

Evidence: `regressions-before.log.gz` and `cli-before.log.gz`. These failures
prove the assertions reject the pre-fix product; all now pass.

The first affected run after the fix had one failure:
`residency_notes::maintain_sync_explains_inheritance_and_both_valid_choices`
still pinned round 0's incorrect generic rewrite. Corrected that expectation;
the whole 40-test target then passed (`restored.log.gz`). Every other target
in that run, including the entire guide, passed. The initial affected run
remains recorded as red.

Each review mutation was separately applied, compiled and rejected by its
targeted test, then restored in a `finally` block before the next mutation:

| Deliberate mutation | Failing regression | Evidence |
| --- | --- | --- |
| Append “Or narrow the public source so the view can sync privately.” to `public_conflict`'s rewrite | `builder_public_aggregate_refuses_both_edits_and_explains_each_repair` | `mutation-narrow-public-source.log.gz` |
| Remove callee traversal from `helper_job_callers` | `helper_refusal_finds_a_transitive_job_caller` | `mutation-transitive-job.log.gz` |
| Remove `self.call_chain.pop()` | `completed_sibling_helper_is_not_part_of_the_refused_caller_chain` | `mutation-sibling-stack.log.gz` |

Each command exited 101 with the named assertion failure, not a build error.
The restored 8-test diagnostic target passes. Temporary mutation code is absent
from the committed sources. During orientation, two guessed source paths
(`bind.rs` and `bind/program/mod.rs`) did not exist; these were **our setup
errors**, corrected by inspecting `bind/mod.rs` and `bind/program.rs`.
Existing dead-code/unused-import warnings from tiny_http and the web core are
baseline warnings, not failures; no new production warning was introduced.

## Wasm and handoff

Round 0 and this round both measure **2,019,815 B raw / 585,384 B gzip**.
Delta **0 / 0 B**. SHA-256:
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
The unchanged 586,193 B gzip budget has 809 B headroom. The ordinary build
reused unchanged device inputs; no clean rebuild claim is made. No wasm-opt
was installed or used. See `wasm-round1.json` and the build log.

Applied the repository's `llp-orient` read-only from the already initialized
lane-a5 skill, as in round 0; no other lane was modified. Context remains
LLP 3000 / 2000.000, LLP 3000.007 §§5.2, 6.7–6.8, 20.22 and
LLP 3000.028 §§4, 7.4–7.5 (current, not foundation). The review narrows
diagnostic claims; it changes none of those runtime constraints. Existing
references still apply. Journal appended; no new LLP or gate.

Commit trailer: `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
The supervisor owns the next landing suite; this lane commits locally only.
