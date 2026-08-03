# Hosted action leg: mirror the a4-f5 denial witness in the workerd/DO coordinator

**Opened:** 2026-08-01
**Systems:** Actions, Auth, Diagnostics, Cloudflare
**Related:** issues/closed/20260801-0137-a4-action-boundary-collapses-auth-refusals.md, LLP 0053 (2026-08-01 revision note), src/runtime.rs (`denial_witness`)

The local/Ibex leg now surfaces a nested mutation's trusted
`SNAPBACK_AUTH_PERMISSION_DENIED` through the action boundary via a
host-recorded denial witness (`dispatch_host_call` records the denial the
host itself produced; `restore_denial_witness` surfaces the recorded
trusted bytes only when the failing handler's claimed envelope code
matches). The hosted coordinator (`cloudflare/src/coordinator.js` +
`cloudflare/src/host-ops.js` `action.runMutation`) decodes through
`packages/snapback-harness/envelope.mjs` and still folds the same denial
to `SNAPBACK_HANDLER_FAILED`.

Mirror the witness seam on the JS host: record the trusted denial at the
coordinator's host-op dispatch, restore it after `parseHandlerEnvelope`
under the same claim-match rule, and keep `PASSTHROUGH_CODES` unchanged so
a forged `{code: ...}` stays untyped (LLP 0053). Witness: the hosted
equivalent of `tests/action_denial_witness_v0.rs`'s four cases in the
cloudflare local suite.

## Resolution (2026-08-03)

Seam mirrored point-for-point with the Rust leg:

- **Record** — `cloudflare/src/host-ops.js`: every op result now crosses
  `HostContext.handle` → `recordActionDenialWitness` (the JS
  `dispatch_host_call` recording arm). A host-op failure carrying
  `SNAPBACK_AUTH_PERMISSION_DENIED` in action mode is stored as
  `denialWitness`; sync ops keep their synchronous return shape, and
  non-action modes are untouched. `takeDenialWitness()` mirrors the Rust
  `take` (one restoration per recorded witness).
- **Claim** — `packages/snapback-harness/envelope.mjs`:
  `parseHandlerEnvelope` now also carries the raw pre-fold handler claim as
  `claimedCode` (the claim half of `parse_handler_output_with_claim`).
  Untrusted, never serialized to a wire response (`failure()`, `kitFailure`,
  and the action diagnostic all rebuild from code/message/details).
- **Restore** — `restoreDenialWitness(witness, claimedCode, result)` in
  `envelope.mjs`, wired in `coordinator.js` `invokeHandler` in the same seam
  order as Rust (`admitDeclaredRefusal`, then restore, then platform
  classification): the recorded trusted bytes replace the folded
  `SNAPBACK_HANDLER_FAILED` only when the failing handler's raw claim is
  `SNAPBACK_AUTH_PERMISSION_DENIED` and the host itself recorded the denial;
  a different claim keeps the handler's own failure; success stays success
  (non-terminalizing); the private `failureCarrier` transplants onto the
  restored result (the `private_failure_context` analogue).
  `PASSTHROUGH_CODES` unchanged — a forged claim without a witness still
  folds.
- **Witness suite** — `cloudflare/test/action-denial-witness.mjs`, all four
  `action_denial_witness_v0.rs` cases (typed surface-through with
  byte-uniform host bytes, forged-stays-untyped, caught-then-unrelated-
  failure keeps the handler's failure, caught-then-recovery succeeds),
  driven through the real ctx-bootstrap settle wrapper in a VM over the
  workerd transport error shape against a real action-mode `HostContext`.
  The hosted proof apps still carry no `permissions.requireRole` host op, so
  the trusted denial cannot yet be produced end-to-end through Miniflare;
  the suite injects the `role_denial()` uniform bytes at the exact
  `runMutationForAction` boundary the coordinator's hook occupies, and says
  so in its header. Registered as local-suite gate `action-denial-witness`
  (`EXPECTED_LOCAL_SUITE_CHECKS` 26 → 27; guide/deploying/cloudflare.md
  count updated).

Evidence: `node cloudflare/test/local-suite.mjs` on Node 24.18.0 —
`cloudflare local suite: 27/27 explicit checks passed` (includes the new
gate plus the untouched acceptance suites over the changed
coordinator/host-ops path); `node --test
packages/snapback-harness/envelope.test.mjs` 4/4;
`scripts/check-guide.mjs` ends ok (52 pages, pre-existing freshness
warnings only). The coordinator/host-ops edit rotates the deployed bundle
hash, so `cloudflare/generated/deployment-identity.*.json` were regenerated
per the compatibility gate's instruction.
