# A3 sweep: application refusals collapse to SNAPBACK_HANDLER_FAILED; clients must parse message prose

**Opened:** 2026-08-01
**Systems:** Runtime, Client protocol
**Related:** LLP 0137 (A3 arm), LLP 0108, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f3-no-structured-app-refusal-codes.json

Every handler-raised semantic refusal surfaces as the one generic code
`SNAPBACK_HANDLER_FAILED`. The A3 arm's documented conflict semantics
("stale move: revision 2, expected 1"), a consumed invite, and a validation
error are indistinguishable at the code level; the reconciliation branch in
the acceptance client had to key on message text. Host refusals are
exemplary coded vocabulary; app semantics get none. (Convex: developer-
defined ConvexError with structured data.)

Fix shape: a declared refusal channel — handlers throw a typed refusal from
a declared closed set with a JSON-safe details payload validated like a
result contract, carried as `diagnostic.appCode` beside the existing generic
code. Host denials stay terminal and unmaskable. Witness: declared
`STALE_MOVE` observable as `appCode`; undeclared throws stay generic.

---

**Design analysis (2026-08-01, 0137 between-arms fix lane; author-gated).**

The sibling a4-f5 leg (a PLATFORM code — a nested mutation's trusted
`SNAPBACK_AUTH_PERMISSION_DENIED` — collapsing through the action
boundary) is now fixed with a witness-gated restore: the host records the
denial it produced during the invocation (`denial_witness`,
src/runtime.rs) and surfaces the recorded trusted bytes only when the
failing handler's claimed envelope code matches. That mechanism is
deliberately NOT applicable to this ticket: an app-thrown refusal has no
host-produced witness to corroborate, so under LLP 0053's pinned rule ("a
thrown object, returned envelope, adapter string, or forged `{code: ...}`
is untyped") every app-minted code must keep folding to
`SNAPBACK_HANDLER_FAILED` until a declared channel exists.

What this ticket therefore still needs is a genuine design decision, not a
regression repair: a DECLARED refusal vocabulary (closed set in the
function manifest, payload validated like a result contract) carried in a
namespaced field (`diagnostic.appCode`) that can never collide with or
mask the `SNAPBACK_*` platform namespace, plus the client-protocol
(LLP 0093 fixtures) and envelope-decoder (both `handler_envelope_code`
legs) treatment. Owner decision required on: vocabulary declaration
surface, payload validation, and whether declared refusals participate in
retry/quarantine client dispositions. Left open, author-gated.
