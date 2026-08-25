# Public inspect must expose the settlement-ledger incarnation

**Status:** Open
**Date:** 2026-08-25
**Systems:** Local server, Storage, Public inspect, JS client outbox
**Related:** LLP 0043, LLP 0192,
`crates/snapback-kernel/src/storage/schema_seed.rs`,
`packages/snapback-client/index.mjs`

## Gap

`app.reset` deletes `_snapback_client_mutations` and rotates the durable data
version stream, but public `GET /inspect` does not expose that stream or another
opaque store/settlement-ledger incarnation. Its relevant public field names are
currently `storage.version`, `targetProfileId`, `schema.appId`,
`schema.schemaHash`, `schema.inputsHash`, `functions.appId`,
`functions.bundleHash`, `functions.inputsHash`, and
`capabilityManifest.runtimeFacts`. `storage.version` is an ordinary changing
data revision, not a stable incarnation; the remaining identity fields can be
unchanged across reset.

The JS client now consumes an additive `ledgerIncarnation` field, persists it
in the offline-replay capability fact and each v2 `enqueueTarget`, and refuses
custody changes and mutation POST when both persisted and current values exist
but differ. This is intentionally fail-open when either side omits the field,
so the real reset hazard remains open on today's server. The synthetic client
regression proves the plumbing only; it is not evidence that a served reset is
quarantined.

## Required server contract

Expose a root string field on the public route with this exact carrier:

```json
{
  "ledgerIncarnation": "<opaque non-empty identity>"
}
```

The route is `GET /inspect`; `PublicInspect` must own the typed allowlist field.
The value must:

- identify the incarnation of the `_snapback_client_mutations` settlement
  ledger (or a strictly stronger whole-store incarnation);
- remain stable across ordinary process restarts, app writes, settlement-ledger
  inserts/GC, and artifact reloads that preserve the ledger;
- change atomically with every destructive operation that can clear or replace
  the ledger, including `app.reset`;
- be opaque, non-secret, and safe for unauthenticated public inspection.

If a direct capability-manifest payload continues to be served separately,
it may carry the same exact `ledgerIncarnation` field; the JS client already
accepts either root `/inspect` placement or the direct manifest placement.

## Reset acceptance test to add

Add a Rust/server test over one served local store and the exact public route:

1. Load one fixed app artifact and read `GET /inspect`; assert a non-empty
   `ledgerIncarnation` and retain the exact artifact identity fields.
2. Settle a mutation under a fixed `clientMutationId` and prove its row exists
   in `_snapback_client_mutations`.
3. Execute the production `app.reset` path; prove the settlement row is gone.
4. Read `GET /inspect` again at the same origin with the same
   `targetProfileId`, app id, schema hash, bundle hash, and inputs hash.
5. Assert `ledgerIncarnation` changed while those artifact/target axes stayed
   equal.

Then extend the JS/server acceptance rung: queue before the reset, perform the
reset, reconnect at that same origin/artifact, and assert the old record stays
pending byte-identical, emits `SNAPBACK_OUTBOX_REPLAY_TARGET_MISMATCH`, and
causes **zero mutation POSTs**. Do not close this ticket or claim the reset
double-apply case fixed until that real served-field regression passes.
