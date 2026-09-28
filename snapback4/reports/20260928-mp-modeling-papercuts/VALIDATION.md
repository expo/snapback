# Validation and failure attribution

The expected pre-change refusals in `baseline-*.json` are reproductions, not
unexpected test failures. No baseline diagnostic was reclassified as a pass.
All failed development attempts below are **ours**, and fixed unless explicitly
listed as a remaining qualification limitation. Expected caught panics inside
guide negative tests are not failures; their test results pass.

| Log(s) | Every unexpected failure in that attempt | Resolution |
| --- | --- | --- |
| check-1.log | Rust E0502, wrong `self` borrow in authorization closure | Use the closure's runner. |
| check-2.log | Private BoundProgram.sources field | Removed the attempted execution-path-to-source mapping. Schema-clause coordinates are exact; the execution site is explicitly a runtime coordinate. |
| affected-1.log | parent_denials_hide_other_groups_and_unpinned_scan_still_refuses | The test used different-length caller IDs, giving different caller-owned key heap charges. Compare absent/hidden worlds at the identical key. |
| affected-2.log | definitions::w11_every_registered_code_quotes_its_definition; w11_every_registered_code_has_a_dedicated_section; every_card_compiles_clean | Add the new diagnostic's reviewed definition/action facts and dedicated why mapping/header; give the example sync horizons. |
| affected-3.log | developer_gets_each_cause_without_changing_one_byte_of_the_refusal | Test compared a reference to a text literal. Use the text key to select the allowance case. |
| affected-4.log, affected-5.log, affected-6.log | definitions::w11_every_registered_code_quotes_its_definition; w11_every_registered_code_has_a_dedicated_section | Complete the dedicated why mapping/header corrections. Whole guide subsequently 93/93. |
| affected-7.log | developer_gets_each_cause_without_changing_one_byte_of_the_refusal | Nonunique rule-probe fixture needed named parent equality. |
| affected-8.log | developer_gets_each_cause_without_changing_one_byte_of_the_refusal | Generated index name differed from the test's guessed name. Developer clauses now identify unique columns, with source mapping verified. |
| affected-9.log | parent_totals_memory_coverage_and_expiry; parent_totals_sqlite_coverage_and_expiry | The test assumed the server-owned aggregate group index existed on replicas. Keep enumeration unknown/fallback, document that boundary, test server expiry and device withholding. No offline enumeration is claimed. |
| affected-10.log | developer_gets_each_cause_without_changing_one_byte_of_the_refusal | A permanent witness is decided immediately; it did not exhaust the allowance. Use 8,193 expiring witnesses, which require the bounded lifetime walk. |
| affected-11.log | Rust format argument never used | Restrict the added preview-caller argument to the contextual diagnostic branch. |
| affected-12.log | raw_ir_cannot_enumerate_unpinned_parent_groups | The forged-operation engine still had a digest schedule but omitted its job. Retain the other fixture programs. |
| device-1.log | parent_totals_memory_coverage_and_expiry; parent_totals_sqlite_coverage_and_expiry; rewritten_builder_own_state_memory_reopen; rewritten_builder_own_state_sqlite_reopen | Correct expiry syntax and seed timeline-mapped reposts through builder operations. |
| device-2.log | The same four device tests | Declare immutable read-through reference; finish replacing disallowed timeline fixture imports. |
| device-3.log | parent_totals_memory_coverage_and_expiry; parent_totals_sqlite_coverage_and_expiry | Declare the inherited captured deadline immutable. |
| dev-1.log | dev_reports_source_locally_and_production_keeps_the_same_caller_refusal | Runtime statement numbering is not the compiler read-site counter. Record it as executionSite, alongside the exact schema clause site. |
| dev-2.log | dev_reports_source_locally_and_production_keeps_the_same_caller_refusal | Production fixture must create a local deployment directory and mint a service token for that store. |
| rust-recheck.log | durable_schema_and_types_keep_base_bytes in snapback4-lang::ephemeral_compat | The new fixture was placed in a directory frozen by the compatibility census. Move it to fixtures/mp/builder.q; preserve every frozen expectation. The target and new fixture tests pass in final-affected.log. |
| full-suite.log | Cargo test artifact build: missing `refusals` in serve_tests Shared initializer; consequently the cargo test stage failed | Initialize the test fixture and rerun the entire Rust stage (`rust-recheck.log`), not scripts/test.sh again. |

The final source-cap audit also caught the extra initializer line taking
serve_tests.rs from 1,500 to 1,501 lines (ours). The initializer now sits beside
the other observation state and the file remains at 1,500 lines.

Several inspection/edit commands also used the repository-root path prefix
while their working directory was already snapback4 (ENOENT), and exploratory
reads named nonexistent source paths. These were our command mistakes, did not
edit evidence or other worktrees, and were corrected. They are not product or
environmental failures. No shared tool installation was attempted. Saved command logs have terminal
whitespace normalized; copied source evidence and the baseline refusal bytes
are unchanged.

## Commands

All Cargo/Bun/Node commands below run from `snapback4/`, except ref-check and
whitespace checks at the repository root. Logs retain each attempt.

- Baseline native build, five reconstructed `snapback4 check --json` calls,
  initial runtime and offline reproduction tests, baseline build-wasm.
- Affected matrix: `cargo test --workspace --no-fail-fast --test mp_reproduction
  --test mp_builder --test dev_refusals --test audience_bounds
  --test audience_bounds_runtime --test guide --test read_through
  --test read_through_review --test sequence_by` (`affected-10.log`).
- Corrected guide/diagnostic checks: `cargo test -p snapback4-lang --no-fail-fast
  --test mp_reproduction --test audience_bounds --test guide`
  (`affected-12.log`, guide and audience bounds pass).
- Final corrected MP target: `cargo test -p snapback4-lang --test mp_reproduction`
  (`affected-13.log`, 8 passed).
- One and only one `bash scripts/test.sh` (`full-suite.log`).
- Failed-stage recovery: `node scripts/run-rust-tests.mjs` (`rust-recheck.log`).
- `./ref-check --verbose` (`ref-check.log`).
- Final corrections: `cargo test --workspace --no-fail-fast --test ephemeral_compat
  --test ephemeral --test mp_reproduction --test mp_builder --test audience_bounds
  --test dev_refusals` (`final-affected.log`: 57 passed, zero failures).
- `git diff --check` and changed-source line counts.

Final full-script result: `== 1 failure(s) in 3199 s`, `cargo test`, exit 1.
This is the initializer failure above (**ours**, fixed). All other script
stages passed: client tests 3,928 passed / 0 failed / 10 existing skips; model
tests 79 passed / 0 failed / 0 skipped. The full Rust recovery ran 266 binaries,
979 executions plus doctests: 4,201 passed / 1 failed / 33 ignored. Its sole
fixture-census failure was **ours**, fixed; final affected recovery passed all
57 tests. Whole compiled guide passed all 93 tests. There is no remaining
observed failure, and no baseline or environmental failure was waived.
