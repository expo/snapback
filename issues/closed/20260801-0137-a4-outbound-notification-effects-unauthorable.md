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
