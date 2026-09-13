# Stale handle checkpoint publishes predecessor schema identity

**Status:** open
**Date:** 2026-08-26
**Area:** named checkpoints; schema freshness; proof identity
**Related:** LLP 0303, F182, `issues/shelved/20260826-stale-handle-schema-policy-sibling-survey.md`

## Finding

Family 10 **REACHES EFFECT** at named-checkpoint publication. The storage wrapper passes
`&self.schema` to checkpoint creation at `crates/snapback-kernel/src/storage/checkpoints.rs:37`.
`create_named_checkpoint_inner` derives the receipt's claimed schema identity from that argument,
without re-reading the resource's active manifest in the checkpoint transaction/cut.

## Executed two-handle composition

The ignored witness is
`proof_checkpoint::tests::stale_predecessor_schema_identity_reaches_named_checkpoint_receipt`.
It ran this schedule against one SQLite file:

1. Open handle A and durably publish a manifest whose schema identity is
   `sha256:checkpoint-predecessor`.
2. Open handle B and durably publish the same physical table shape with successor identity
   `sha256:checkpoint-successor`.
3. Confirm A retains the predecessor identity while B holds the successor identity.
4. Through stale A, create a receipt-only named checkpoint.
5. Through B, inspect the durable checkpoint registry receipt and compare its schema identity with
   B's active resource manifest.

Run:

```sh
cargo test -p snapback-kernel stale_predecessor_schema_identity_reaches_named_checkpoint_receipt -- --ignored --nocapture
```

The observation fired at the witness's effect branch, currently
`crates/snapback-kernel/src/proof_checkpoint.rs:3603`:

```text
FAMILY10_REACHES_EFFECT: use returned Ok; receipt schema_hash=sha256:checkpoint-predecessor; publisher handle B observed durable schema_hash=sha256:checkpoint-predecessor while active=sha256:checkpoint-successor
```

No error or diagnostic code fired at checkpoint use. The durable effect is a checkpoint registry
receipt whose proof header claims the predecessor schema identity even though the same resource's
active manifest is the successor.

## Sibling control

The separately executed history-policy schedule in
`stale_predecessor_history_configuration_rereads_durable_successor_policy` was benign: after B
published schema-declared v2 history, stale A's attempt to install a legacy v1 history policy was
refused at use with `SNAPBACK_HISTORY_POLICY_VERSION_CONFLICT`, and an independent connection found
zero legacy-policy rows. `configure_history_policy` obtains this answer from the durable v2 policy
table at `crates/snapback-kernel/src/proof_checkpoint.rs:1135–1147`, so that sibling does not depend
on the stale manifest for the conflicting-policy decision.

## Scope

This ticket records measurement only and makes no fix. It establishes the family verdict through
checkpoint publication; it does not claim protected-record erasure has the same reachable
composition.
