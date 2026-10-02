# Round 9 failures and dispositions

## Development (ours)

- `compiler-first.log`: `job_viewer_reads_keep_client_maintenance_field_restrictions`
  used unsupported `effect push(payload <=4096)` fixture syntax; corrected to
  the existing `effect push` form.
- `compiler-first.log`: `job_viewer_captured_rows_keep_scope_wide_types_after_resets`
  required the scope-wide diagnostic even when the binder already rejects an
  immediately visible maintained row. Require that wording for the reset case.
- `interaction-second.log`: the captured-row fixture called `max(null, null)`
  after a statically null reset; ordinary typing rejects before maintenance
  admission. Use the existing share/equality consumers for resets and keep max
  for the unreset row; both cases still require E_VIEW_KEY.
- `interaction-second.log`: the execution fixture selected the oldest effect
  (`last`) from a newest-first API. Check the newly committed effect (`first`).
  Client count and job execution were correct.

The corrected interaction tests pass in `interaction-final.log`. Subsequent
coverage also refuses UI-only status selections in embedded queries, preserving
whole rows and ordinary field controls. No product failure is waived here.
Two evidence-command mistakes (a wrong working-directory prefix and assuming
that the merge base was a complete journal prefix) changed no source semantics;
the corrected journal audit verifies both tails verbatim.

The first adjacent-test command used nonexistent target `helpers`; Cargo refused
the invocation (exit 101) before running tests. Corrected to `helper_placement`
in `admission-adjacent-final.log`. This is ours, a command error.

## Auxiliary audit (baseline)

`git diff --check HEAD` reports 93 whitespace findings in 23 historical main
evidence files (CT/JV/FDL logs and patches). Every affected file is byte-identical
to origin/main; these are not merge edits. `whitespace-all.log` retains every
finding and `whitespace-attribution.json` proves the attribution. Historical
evidence is preserved. No owned source whitespace finding.

## Final qualification

The merged-source `scripts/test.sh` ran once, exit 0. Exact summary:

```text
== 0 failure(s) in 1427 s
```

Every full-suite failure: none. Ours 0, baseline 0, environmental 0.
All 285 Rust binaries / 998 scheduled executions and doctests pass; clients
5,784 passed, 0 failed, 10 skipped; serial models 79/79. All affected final checks,
the official wasm budget and both once-only busy-group runs pass. Ignored tests
and platform skips retain their declared status; they are not counted as passes.
All 1,814 captured source inputs stay unchanged and wasm reproduces exactly.
`final-verification.json` binds the complete log and artifact hashes.

Log files are retained as lossless `.log.gz` archives (including
`whitespace-all.log.gz`); `archive-verification.json` binds their original bytes.
