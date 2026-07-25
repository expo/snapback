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
