# Build-generated guide API needs a sound expansion proof

**Status:** Open
**Owner:** Snapback security gates
**Due:** 2026-09-19
**Related:** LLP 0284 §3.7, `embedded-guide-generated-table`,
`crates/snapback-server/generated/embedded-guide-api-shape.v1.json`

The public `snapback-server::guide` API is declared by the committed
`generated/embedded_guide_api.rs` artifact, but its three public values still
include Rust expressions from Cargo's `OUT_DIR`. Restricting those includes to
typed expression position does not prevent API changes: Rust accepts an
inherent `impl` inside a block expression, treats it as non-local, and exposes
its public associated items outside the block.

For example, a producer can preserve the declared `&[u8]` type while adding a
public method:

```rust
pub static DATA: &[u8] = {
    impl Public { pub fn leaked() -> i32 { 7 } }
    &[]
};
```

The committed shape manifest remains useful change detection for the wrapper:
it pins the artifact bytes and parsed declarations, all three expression
include spellings, the forbidden-identifier catalog, and Cargo's selected
producer source and digest. It does not inspect the bytes an ordinary Cargo
build receives from that producer. Once a changed producer digest is reviewed
and refreshed, a nested item in emitted `.expr.rs` remains invisible.

The restored `generated-api` review row matches the exact committed artifact,
the exact three expression includes, and the SHA-256 of the custom-build source
path derived from `cargo metadata`. This is an expiring human review, not an
expansion proof. The gate still never compiles or executes `build.rs`.

## Done when

Replace the row only with a proof that binds the bytes consumed by ordinary
Cargo builds and rejects every item-bearing construct in the generated
expressions, including nested `impl`, `fn`, `mod`, `trait`, `use`, extern
blocks, and macro definitions or invocations capable of emitting items.
Alternatively, eliminate generated Rust expressions from the public API path
and consume only inert data bytes under committed code.

Do not execute the untrusted custom-build target as audit evidence. A producer
can distinguish an audit environment from ordinary Cargo and emit harmless
evidence only there. An execution-based design is sound only if every ordinary
build uses the identical mandatory sandbox and evidence-binding protocol.
Until a sound non-forgeable design lands, keep the honest review row.
