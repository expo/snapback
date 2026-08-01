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

---

**RESOLVED 2026-08-01 (fix-wave Lane β).** The declared refusal channel
landed as LLP 0108 §"Declared application refusals" (normative).

Shape, exactly as the ticket's author-gated questions required:
- **Vocabulary declaration surface:** a closed per-function set —
  `refusals: ['STALE_MOVE', ...]` — validated at codegen (`define.mjs`) and
  re-validated at manifest load (`validate_declared_refusals`,
  src/manifest.rs): 1–64 chars, `A-Z0-9_`, ≤64 per function, no duplicates,
  and the reserved `SNAPBACK_` prefix refused
  (`SNAPBACK_FUNCTION_REFUSAL_DECLARATION_INVALID`).
- **Payload validation:** `ctx.refuse(code, details?)` carries JSON-safe
  details through the completion envelope; the platform code is
  `SNAPBACK_APP_REFUSAL`, with `appCode`/`appDetails` in diagnostic details
  — a namespaced field beside the platform code, never replacing it.
- **Admission:** `admit_declared_refusal` (src/runtime.rs) admits a claim
  only when the invoked function declared the code, folding undeclared,
  forged, and bare claims to `SNAPBACK_HANDLER_FAILED` and dropping the app
  payload. The declared set rides `PreparedInvocation` → `IbexHostContext`
  and is empty by default, so any path that does not deliberately carry it
  folds every claim (fail-closed by construction). LLP 0053's pinned rule is
  unchanged: the declaration types the code, not the throw.
- **Retry/quarantine dispositions:** deliberately deferred — declared
  refusals participate in none today; recorded in 0108's deferred list with
  i18n, a platform-wide taxonomy, and result-contract hash participation.

Both envelope decoders treat the code identically (`handler_envelope_code`,
`packages/snapback-harness/envelope.mjs`). Evidence:
`runtime::parse_handler_output_tests::application_refusal_is_admitted_only_when_declared`
(declared admits with payload; undeclared, no-declaration, and bare-claim
all fold and drop the payload) and
`local::tests::declared_application_refusal_round_trips_and_undeclared_folds`
(end to end through the real served mutation path). Full lib suite 1569
passed; pinned suites, codegen, client, guide, artifacts, conformance
(17/17 + ok), ref-check all green.
