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
