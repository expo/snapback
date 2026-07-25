# Converge served response bytes to the committed schemas (LLP 0094 §0C.6 ledger)

**Opened:** 2026-07-25 (LLP 0094 review round 1, Codex Major 1)
**Systems:** Cloudflare arm, Wire Protocol, Schema governance

LLP 0094 §0C.6 ledgers the audited places where served bytes do not
satisfy the committed schemas (verified at `137dee8c`):

1. Hosted `/mutation/{name}` (`kitMutation`, `cloudflare/src/coordinator.js`)
   omits the required `receipt` member of `mutation.output.schema.json`.
2. Hosted `/live/{name}/unsubscribe` (`kitUnsubscribe`) returns
   `{removed: true}` instead of the required `subscription_id` +
   `disposed`.
3. Hosted error envelopes (`kitError`/`kitFailure`) under-fill the inner
   `Diagnostic`: no `severity`, no `subsystem`, `details` optional —
   all required by `error.response.schema.json`.
4. Local `FunctionResponse<T>` (`src/server.rs`) flattens an optional
   `attribution` member that the closed `mutation.output.schema.json`
   does not admit — fix is schema-side (generate from the served
   envelope or admit `attribution` explicitly).

Extended 2026-07-25 (review round 2, Codex Major 3 / Fable Major 1 —
§0C.6 items 6–9):

5. Hosted in-band durable subscribe replies are mixed-dialect
   (proof-dialect `type: 'snapshot'` on non-resume, `type: 'error'` on
   errors, kit `kind: 'current_as_of'`/`'pong'` on resume/ping) —
   converge to kit dialect; the reply grammar is
   conformance-unclaimable until then (LLP 0094 §0A.1 decision).
6. `requestDiagnostic` (via `parseJsonObjectRequest`,
   `coordinator.js`) emits `{ok, code, message, diagnostic}` — top-level
   members outside the closed `ErrorResponse`, inner diagnostic
   under-filled.
7. Gateway-lane refusals (`gateway.js`): method refusals under-fill
   `Diagnostic`; the non-upgrade 426 and the 404s emit bare
   `{error: ...}` shapes with no diagnostic envelope.
8. `platformFailureResponse` (kit-route branch,
   `cloudflare/src/platform-errors.js`) under-fills `Diagnostic`.

The ledger enumerates emitter functions; this ticket owns an executable
audit (a suite check that fails when a new non-conformant error emitter
appears on a kit route) in addition to the per-item convergence.

Decided direction (LLP 0094 §0C.6): converge emitters to the schemas;
add hosted response-schema assertions to the Cloudflare acceptance suite
per ledger item; a hosted executable schema-validation gate rides
`issues/20260725-0093-p0-marker-envelope-schemas.md` (LLP 0094 §0F items
1/3). Also close the §0C gap rows: standalone committed schemas for
`QueryOutput`, the action output, and the ephemeral HTTP
request/outcome families.

Until this lands, clients targeting the hosted arm MUST tolerate the
enumerated shapes (and only those); conformance claims on affected
tuples carry the §0C.6 ledger by reference.
