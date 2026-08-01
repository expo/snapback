# A4 sweep: nested-mutation auth denials collapse to SNAPBACK_HANDLER_FAILED through the action boundary

**Opened:** 2026-08-01
**Systems:** Actions, Auth, Diagnostics
**Related:** LLP 0137 (A4 arm), demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f5-action-boundary-collapses-auth-refusals.json, issues/20260801-0137-a3-no-structured-app-refusal-codes.md

When a nested mutation inside an action refuses with
`SNAPBACK_AUTH_PERMISSION_DENIED` (outsider driving the reminder action;
guest driving the notification action), the caller receives only
`SNAPBACK_HANDLER_FAILED`. The denial holds (nothing committed), but the
platform auth code does not survive the boundary, so a client cannot
distinguish "not allowed" from "handler crashed" — the uniform-denial
diagnostic property every direct surface upholds is lost one hop into the
action lane. Distinct from 0137-a3-f3 (app-thrown Errors collapsing):
this leg loses a PLATFORM code.

Fix shape: propagate the platform diagnostic class through the action's
structured error envelope with uniform, non-disclosing bytes. Witness:
an unauthorized action invocation whose nested mutation requireRole-
refuses surfaces SNAPBACK_AUTH_PERMISSION_DENIED byte-uniform with the
direct-mutation denial.

---

**Status:** Resolved (2026-08-01, 0137 between-arms fix lane; local/Ibex leg)

**Root cause.** `handler_envelope_code` (src/runtime.rs) folds every
non-allowlisted claimed code to `SNAPBACK_HANDLER_FAILED`, and
`SNAPBACK_AUTH_PERMISSION_DENIED` cannot simply join the allowlist:
LLP 0053 pins that a handler-forged `{code: ...}` must stay untyped, and
the typed code is client-side deletion-proof.

**Fix (bounded, without weakening LLP 0053).** A host-recorded denial
witness: when a host call inside an ACTION returns the trusted
`SNAPBACK_AUTH_PERMISSION_DENIED` (the nested mutation's requireRole/RLS
denial crossing `action.runMutation`), `dispatch_host_call` records the
error out-of-band (`denial_witness`); after settlement,
`restore_denial_witness` surfaces the RECORDED trusted error — uniform,
non-disclosing bytes — only when the failing handler's raw claimed
envelope code matches. Forged code with no witness stays
`SNAPBACK_HANDLER_FAILED`; a caught denial followed by an unrelated
failure keeps the handler's own failure; a caught denial with recovery
still succeeds (non-terminalizing — the denied mutation committed
nothing). Envelope-decoder allowlists unchanged in both languages. Dated
note in LLP 0053's revision header.

**Witness.** `tests/action_denial_witness_v0.rs`: the action-surfaced
denial is code-, message-, and details-identical to the direct-mutation
denial (proven to fail pre-fix with `SNAPBACK_HANDLER_FAILED`), plus the
three guard-rail cases above.

**Residuals.** (1) Hosted parity: the workerd/DO coordinator decodes
through `envelope.mjs` and has no witness seam yet — follow-up ticket
issues/20260801-hosted-action-denial-witness-parity.md. (2) App-thrown
refusal codes (a3-f3) remain author-gated; design analysis recorded on
that ticket.
