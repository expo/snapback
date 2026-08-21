# LLP 0293 authority-chokepoint compiler prototype

This directory records two throwaway compiler probes. The original compiled
Rust lives in `crates/snapback-kernel/src/authority_transition_prototype.rs`.
The focused LLP 0293 §10.3 Axum handoff proof is the standalone crate under
`http-handoff/`.

The prototype is intentionally not an implementation. It uses a tiny synthetic
schema while preserving the proposed ownership, privacy, lifetime, rusqlite
authorizer, transaction, dynamic-membership, and move-only shapes.

Positive evidence commands:

```sh
cargo test -p snapback-kernel authority_transition_prototype
cargo check --all-targets --workspace
node scripts/check-workspace-graph.mjs
```

Intentional negative probes (run separately):

```sh
cargo check -p snapback-kernel --lib \
  --features authority-prototype-negative-borrow
cargo check -p snapback-kernel --lib \
  --features authority-prototype-negative-http-extension
cargo check -p snapback-kernel --lib \
  --features authority-prototype-negative-sibling-visibility
```

The negative features remain disabled in the final positive workspace check.
They preserve the exact failing shapes without weakening the selected design:
calling back through `&mut self` after borrowing its connection, putting a
move-only prepared operation in the current clone-requiring HTTP extension
carrier, and using the rejected sibling-restricted visibility spelling.

Focused HTTP handoff evidence commands:

```sh
cargo check --manifest-path \
  prototypes/authority-chokepoint/http-handoff/Cargo.toml \
  --all-targets --offline
cargo test --manifest-path \
  prototypes/authority-chokepoint/http-handoff/Cargo.toml \
  --offline
```

Focused intentional failures (run separately):

```sh
cargo check --manifest-path \
  prototypes/authority-chokepoint/http-handoff/Cargo.toml \
  --offline --features negative-direct-extension
cargo check --manifest-path \
  prototypes/authority-chokepoint/http-handoff/Cargo.toml \
  --offline --features negative-next-side-channel
cargo check --manifest-path \
  prototypes/authority-chokepoint/http-handoff/Cargo.toml \
  --offline --features negative-request-body-owner
```
