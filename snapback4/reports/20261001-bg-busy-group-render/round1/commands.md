# Commands and evidence map

Run Cargo/Bun/Node commands from `snapback4/`; `./ref-check --verbose` runs from
the repository root. Rust commands use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` throughout.

- `cargo test -p snapback4-core --lib engine::row_views -- --nocapture`:
  `row-views-final.log` (34 tests before the additional legacy-upgrade test).
- `cargo test -p snapback4-core --lib incremental_certification_matches_naive_after_every_random_step -- --nocapture`:
  `property-final3.log` (final assertions and operation histogram).
- `cargo test -p snapback4-core --lib legacy_basis_upgrades_atomically_before_reuse -- --nocapture`:
  `legacy-upgrade.log`.
- `python3 reports/20261001-bg-busy-group-render/tools/negative-control.py`:
  `work-control-round0.log`; the helper succeeds only when Cargo returns the
  expected 101. Its retained assertion reports 10,001 source rows versus zero.
- `cargo test -p snapback4-lang --test guide`: `guide-final.log` (whole guide).
- `node --test packages/snapback4/test/web-session-authority.test.mjs`:
  `authority2.log`. The corrected negative control temporarily substitutes
  `git show c0d6d1ee28:snapback4/packages/snapback4/src/app.ts` in that source
  path, runs this same test, and restores the candidate in `finally`:
  `authority-control-round0-source.log` (expected failure only at four reads).
- `affected-client.log`: the selected authority, app-local-session,
  query-publication, per-row, retention, live-propagation, answer-row,
  keep-authority and delivery-fault-matrix cohort (952 tests). The full suite
  subsequently selects every client file using its ordinary scheduler.
- `bash scripts/test.sh`: invoked **once**; `full-suite.log` and `full-suite.exit`.
- `cargo test -p snapback4-lang --test ephemeral_compat`:
  `ephemeral-compat-after2.log`, the focused correction of the full-suite failure.
- `./ref-check --verbose`: `ref-check-final.log`.

Measurement commands and instrumentation custody are in `../tools/README.md`.
`before-idle-traced` / `before-loaded` and `after-idle` / `after-loaded` are the
matched production traces; `after-pilot` is explicitly preliminary. `ll-before`
and `ll-after` use the unchanged LL debug-profile harness. Final qualification
uses the candidate wasm freshly rebuilt by the full suite, with `host-load.py`
sampling CPU. Each raw trace is retained as `.json.gz`, and each summary keeps
its sample-level stage table. Seed SQLite databases and temporary password
credentials remain outside the repository under `/tmp`.

Final focused correction evidence:

- `recorded-member-final2.log`: `cargo test -p snapback4-core --lib recorded_member_inputs_keep_the_disclosed_full_recount -- --nocapture`.
- `store-replacement-candidate3.log`: all nine replacement cases against the isolated corrected package.
- `keep-model-candidate.log`: all eighteen keep-model cases against the same package.
- `authority-matrix-final.log`: final source browser-authority and delivery-fault tests, 340 passed.
- `production-final-build.log` / `debug-final-build.log`: rebuilt instrumented profiles after the recorded-member fallback.

The full-suite exact summary is `== 2 failure(s) in 2647 s`: cargo test and client tests. The 17 individual failures, all ours, are enumerated in `failure-ledger.json`; each has a passing correction rerun. All 79 final serial models passed. The full suite was not repeated.

Plain-text logs omit trailing whitespace and terminal empty lines only. Exact test summary text and raw JSON trace data are preserved.
