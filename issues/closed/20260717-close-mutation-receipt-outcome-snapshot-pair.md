# Close mutation receipt outcome and snapshot-version pairs

**Status:** Closed
**Severity:** P2
**Systems:** Receipts, JSON Schema, Contract integration
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0034; LLP 0037
**Marker:** receipt, schema, durable-version, impossible-state

The mutation receipt Rust shape correctly documented that
`snapshotVersion: null` was reserved for rejected mutations whose durable
cursor could not be read, but its generated JSON Schema admitted the
impossible pair `outcome: "confirmed", snapshotVersion: null`. Every embedded
copy of the receipt schema therefore admitted a successful commit without the
durable version that identifies it.

**Done when:**

- The Rust schema authority expresses the outcome-dependent constraint.
- The standalone and embedded generated schemas reject confirmed/null while
  continuing to accept rejected/null.
- A consumer-side regression exercises both sides of the constraint.
- LLP 0034 records the rejected-null meaning.

## Resolution

The mutation variant's schema authority now adds an outcome-dependent
constraint: a confirmed receipt's `snapshotVersion` must be an integer. The
existing required nullable field remains available to rejected receipts, so a
cursor-read failure stays honest without inventing zero. Schema regeneration
propagates the same closure to mutation outputs and error responses, and the
artifact consumer test proves rejected/null acceptance and confirmed/null
rejection.

Focused proof on 2026-07-17:

- `cargo test --test artifact_schemas_v0 -- --nocapture` — 22 passed, including
  the standalone receipt and both embedded receipt schemas.
