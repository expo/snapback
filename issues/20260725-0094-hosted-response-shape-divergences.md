# Converge served response bytes to the committed schemas (LLP 0094 §0C.6 ledger)

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Converge served response bytes to the committed schemas (LLP 0094 §0C.6 ledger)” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while the fix requires a few coordinated implementation and test surfaces, with a direct reproduction or current implementation proof.

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

## Resolution (2026-07-27)

Executed on branch `agent/0094-shapes-20260726`. All actionable ledger
items converged to the committed schemas; LLP 0094 §0C.6 carries the
dated per-item convergence record (the ledger stays as history).

**What converged, per item:**

1. `kitMutation` emits the required `receipt` member of
   `mutation.output.schema.json`, mirroring the local
   `record_mutation_commit` facts with honest hosted values: minted
   `mut_<uuid>` id (this arm has no client-mutation replay ledger, so
   `clientMutationId` is deliberately never echoed), declared-write-set
   `affectedTables` (`null` = explicitly unknown), commit
   `snapshotVersion`, `transport: "http"`, verbatim `correlation` echo,
   `rollbackReason: null`. Deliberately NOT done: attaching the
   *optional* `ErrorResponse.receipt` on hosted rejected mutations —
   this arm has no retention ring and its failure lane cannot yet
   distinguish gate refusals (which locally carry no receipt) from
   post-admission rejections (which do); fabricating that boundary
   would be dishonest. Recorded in §0C.6 item 1.
2. `kitUnsubscribe` answers `{subscription_id, disposed}` per
   `live.unsubscribe.output.schema.json`; unknown/foreign ids answer
   `disposed: false`.
3. `kitError`/`kitFailure` fill the full committed `Diagnostic` via the
   new shared `cloudflare/src/wire-diagnostic.js` (code-family →
   subsystem classification mirroring the local vocabulary; `details`
   always present, `{}` when empty).
4. Schema-side: `MutationResponse` (`src/server.rs`) admits
   `attribution: Option<FunctionAttribution>` explicitly (the mutation
   route no longer wraps in the `FunctionResponse` flatten);
   `schemas/mutation.output.schema.json` regenerated via
   `cargo run --bin snapback-schemagen` (never hand-edited), and the
   digest-pinned todo-v2 remote-service publication regenerated via
   `node packages/snapback-codegen/index.mjs demos/todo-v2/snapback
   --target-profile remote-service-sqlite-ibex`. Served bytes are
   unchanged; the schema now describes them.
5. (Ledger item 6) In-band kit-socket replies are kit dialect
   throughout: `kind: "snapshot"` (snake_case members, no proof
   `connectionKey`), `kind: "error"` with the full `Diagnostic`;
   `pong`/`current_as_of` already were. Proof sockets byte-unchanged.
   No first-party client sends in-band durable frames; no in-repo
   consumer decoded the old proof-dialect replies on kit sockets
   (verified: kit client, Swift client, all suites — the only in-band
   kit-socket sender was a security-hardening `unsubscribe`, which has
   no reply frame).
6. (Ledger item 7) Kit-route parse refusals ride the closed
   `ErrorResponse` (`parseJsonObjectRequest` `errorDialect: 'kit'`);
   proof/system lanes keep their pinned `{ok, code, message,
   diagnostic}` shape (byte-pinned by acceptance.protocol-hardening).
7. (Ledger item 8) Gateway: method refusals fill the Diagnostic
   (`path`/`expectedMethod` details); non-upgrade 426 mints
   `SNAPBACK_UPGRADE_REQUIRED`; `/_snapback/*` and fallthrough 404s
   mint `SNAPBACK_ROUTE_UNKNOWN` diagnostics. `/__exact/*` asset-lane
   404s deliberately keep their Exact-protocol shapes.
8. (Ledger item 9) `platformFailureResponse` kit branch fills the
   Diagnostic and never drops `details`.
   Additionally, per the §0C.6 governance rule, the other kit-lane
   emitters converged: `appBundle` failures, the action kind-mismatch
   400, the coded-refusal catch, and the stale-deployment 409 (kit
   routes only).

**Executable audit:** `cloudflare/test/acceptance.wire-shapes.mjs`
(registered as the `acceptance-wire-shapes` gate in
`local-suite-manifest.mjs`): schema-validates every ledger lane's served
bytes against the committed schemas with ajv (closed `ErrorResponse`
catches any extra top-level member) and pins the fingerprint set of
remaining non-`wireDiagnostic` literal-status 4xx/5xx emitters in
coordinator.js/gateway.js/platform-errors.js, so a NEW non-conformant
error emitter on a kit route fails the suite.

**Test evidence (all on `volta run --node 24.18.0`):**
`acceptance.wire-shapes` 32/32; `acceptance` 52/52;
`acceptance.protocol-hardening` 96 exact body-rejection cases + 40
kind cases (pins updated to the new kit-lane shape);
`acceptance.rqs` 39/39; `acceptance.all-aboard` 19/19;
`acceptance.built-client.all-aboard` 16/16; `acceptance.egress` 29/29;
`acceptance.secrets` 16/16; `acceptance.cron` 12/12; plus
security-hardening, storage-layout, live-and-diagnostics-hardening,
reset-atomic, action-timeout, cron-recovery — all passing. Rust:
`cargo test` (full) with the regenerated schema —
`artifact_schemas_v0` 23 passed (attribution admission asserted),
`wire_fixtures_v1`, `offline_replay_v0`, `local_v0`, `admin_v0` green.

**Out of scope / remaining:**
- The §0C gap-row standalone schemas (QueryOutput, action output,
  ephemeral HTTP families) and the in-band reply-grammar schemas ride
  `issues/20260725-0093-p0-marker-envelope-schemas.md` (handled by a
  parallel agent).
- The **shared Cloudflare deployment** still serves pre-convergence
  bytes until its next redeploy (deliberately not deployed from this
  branch); the §0C.6 caveat notes this.
- Item 5 of the ledger (`kitQuery` shape) required no change (no
  committed schema; not a violation).

Left open for the integrator to close.
