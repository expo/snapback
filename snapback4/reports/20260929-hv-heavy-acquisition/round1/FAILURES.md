# HV round 1 failure ledger

## Qualification failures

- **Ours (retained round-0 debt): wasm cap.** Every retained size rung remains
  above the restored 593,719 B cap. Final build is 602,389 B, over by 8,670 B.
  build-wasm.sh exits 1 and its check stays enabled. The size ladder records
  every measured rung; no budget increase or dropped contract hides the red.
  The required full suite ran once, exited 1, and reported exactly
  `== 1 failure(s) in 1248 s`, naming only `wasm build`. All correctness tests
  passed. Baseline test failures: 0; environmental test failures: 0. The
  inherited nominal 60-second suite budget is also missed; it is not hidden
  by the suite's stage-failure summary.

## Setup failures and excluded diagnostics

- **Environmental setup:** this worktree's llp-orient symlink target and the
  usual fleet file were absent. Read the installed skill from the populated
  enginefix worktree; the existing eb1000 lane and private fixture remained local.
- **Ours, command setup:** the first directory-vector build redirection used
  repository-root paths with a snapback4-relative command, so no build ran.
  One temporary profiling-dependency edit likewise used the wrong working
  directory and failed to find Cargo files. Corrected the paths and retained
  the successful subsequent build logs. No source was lost.
- **Ours, diagnostic compilation:** the first profiling build imported
  wasm_bindgen directly from core without a direct dependency (eight compiler
  diagnostics); the retry after the failed path edit repeated that failure.
  Added the dependency only in the temporary diagnostic patch. Both Cargo files
  and all profiling hooks were restored before production builds and tests.
- **Ours, attribution setup:** replaying round 0's captured apply/sync_state
  commands omits delivery-viewer initialization, so its delivery phase is zero.
  These ten replay observations are retained as excluded attribution controls.
  Final phase results use complete SDK acquisitions, including delivery setup.
- **Ours, symbol tooling:** the first Binaryen symbol attempt warned about
  unsupported DWARF. Removed DWARF custom sections before producing the named
  census, while preserving names. Adding symbols changes code layout slightly;
  the report discloses that difference and supplies a separate complete census
  of the exact production artifact. No symbol artifact is the browser candidate.
- Full -Os, full -Oz and merge-similar-functions made gzip larger. These are
  rejected size experiments, not product-test failures. Narrow folding won.

The main merge's LLP-header and journal conflicts were resolved by preserving
both sides. The await inventory was regenerated with awaitBoundary(). Neither
is counted as a test pass or a product failure.

- **Ours, evidence packaging:** the final staged whitespace check flagged the
  mandatory single-space markers on blank context lines in the diagnostic diff.
  Stored that diff as a lossless gzip archive and verified that its extracted
  patch applies cleanly; the staged whitespace check then passed.
