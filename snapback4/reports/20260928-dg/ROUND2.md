# Lane DG round 2 — query-cap eligibility and gated why pages

Fixed all three findings in Grok's round-1 READY WITH CHANGES review.
First command: `git fetch origin && git merge origin/main`; already up to
date, no conflicts. Starting HEAD: `11c0a9f3456f22dfaf369e85a282ac56c4fd799b`.
Read both previous prompts, reports and journal entries, the round-0 reviews,
the entire round-1 Grok review, and the governing LLP 3000.028.
No push, publication, tool installation or other-lane mutation.

## Changes

1. **Query eligibility controls job-cost advice.** `job_bound_helpers` still
   requires an active helper call and a non-uniform meter read. It now excludes
   reads whose pinned index columns carry a group cap within the **query**
   examined ceiling, 8,192. A job's use of `Bound::Meter` alone is insufficient.
   Cap 10 is query-eligible; cap 10,000 and no cap retain the advice. A cap on
   an unpinned column does not qualify. This changes diagnostic metadata only;
   the binder's bound selection, IR, authorization and runtime meters are unchanged.
2. **Dedicated why pages carry the same conditions.** E_QUARRY_SYNTAX starts
   with the generic remove-to-inherit/replace-with-online-only repair and gates
   the offline-loss explanation on proved horizon-free public inheritance plus
   a narrower explicit read. It explicitly distinguishes an unsynced/online-only
   source with no partition to lose. E_QUARRY_BOUND promises caller-chain/job
   context only for a non-uniform meter read inside a helper reached by a job;
   other prefixes retain the generic page/cursor or deciding-column repair.
3. **Two wrappers protect transitive job traversal.** The full builder's job
   now reaches `digestCounts` through `jobCounts` and `wrappedCounts` in the
   regression. The actual caller walk already handles this depth; only the
   regression changes. Restricting traversal to expansion of direct job callees
   is now detected.

The compiler regression exercises both a loop and `count` aggregate at every
cap case, checking job metadata against actual query admission/refusal. The CLI
regression checks both `why sweep` and `check --cost`; its cap-10 program includes
the legal `preview` query. The guide/why regression asserts complete conditional
statements and excludes the former ungated sentences, rather than checking only
that words such as "caller chain" occur somewhere.

## Final validation

**280 affected tests pass**, including the whole guide (92/92), CLI check
(76/76), and both ordinary job/preview runtime witnesses. One external-store
witness is intentionally ignored; its round-0 evidence remains, and the original
calibration store was not opened or changed in this round.

| Target | Final result | Evidence under `logs/round2/` |
| --- | --- | --- |
| `audience_bounds` | 9 passed | `affected.log.gz` |
| `audience_bounds_runtime` | 2 passed, 1 ignored | `affected.log.gz` |
| `ergonomics` | 22 passed | `affected.log.gz` |
| `guide`, whole target | 92 passed | `affected.log.gz` |
| `helper_placement` | 8 passed | `affected.log.gz` |
| `maintains` | 14 passed | `affected.log.gz` |
| `prefix_reads` | 10 passed | `affected.log.gz` |
| `residency_notes` | 40 passed | `affected.log.gz` |
| `server_opt_in` | 7 passed | `affected.log.gz` |
| CLI `check`, whole target | 76 passed | `cli.log.gz` |
| Explicit diagnostics-registry rerun | 1 passed | `diagnostics-registry.log.gz` |
| Root ref-check | 522 LLPs, 9,751 refs; zero errors/unchecked | `ref-check.log.gz` |
| Wasm build/budget | Passed, byte-identical | `wasm.log.gz` |

Whitespace checks pass. No final test/build failures remain.

The removed build target was rebuilt in this worktree. The wasm target was
rebuilt and compared with the preserved round-1 bundle: **2,019,815 B raw /
585,384 B gzip**, delta **0 / 0 B**, SHA-256
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
The unchanged **586,193 B** gzip budget has **809 B** headroom. This is a fresh
current-target build against the saved same-toolchain prior artifact, not a
second rebuild of the prior source. No wasm-opt was installed or used.
See `wasm-round2.json`.

