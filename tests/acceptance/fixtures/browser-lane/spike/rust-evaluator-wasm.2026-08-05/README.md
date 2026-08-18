# Rust evaluator WASM size witness (2026-08-05)

This bounded proof-of-concept path-imports the exact pure Rust evaluators from
`crates/snapback/src/value_expr.rs` and `crates/snapback/src/result_transform.rs`. Its local shims reproduce
only the manifest types and diagnostic methods those files require. It does
not include Hermes, Ibex, SQLite, a `FunctionRuntime::WasmModule` variant, a
ctx host-call bridge, a browser loader, or a production ABI.

Build the size-optimized artifact from the repository root:

```sh
cargo +stable build --offline --manifest-path tests/acceptance/fixtures/browser-lane/spike/rust-evaluator-wasm.2026-08-05/Cargo.toml --target wasm32-unknown-unknown --release
```

The dated assessment records the exact artifact digest and raw/compressed
sizes. Binaryen `wasm-opt` is deliberately not bootstrapped by this fixture;
if it is absent, the assessment records that optimized-Rust/LTO is the last
measured stage rather than relabeling it as a `wasm-opt` result.
