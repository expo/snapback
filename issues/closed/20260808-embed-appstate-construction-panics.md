# Supported embedding construction can panic on caller-controlled state

**Opened:** 2026-08-08 · **Severity:** P2 (embedding availability / API contract) · **Area:** Rust embedding API

## What

`snapback::embed` is the documented supported Rust façade and re-exports
`AppState` for its low-level test/tooling path. `AppState::new` is public and
returns `Self`, but construction contains caller-triggerable panics:

```rust
let mut instance = snapback
    .try_lock()
    .expect("trusted app-state builder owns the detached instance");

assert!(
    database.claim_app_state_graph(),
    "one SharedSnapback may be wrapped by exactly one AppState graph ...",
);
```

An embedding caller can hold the supplied mutex or try to wrap the same
`SharedSnapback` graph twice; both are ordinary invalid API states, not broken
internal invariants. They currently unwind (or abort under an aborting panic
profile) instead of returning a typed Snapback diagnostic. Entropy acquisition
also uses `expect`, though that failure is environmental rather than
caller-controlled.

A deliberately broad Clippy audit (`unwrap_used`, `expect_used`, `panic`,
`todo`, `unimplemented`) reports 445 warnings in the library. Most are
test/invariant-shaped and should not be converted mechanically. The missing
piece is a written panic boundary for the supported façade so external input or
legal caller sequencing cannot terminate the process.

## Fix

Add a fallible constructor (`try_new`, and fallible composed variants where
needed) that returns `SnapbackResult` with stable diagnostics for busy/already-
owned graphs and entropy failure. Decide the compatibility path for the current
infallible method under LLP 0141's `0.x` source-compatibility policy: deprecate
and document it, or make the breaking return-type change in a minor release.

Audit only externally reachable `snapback::embed` operations for
caller/environment-triggerable panics, while retaining justified internal
invariant assertions. Document the resulting contract.

## Acceptance

- Holding the shared lock and wrapping an already-owned graph return typed
  errors through the supported fallible API; regression tests prove no unwind.
- `production(...)` / `ProductionBuilder::serve` and the supported low-level
  path state which failures may panic, if any.
- A targeted lint/test prevents new caller-triggerable panic sites from
  entering `src/embed.rs` and its exported constructors.

## Confidence

High on the reachable panic mechanics. Medium on urgency because
`AppState::from_snapback` consumes a fresh owned instance and avoids the two
caller-state cases; the risk is concentrated in the explicitly exported
low-level path.

## Resolution (2026-08-08)
Fixed on main (Lane C). Verified: cargo build; targeted suites pass (throttle 4/4, instance-lock 11/11, fork 3/3, value_expr 10/10, config 23/23, embed 7/7, workerd 10/10, data-tier corpus 2/2 + 37-case parity); ref-check clean.