## Failure ledger and mutation evidence

All test failures below are **ours**, reproduced before the fix or introduced
deliberately for mutation testing. Every mutation was restored in a `finally`
block; the affected targets were subsequently run on the restored source.

| Run | Failure | Classification / result |
| --- | --- | --- |
| `regressions-before.log.gz` | `job_bound_helpers_require_a_query_ineligible_prefix`: cap 10 recorded `total` | Ours, reproduces round 1; fixed. |
| Same run | `guide_and_why_keep_the_replica_and_partial_total_consequences`: missing gated syntax why text | Ours, reproduces round 1; fixed. |
| `mutation-job-ceiling.log.gz` | Substituting `Ceilings::job()` hides the cap-10,000 helper | Ours, deliberate; the cap regression fails. |
| `mutation-E_QUARRY_SYNTAX.log.gz` | Restoring the round-1 syntax why page | Ours, deliberate; the guide/why regression fails. |
| `mutation-E_QUARRY_BOUND.log.gz` | Restoring the round-1 bound why page independently | Ours, deliberate; the guide/why regression fails. |
| `mutation-direct-callees-only.log.gz` | Expand only the job's direct callees | Ours, deliberate; the two-wrapper regression fails. |

The pre-fix run exited 101 with 7 passes and 2 assertion failures. Each mutation
exited 101 with its named assertion failure, not a compilation error. The first
post-fix diagnostic run passed all 9 tests (`regressions-fixed.log.gz`).

Baseline test/build failures: none. Environmental test/build failures: none.
Two orientation probes encountered expected missing local state: the unpopulated
`skills/llp-orient` target and the removed `snapback4/target` directory
(environmental setup, exits 1 and 2). Read the already initialized lane-a5 skill
without modifying it, and rebuilt in this worktree. No tool installation was
needed. Existing compiler warnings are retained in the build logs.
One doc-only patch attempt used a nonexistent context line (**ours**) and was
rejected without changing a file; the corrected report patch succeeded.

## Commands

From `snapback4/`, Rust 1.97.0, Node 24.13.1, wasm-bindgen 0.2.127; eight Cargo
jobs/test threads, debug info and incremental off, fd limit 65,536, and packaged
SQLite flags, matching prior rounds. Logs are under `logs/round2/`.

```sh
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
export RUST_TEST_THREADS=8 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo test -p snapback4-lang --test audience_bounds --no-fail-fast
# Mutations each run their named test with -- --exact, then restore source.
cargo test -p snapback4-lang --test audience_bounds --test audience_bounds_runtime --test prefix_reads --test helper_placement --test maintains --test residency_notes --test ergonomics --test server_opt_in --test guide --no-fail-fast
cargo test -p snapback4 --test check --no-fail-fast
cargo test -p snapback4-lang --test guide every_emitted_code_is_explained -- --exact
bash scripts/build-wasm.sh
# Repository root:
./ref-check --verbose
git diff --check
```

`scripts/test.sh` was **not run**, as explicitly instructed for round 2.
The supervisor owns the landing suite. The registry check is Snapback 4's
emitted-code/CODES check; Snapback 1's line-pinned registry is outside this fence.

## Orientation context

Applied `llp-orient` read-only from the initialized lane-a5 copy, as in prior
rounds. Scope: helper-scan inspection metadata, dedicated why pages and their
compiler/CLI regressions. Governing LLPs remain current, not foundation:

- LLP 3000 and LLP 2000.000 §§6–7: disclosure, meters and partition coverage.
- LLP 3000.007 §§5.2, 6.7–6.8, 20.22.2–20.22.3: caller placement, inherited
  audiences, and the distinction between a fitting cap and a meter-bound prefix.
- LLP 3000.028 §4 and §§7.4–7.5: source/caller context and repair consequences.

The existing `@ref` at the metadata site still applies. This round corrects
inspection claims under the existing rules; it introduces no authority, meter,
device, schema/wire, dependency, version or budget change. LLP 3000.028's Revised
line and §10 record the correction. The remaining RFC capabilities and browser/
Expo witnesses belong to other lanes. Hand-off: none for these findings.

Commit trailer: `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
