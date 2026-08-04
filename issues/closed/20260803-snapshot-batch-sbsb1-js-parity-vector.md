# snapshot-batch: sbsb1 Rust/JS fixed-nonce parity vector not demonstrated

**Status:** Open
**Opened:** 2026-08-03 (read-only inspection during the duplicate-dispatch
stop of the already-landed snapshot-batch ticket)

LLP 0157 §D8 obligates independent Rust/JS fixed-nonce vectors freezing
the exact sbsb1 plaintext bytes. The landed implementation has a Rust
inline fixed-nonce golden but no independent JavaScript consumer or
shared committed golden fixture, so the cross-language byte-parity
obligation is asserted, not demonstrated. Fix: extract the golden into a
committed shared fixture and add a JS consumer test asserting
byte-identity (pattern: rqs-digest-parity.test.mjs /
tests/fixtures/rqs-parity-v1.json). Requires a cargo-capable checkout to
re-verify the Rust side against the shared fixture (see the bootstrap
provenance ticket).

## Resolution (2026-08-04)

Demonstrated, not just asserted: the golden is extracted into the
committed shared fixture
`tests/fixtures/snapshot-batch-sbsb1-parity-v1.json` (root, fixed
nonce, §D8-ordered body, exact plaintext string, wire). The Rust golden
test now consumes the fixture (plaintext byte-equality + wire equality,
plus a drift guard proving the in-module construction still mints the
same vector), and the independent Node consumer
`tests/conformance/snapshot-batch-sbsb1-parity-v1.mjs` (registered in
`scripts/verify-local-proof`) re-derives HKDF, HChaCha20 subkey,
length-framed AAD, and the XChaCha20-Poly1305 envelope from primitives
— byte-identical wire and round-trip plaintext. Verified: cargo lib
snapshot_batch_cursor 6/6; the Node consumer passes standalone.
