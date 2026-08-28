# workspace-graph: nested `#[path]` resolves from the file's directory, not the module directory

- **Status:** Resolved
- **Filed:** 2026-08-25
- **Area:** `scripts/check-workspace-graph.mjs` (LLP 0193 proof gate `workspace-graph`)
- **Source:** grok-4.6 round-11 review nit on the `sbs/0825-main-hygiene` lane

## Symptom

`scripts/check-workspace-graph.mjs` (~line 1001) resolves a nested `#[path]`
declaration by joining `dirname(file)` with the inline-module ancestry. For a
crate-root file that matches rustc. For a non-root file it does not: in
`src/local.rs`, rustc loads `src/local/<inline>/...` while the checker looks at
`src/<inline>/...`.

## Impact

Fail-closed today: the existence assertion on the wrong path rejects the
declaration, so this is not a remount bypass of current origin files (paths
containing `../` are already rejected). It is a correctness gap that could
reject a legitimate nested `#[path]` in a non-root file, and it would become a
bypass if the existence assertion were ever relaxed.

## Fix

Resolve nested `#[path]` from the file-module directory (`src/local.rs` ->
`src/local/`), matching rustc, and add a `local.rs` nested-`#[path]`
regression to `tests/workspace_graph_v1.mjs` that fails before the fix.

## Resolution

Resolved nested `#[path]` targets through the declaring file module's directory
for non-root Rust files while preserving crate-root and top-level resolution,
the canonical-file existence assertion, and path-traversal rejection. Added a
`local.rs` regression that proves `src/local.rs` + inline `tests` resolves
`engine.rs` to `src/local/tests/engine.rs` and cannot remount that reviewed
module origin.
