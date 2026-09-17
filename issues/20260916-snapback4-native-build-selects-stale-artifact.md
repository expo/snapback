# Snapback 4: Native build selects an old artifact after a crate rename

Status: Open
Priority: P1
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15` (0.2.26)
Review: complete code review requested by Charlie Cheever; lead validation with independent Grok, Muse and Sol reviews.

## Evidence

Reproduced on Linux with a temporary app. Build crate `zzz_old` returning 1, rename it `aaa_new` returning 2, run `check` again. Both checks succeed; generated/native.wasm equals zzz_old.wasm and differs from the newly built aaa_new.wasm.

## Implementation locations

Paths are relative to `snapback4/`: `crates/snapback4/src/native.rs:build` scans all release-directory `.wasm` files and chooses the lexicographically last. Cargo does not remove outputs of renamed crates.

## Acceptance

Select the current app cdylib from Cargo compiler-artifact messages, excluding dependency artifacts. Reject ambiguity/missing output. Validate before replacing the serving artifact. Regression must include a stale lexicographically later wasm.
