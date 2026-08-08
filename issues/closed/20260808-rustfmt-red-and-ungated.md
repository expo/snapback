# Rust source formatting is red and has no proof/CI gate

**Opened:** 2026-08-08 · **Severity:** P3 (code health / review signal) · **Area:** Rust tooling

## What

`cargo fmt --all -- --check` fails on the current committed Rust tree. The
reported files span production and integration code:

```text
src/admin.rs
src/args_contract.rs
src/cli.rs
src/local.rs
src/manifest.rs
src/server.rs
src/storage.rs
src/storage/auth_mode.rs
src/store_state.rs
tests/data_patch_v1.rs
tests/host_ops_v0.rs
tests/instance_fork_vm_egress_v1.rs
tests/live_coalesce_v0.rs
tests/route_policy_v1.rs
```

The canonical proof and workflow/selection inventories contain no `cargo fmt`
or `rustfmt` gate, so formatting drift can accumulate indefinitely while
Clippy and tests remain green. With the core modules now tens of thousands of
lines and changing hundreds of times per month, mechanical formatting noise
materially reduces review signal and makes later one-shot formatting landings
unnecessarily collision-prone.

## Fix

Run the pinned formatter in one mechanical landing, then add
`cargo fmt --all -- --check` as a fast/affected gate for Rust changes. Keep the
formatter toolchain bound to `rust-toolchain.toml` so local and CI results agree.

## Acceptance

- `cargo fmt --all -- --check` passes on a clean tree.
- Every `*.rs` change selects the formatter gate.
- A selector fixture proves a newly added Rust file is covered.

## Confidence

High. The formatter failure is deterministic under the repository's pinned
Rust 1.97 toolchain, and no canonical gate currently invokes it.

## Resolution (2026-08-08)
Fixed on main (rustfmt lane). cargo fmt --all reformatted 22 files (no semantic edits); added scripts/check-rustfmt.mjs as a fast alwaysGate (SNAPBACK_RUSTFMT_CHECK_FAILED, non-vacuous) wired into verify-local-proof + the selection policy with a selector fixture, so every .rs change now selects the fmt check. Verified: cargo fmt --all -- --check exit 0; gate PASS (234 files); selection fixtures 11/11; ref-check clean.
