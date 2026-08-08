# P1: projection rebuild digest survives a failed activation → retry skips the rebuild and serves a stale materialization

**Opened:** 2026-08-08 · **Severity:** P1 (correctness; the LLP 0080 §5 "digest matches ⇒ materialization matches plan" oracle can be silently false) · **Area:** storage / projections

## What

`src/local.rs:5004-5021` (activation rebuild loop; same at :5211); mechanism in
`src/storage.rs:8870-8882` and :9186.

`rebuild_projection_if_stale` returns early when the stored
`projection_plan_digest:{id}` meta row matches the plan digest, and
`rebuild_projection` commits that digest **inside the rebuild's own
transaction**. The activation loop rebuilds all projections *before*
`self.functions = manifest` / `set_projections` installs the generation.

## Failure scenario

1. Activation rebuilds projection P1′ — its digest is committed durably.
2. A later step of the **same** activation fails (a second projection refusal,
   `install_sequence_declarations` at local.rs:5025, an order-field-bounds
   error).
3. Old manifest and old projection set stay active. Interim mutations maintain
   the output table under the old plan (or not at all, for a newly-added
   projection), while the stored digest already claims the new plan's
   materialization.
4. On retry of the same manifest, the digest matches → the rebuild is
   **skipped** → the projection output table is served stale relative to the
   plan it now claims to satisfy.

Because ephemeral-room `permissionBacking` can read maintained-projection output
tables, a stale materialization can extend to wrong authorization decisions.

## Fix

Stage per-plan digests and commit them only when the whole generation installs
(an explicit "activation transaction" that owns rebuild digests, sequence
installs, and the manifest swap as one commit/abort unit), or clear the digests
of already-rebuilt plans on the activation failure path.

## Confidence

High on mechanics (no compensating digest cleanup on any failure path;
mutation-time maintenance never touches the digest); medium on frequency. The
nearby `@ref` covers rebuild *refusal*, not digest survival across an aborted
activation. Related: this is the seam the P0 rollback bug also lives on — an
explicit activation-transaction type would harden both.
