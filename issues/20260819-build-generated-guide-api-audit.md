# Build-generated guide API needs a sound expansion proof

**Status:** Open
**Owner:** Snapback security gates
**Due:** 2026-09-19
**Related:** LLP 0284 §3.7, `embedded-guide-generated-table`

The public `snapback-server::guide` module includes `embedded_guide.rs` from
Cargo's `OUT_DIR`. The prior replacement for this review debt compiled and
executed the producer with ambient host authority and a gate-distinctive
environment, so the producer could forge the evidence that purported to audit
it. That executable proof has been removed.

The restored `generated-api` review row is deliberately narrower than the old
row: it matches the exact source module, logical output, and direct `include!`
spelling, and it pins the SHA-256 of the custom-build source path derived from
`cargo metadata`. Changing `Cargo.toml` to select another producer, changing
the producer source, or changing the include spelling makes the row invalid or
stale and fails the gate. This is change detection for an expiring human
review, not inspection of generated output and not an expansion proof.

## Done when

Replace the row only with a proof that does **not** execute the untrusted
custom-build target as audit evidence. A producer can probe a denied write,
network access, environment value, target detail, or any other difference
between an audit sandbox and an ordinary Cargo build, then emit harmless output
only under audit. A special "neutral" or Cargo-like environment therefore
repeats the forgery this ticket exists to prevent.

An execution-based design would be sound only if every ordinary Cargo build on
every supported host ran through the identical sandbox. That would make a
mandatory Cargo wrapper and host-specific confinement part of the production
build contract, with local-build latency and portability costs. This ticket
chooses the non-executable direction instead.

Ground the replacement proof in committed bytes: for example, check in the
generated Rust, or commit a drift-checked API-shape manifest and verify it
against checked-in generated output. Scan that committed artifact in the exact
including module's lexical context, drift-check the artifact, manifest, include
expression, and Cargo-selected producer source, and require ordinary builds to
consume or verify the same committed artifact. Compiling or executing the
producer under the gate must not contribute evidence. Until such a design
lands, keep the honest review row.
