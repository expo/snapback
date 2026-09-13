# Snapback 4: FFI entry points have no panic boundary

Status: Closed
Severity: minor
Priority: P2
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

`grep -n catch_unwind crates/snapback4-device/src/*.rs` returns nothing:
every `#[unsafe(no_mangle)] pub extern "C" fn` in
[ffi.rs](../../snapback4/crates/snapback4-device/src/ffi.rs) (e.g. `sb4_open`
and neighbors) lets a Rust panic unwind across the FFI boundary, which is
undefined behavior for the host (Swift/Kotlin/JS). Current call paths are
panic-free by inspection (`native.rs:252`'s `expect` is guarded by the
check at :248), so this is latent, not live — but any future `expect`,
index, or arithmetic panic inside a device call becomes host UB instead
of a clean error. No open ticket covers the FFI panic boundary (searched
issues/ for catch_unwind/FFI — only the unrelated
`20260913-snapback4-native-ffi-withdraw-and-apply-first`).

## Implementation locations

- [crates/snapback4-device/src/ffi.rs](../../snapback4/crates/snapback4-device/src/ffi.rs) (all `extern "C"` entry points)

## Suggestion

Wrap each entry point body in `std::panic::catch_unwind` and map a caught
panic to the existing null/error return (`sb4_open_reason` style), so no
panic can cross into the host. Consider `panic = "abort"`-incompatible
audit notes if the crate ever changes panic strategy.

## Resolution — 2026-09-13

Every exported C entry point now contains a `catch_unwind` boundary. JSON
entry points translate a caught unwind to the ordinary `E_STORE` denial;
`sb4_open` records that denial for `sb4_open_reason`; void cleanup entry points
contain and discard an unwind. The header states the full build contract:
development unwind builds translate the panic, while the production
`panic=abort` profile terminates before any unwind can cross C. A focused unit
test injects a panic and observes `E_STORE`; all 17 device tests pass.
Implementation: `b19a89631`.
