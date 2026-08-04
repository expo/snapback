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
