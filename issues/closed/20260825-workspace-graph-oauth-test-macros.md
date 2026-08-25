# workspace-graph rejects OAuth test-generating macros in snapback-engine

**Status:** Resolved
**Opened:** 2026-08-25
**Resolved:** 2026-08-25
**Systems:** Rust core, Auth, Testing, Tooling
**Related:** LLP 0276#crates--the-rust-workspace

## Summary

After the main-hygiene lane recorded the canonically imported `JsonSchema`
derive and the pre-existing `super::runtime_cost::*` and `runtime_cost::*`
compatibility globs, a non-fail-fast per-file scan confirmed that the only
remaining engine-definition violation is this inherited red:

```text
SNAPBACK_WORKSPACE_GRAPH_VIOLATION: snapback-engine may not define item-generating macros: crates/snapback-engine/src/local/tests/engine.rs
```

Commit `711a77bd8a` introduced two `macro_rules!` definitions in
`crates/snapback-engine/src/local/tests/engine.rs`:

- `oauth_consent_begin_case_test` at the current line 30846, generating five
  named tests around `run_oauth_consent_begin_case`.
- `oauth_consent_approval_case_test` at the current line 31275, generating
  eighteen named tests around `run_oauth_consent_approval_case`.

`scripts/check-workspace-graph.mjs` deliberately rejects item-generating macro
definitions throughout `snapback-engine`; unlike reviewed derives, imports,
and macro invocations, this rule has no manifest allowlist. Suppressing the
path in the JS checker would weaken LLP 0276's engine-definition denylist.

## Required Rust change

Remove both test-generating macros and replace their invocations with ordinary
explicit `#[test]` functions that call the existing runner functions with the
same cases and retain the current test names. Do not change the production
OAuth behavior or weaken the workspace-graph checker.

Verify with the affected Rust OAuth tests, then run:

```sh
node scripts/check-workspace-graph.mjs
node --test tests/workspace_graph_v1.mjs
```

This JS-only lane did not run Cargo or edit the Rust file.

## Resolution

Resolved on `origin/main` by `5c39b4df1`
(`fix(cli): resolve cli-delegated-verb-help-resolution`), whose
`cli-carrier-usage` changes replaced both OAuth test-generating macros with
explicit test functions. Verification on main with
`git grep macro_rules crates/snapback-engine` returned no matches.

The no-rebase `sbs/0825-main-hygiene` worktree predates that main commit, so
its workspace-graph hardening follow-up applies only the same two mechanical
macro-to-explicit-test expansions locally. This does not change production
OAuth behavior; it lets the fail-closed checker verify this worktree's real
Rust tree without carrying an exception for the inherited macros.
