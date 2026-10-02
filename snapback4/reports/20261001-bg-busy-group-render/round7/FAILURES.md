# Round 7 failure ledger

The single final-source suite exits 0: `== 0 failure(s) in 1434 s`.
Every final-suite failure: **none — ours 0, baseline 0, environmental 0**.
The known site-48 transient fault-injection flake passes this run. No full-suite
rerun, weakened assertion or increased timeout. All 1,790 source hashes remain
unchanged; the suite reproduces the measured wasm exactly.

Development failures (all ours; corrected, none waived):

- `compiler-first.log.gz`: `whole_value_builtins_and_both_status_guesses_refuse`
  received the ordinary row/object equality type error before raw admission.
  Refine already-failing call/operator type diagnostics to name maintenance
  state and the projection fix.
- `compiler-first.log.gz`: `astra_nested_containers_and_all_nonreturn_reads_refuse`
  showed that this diagnostic refinement masked a helper's specific `total`
  refusal. Apply it only to E_QUARRY_TYPE; preserve E_VIEW_KEY diagnostics.
- `compiler-first.log.gz` and `compiler-second.log.gz`:
  `non_inspecting_selectors_and_projected_computation_preserve_exact_data`
  called unqualified `rows` after naming the source `allowed.q`, which namespaces
  the operation as `allowed.rows`. Use the fixture's `schema.q` convention.
- `language-all.log.gz`: four `audience_bounds` tests failed because the new final
  mutation-result check joined different ordinary return types into Unknown:
  `builder_public_aggregate_refuses_both_edits_and_explains_each_repair`,
  `helper_refusal_finds_a_transitive_job_caller`,
  `owner_key_rewrite_from_each_narrowing_diagnostic_compiles_verbatim`, and
  `query_replacement_points_at_declaration_with_helper_loop_and_job_context`.
  Inspect each effect return before joining; helper returns retain forwarding
  types. The language rerun uses --no-fail-fast to report every cohort.
- One compiler command targeted the root-relative `reports/` path from the
  repository root; shell redirection failed before Cargo ran. Rerun from the
  fenced Snapback 4 workspace. Initial source searches also tried nonexistent
  runner/interpreter/row_views paths; subsequent reads use discovered paths.

No baseline or environmental development failure is claimed.
