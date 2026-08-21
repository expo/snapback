# Build-generated guide API needs a sound expansion proof

**Status:** Resolved
**Owner:** Snapback security gates
**Due:** 2026-09-19
**Related:** LLP 0284 §3.7

The public `snapback-server::guide` API was declared by a committed wrapper
whose three public values still included Rust expressions from Cargo's
`OUT_DIR`. Restricting those includes to typed expression position did not
prevent API changes: Rust accepts a non-local inherent `impl` inside a block
expression, so generated tokens could preserve the declared value type while
adding public associated items.

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

## Resolution

Resolved 2026-08-21 via the elimination option. `snapback-server/build.rs` now
emits exactly one versioned, deterministic length-prefixed binary Guide
artifact. Committed `src/guide.rs` consumes it only with `include_bytes!`,
strictly parses it once through `LazyLock`, derives the file content types and
section-flat path table, and panics deterministically on malformed or empty
input. A regression test places an inherent `impl` spelling inside an artifact
file payload and observes the exact bytes as data.

The three `.expr.rs` products, `generated/embedded_guide_api.rs`, and
`generated/embedded-guide-api-shape.v1.json` were deleted. The shape manifest
was retired rather than refreshed because no generated Rust wrapper remains to
shape-check: the public declarations and parser are ordinary reviewed source,
and producer output is never Rust tokens. The façade crate's dead, unconsumed
duplicate `embedded_guide.rs` producer was removed as well; it re-exports the
server Guide API. The
`embedded-guide-generated-table` row was removed, leaving the privilege-surface
allowlist empty. The scanner and workspace-graph assertions now accept the
zero-row and zero-generated-source-home states while continuing to fail closed
on any newly planted `OUT_DIR` Rust `include!`.
