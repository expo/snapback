# A4 sweep: outbound notification effects are unauthorable on packaged 0.1.7 (every action form fails)

**Opened:** 2026-08-01
**Systems:** Actions, Codegen, Runtime
**Related:** LLP 0137 (A4 arm), LLP 0027, LLP 0036, demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f1-outbound-notification-effects-unauthorable.json

No action that performs outbound fetch can be authored on the public
closure, with SNAPBACK_OUTBOUND_ACTIONS=1 set at both boundaries:

1. **Module form** (`js: {source, exportName}` — the only form the actions
   guide teaches): the bundle validator refuses every export form with
   `BUNDLE_UNSUPPORTED_EXPORT`, while the runtime loader requires the named
   export — an export-free file generates cleanly and then the server exits
   before ready with `SNAPBACK_HANDLER_EXPORT_MISSING`. Machine-readable
   repro: `demos/improvement-sweep/arms/a4-snapback-web/evidence/probe-action-forms.json`.
2. **Inline form** (`handler:` — undocumented; found in packaged
   define.mjs): a global `fetch` reference refuses at generation with
   `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER` (the inline allowlist has no
   egress awareness), and `ctx.fetch` passes generation but fails at
   runtime with `SNAPBACK_HANDLER_HOST_CALL_UNKNOWN: unknown handler host
   call host.fetch` — although the inline ctx exposes `fetch`/`fetchStream`
   as functions and the binary contains the `host.fetch` string.

Consequence: A4-10 (external notification effect with retry and
ambiguous-outcome handling) is unimplementable; the arm's scripted local
provider was never reached. The app-level intent/attempt ledger behaved
correctly around the hole (unreachable call → ambiguous, non-terminal,
retryable).

Fix shape: make one form shippable end to end — register host.fetch (and
host.fetchStream) for the inline bridge under the existing outbound gate,
or align the module-form validator/loader on one export contract — plus a
packaged-closure conformance test that executes a fetching action against
a local HTTP fixture, and an actions-guide example that is that test's
source (the guide currently teaches only the broken form; the working
inline form is undocumented).

---

**2026-08-01 (A5 arm — claim NARROWED):** "every action form fails" no
longer holds. The A5 arm proved `host.fetchStream` IS registered and the
whole streamed lane works on packaged 0.1.7 (inline `ctx.streamAttempt`
custody + `ctx.fetchStream` reader + headers/secrets reaching the
upstream + `bounded_response_stream_v1` admission on a sessions target).
Plain inline `ctx.fetch` re-verified broken byte-identically
(`SNAPBACK_HANDLER_HOST_CALL_UNKNOWN: host.fetch`). The narrowed defect —
the streamed lane is the ONLY working egress and undocumented as such —
is tracked in
issues/20260801-0137-a5-streamed-lane-is-the-only-working-egress.md
(finding 0137-a5-f1).

---

**Status:** Resolved (2026-08-01, 0137 between-arms fix lane)

**Root cause.** Not an engine regression: the module form with the actual
contract — the handler file is a closed script that registers each
`exportName` on `globalThis.__snapbackHandlers` and calls the global
`fetch` — worked end to end against a local HTTP fixture on this tree
(reproduced before any fix). What regressed on the packaged closure was
*authorability*: (a) the registration contract was documented nowhere the
packaged consumer can see (the guide's excerpt skipped the registration
line, demos are not shipped), and both diagnostics dead-ended —
`BUNDLE_UNSUPPORTED_EXPORT` said only "unsupported ambient dependency
export" and `SNAPBACK_HANDLER_EXPORT_MISSING` named neither the object nor
the reason, which is the observed catch-22; (b) the inline extractor's
globals allowlist had no egress awareness, so `fetch` refused at generation
even under `SNAPBACK_OUTBOUND_ACTIONS=1` while the module-form scanner
honored the same seam; (c) `ctx.fetch` is the *hosted* host-mediated fetch
op (LLP 0049) and the local Ibex host deliberately does not fall back to
ambient fetch, but the refusal was an anonymous unknown-op.

**Fix (at each layer).**
- `packages/snapback-codegen/inline-handlers.mjs`: `fetch` is an admitted
  global in inline handler/helper analysis when the codegen egress opt-in
  is set, mirroring `scanUnsupportedHandlerSource`; runtime remains the
  security boundary. Dated note in LLP 0108 §Admission rules.
- `packages/snapback-codegen/index.mjs`: `BUNDLE_UNSUPPORTED_EXPORT` now
  states the closed-script registration contract and routes to the guide.
- `packages/snapback-harness/ctx-bootstrap.js` + `src/runtime.rs`
  (`prepare_ibex_module` probe and preflight): `SNAPBACK_HANDLER_EXPORT_MISSING`
  now names `globalThis.__snapbackHandlers` and the export refusal.
- `src/runtime.rs` host-call dispatch: `host.fetch` on the local host
  refuses with a message naming the global-fetch alternative instead of an
  anonymous unknown op (the no-ambient-fallback stance is unchanged).
- `guide/backend/actions-and-fetch.md`: new "The handler file is a closed
  script" section with CI-verified excerpts (module form + inline form).

**Witness.** `demos/all-aboard/tests/egress-probe` gained `notifyDelivery`
(module form: fetch a local provider, commit the response through
`recordDelivery`) and `notifyInline` (inline form, global fetch); the
egress acceptance suite starts a local HTTP fixture and proves both execute
end to end (16/16). Codegen regression tests in
`packages/snapback-codegen/authoring-validation.test.mjs` (inline fetch
admits under the opt-in / refuses without; export refusal message names the
contract) were proven to fail before the fix.

**Residual (deliberate, not a defect).** `ctx.fetch` remains unimplemented
on the local host by design (hosts without the op must not fall back to
ambient fetch); local actions use the global `fetch`. Implementing local
host-mediated fetch with secret placement slots would be a new design
decision under LLP 0049, not a regression repair.

---

**2026-08-01 (post-A5 addendum, same fix lane).** The A5 narrowing and the
coordinator's re-scope superseded the "residual (deliberate)" paragraph
above: with the streamed lane (`action.streamOpen` etc.) already serving
local upstream requests on the detached action host, plain `ctx.fetch`
being the one dead op was an inconsistency, not a design boundary. The
lane's follow-up landing implements `host.fetch` locally on the same
detached lane and egress gate as `ctx.fetchStream` — target-portable
`{status, ok, url, bodyText}` value, CF-identical 1,000,000-byte bound,
`SNAPBACK_HOST_FETCH_RESPONSE_*` refusals in both envelope decoders,
descriptor slots still hosted-only (`SNAPBACK_HOST_FETCH_SLOT_INVALID`
locally). Witness: the egress acceptance's "plain ctx.fetch works on the
local target" check (17/17), previously
`SNAPBACK_HANDLER_HOST_CALL_UNKNOWN` byte-identically on A4 and A5. Dated
notes: LLP 0049 §Action Egress; guide actions-and-fetch §Host-mediated
ctx.fetch. See also
issues/closed/20260801-0137-a5-streamed-lane-is-the-only-working-egress.md.
