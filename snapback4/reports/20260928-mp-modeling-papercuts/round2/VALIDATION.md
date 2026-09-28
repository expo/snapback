# MP round 2 — validation and failure attribution

Commands run in this lane's `snapback4/` workspace (or with its manifest from
the repository root). Existing Node 24.13.1, Rust 1.97.0 and wasm-bindgen were
used; no installation. No test count/timeout, budget, suite script or runtime
contract was relaxed. Baseline source is merge b7775db58.
Logs were compressed losslessly after capture; `gzip -dc FILE.log.gz` reads
the original bytes. Commands and the counterfactual script emit `.log` first.

## Commands and results

- Broad affected: `CARGO_BUILD_JOBS=8 cargo test --workspace --no-fail-fast
  --test dev_refusals --test mp_reproduction --test mp_builder --test guide
  --test read_through --test read_through_review --test read_through_transactions
  --test read_through_sync --test read_through_provenance --test sequence_by
  --test sequence_disclosure --test written_by --test disclosure --test meter
  --test ephemeral` → `affected.log.gz`, exit 0; 388 passes / 25 targets.
- `cargo test -p snapback4-lang --no-fail-fast --test mp_reproduction --test guide`
  → `grok-guide.log.gz`, 94 guide + 18 MP passes; final trace-helper-only rerun
  → `final-trace-helper.log.gz`.
- `cargo test -p snapback4 --bin snapback4 refusal -- --nocapture`
  → `final-native.log.gz`, 16 passes.
- `cargo test -p snapback4 --test dev_refusals -- --nocapture`
  → `final-process.log.gz`, 7 passes. Final `cargo test -p snapback4 --test
  dev_refusals` → `final-process-race.log.gz`, 8 passes including the added
  deterministic second-liveness-check race.
- `python3 reports/20260928-mp-modeling-papercuts/round2/counterfactual.py`
  → seven `mutation-*.log.gz` failures, all expected, repairs restored byte-for-byte.
- `bash scripts/build-wasm.sh` → `wasm-baseline.log.gz`, `wasm-final.log.gz` and
  final `wasm-confirm.log.gz` (figures below).
- Repository-root `./ref-check --verbose` → `ref-check.log.gz`, exit 0; final
  post-journal audit → `ref-check-final.log.gz`, exit 0 (522 LLP docs, 9,803 refs,
  0 errors, 0 unchecked).
- `CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8
  bash scripts/test.sh` → `full-suite.log.gz` / `full-suite.exit` (one invocation).
- After correcting test-module discovery, `CARGO_BUILD_JOBS=8
  RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 node
  scripts/run-rust-tests.mjs` → `rust-recovery.log.gz` / `rust-recovery.exit`,
  exit 0: **4,246 passed, 0 failed, 33 existing ignored**, 987 test-result
  summaries including doctests. Its compiled process target had seven tests;
  `final-process-race.log.gz` covers the final eighth. No exclusions or timeout
  changes. Overlapping run counts are not summed.

## Every observed failure

| Observation | Attribution and disposition |
| --- | --- |
| Initial exploratory reads used nonexistent guessed module paths, the uninitialized skill symlink, or produced truncated output | **Ours**, read-only command errors. Located actual modules and the existing coldclone skill; no state was changed. |
| `build-first.log.gz`: removed Capture still referenced by ephemeral handlers; helper visibility too narrow; channel element type ambiguous | **Ours**, compile errors while integrating the response scope. Rewired ephemeral contexts, widened internal visibility and fixed the channel type. |
| `host-first.log.gz`: test-only reader constructors/replacements lacked source maps | **Ours**, compile errors. Updated all affected test publishers to pass the corresponding bound sites. |
| `process-first.log.gz`: fixture attempted authored `require ... else E_RULE` | **Ours**, invalid fixture; E_ codes are reserved by the compiler. Used authored NOT_FOUND for the process fallback, plus a bare injected E_RULE responder independent of the compiler/collector. |
| `phase-guide-final.log.gz`: trace comparison tried a mutable transaction through `store()` | **Ours**, test compile error. Uses `store_mut()`; both query and capture bytes/meters now pass. |
| An edit command used root-relative paths with the Snapback 4 working directory | **Ours**, FileNotFound before editing; reapplied from the repository root. |
| `phase-guide-fixed.log.gz`: guide tests `familiar::every_moved_fact_has_its_why_or_details_home` and `w9b_every_code_has_bounded_card_context_and_a_full_card_command` found E_RULE at 4,195 bytes | **Ours**, why text over its ceiling. Shortened the explanation; all 94 guide tests pass without a limit change. |
| `process-complete.log.gz`: replay test expected the original verbose refusal text | **Ours**, incorrect fixture expectation; baseline replay deliberately reconstructs a code-only generic message. Assert the preserved code and a new fallback record, without changing replay bytes. |
| Source-cap inspection found serve_tests.rs at 1,507 lines and read.rs at 1,502 | **Ours**, resolved before commit by extracting test-host setup and consolidating native result tracing into refusal_trace.rs. No cap increase; the latter preserves wasm no-op behavior and is retested. |
| The final staged whitespace check flagged trailing blank lines in 12 captured test logs | **Ours**, artifact packaging. All logs are now compressed losslessly; their original bytes remain available and the staged whitespace check passes. |
| `mutation-{query,fallback,phase,dropped,residual,temp,watermark}.log.gz` | **Ours, deliberate regression probes**, each removed repair causes a test failure. No mutant remains. |
| Complete script Rust artifact build: the included `tests/serve_refusals.rs` was auto-discovered as a standalone integration target, producing 93 missing-parent/import errors | **Ours**, test-module placement. Moved to `tests/serve_refusals/mod.rs` and updated the include, following existing host-test layout. Full-script result is retained; the complete Rust stage passed separately: 4,246 passed, 0 failed. |
| Baseline wasm build: 586,297 B vs 586,193 B ceiling; full-script candidate: 586,235 B; final candidate: 586,252 B | **Baseline/inherited qualification failure**. Final delta is −45 B gzip (−135 B raw), leaving 59 B over; the final source-cap helper extraction adds 17 B gzip versus the full-script artifact. No budget change. |

## Single full-script outcome

Exact summary: **`== 2 failure(s) in 1034 s`**, exit 1. Failed stages:

1. `wasm build`: **baseline/inherited**, 42 B over the unchanged budget, a
   62 B gzip improvement over the merged baseline. No waiver or raised ceiling.
2. `cargo test`: **ours**, the newly included `serve_refusals.rs` was also
   auto-discovered as an independent integration target. All 93 compile
   diagnostics derive from its missing parent context. The corrected module
   path is `tests/serve_refusals/mod.rs`. The native unit tests themselves had
   passed under the binary target. Complete Rust recovery is recorded separately.

Passing stages: cargo build, docs budget, release guard, package typecheck/build,
chat check/typecheck, Expo typecheck, fixture wrapper tests (9), client tests
(4,194 passes, 10 existing skips), client models (79 passes). No environmental
failure was observed. `scripts/test.sh` was not invoked a second time.
The separate complete Rust recovery and final eight process tests pass; the
inherited wasm overrun is the only remaining observed qualification failure.
