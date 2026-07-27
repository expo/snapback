# 0093 P-0: bring the LLP 0060 D6 marker envelopes under the schema drift gates (LLP 0094 §0F)

**Status:** Resolved (2026-07-27; the in-band reply grammar is
deliberately NOT schematized — it converges under
`issues/20260725-0094-hosted-response-shape-divergences.md` item 5, which
also owns shrinking the wire-schema-gate `KNOWN_DIVERGENT` allowlist.
Left in issues/ for the integrator to move to issues/closed/)
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “0093 P-0: bring the LLP 0060 D6 marker envelopes under the schema drift gates (LLP 0094 §0F)” shows the issue materially affects a supported product or engineering path; delay compounds an active rollout, reliability, or verification risk, while the implementation is localized and has concrete acceptance witnesses, with a direct reproduction or current implementation proof.

**Opened:** 2026-07-25
**Systems:** Wire Protocol, Schema governance, Cloudflare arm, Handler harness
**Spec:** LLP 0094 §0F (inventory); LLP 0051 §D4 (mechanism); LLP 0060 D6
(ownership of semantics)

LLP 0094 §0F's audit found the last hand-mirrored wire families outside
the schema drift gates: the three **private marker envelopes** —

1. the coordinator→handler invocation request,
2. the handler→coordinator response envelope with its required
   `SNAPBACK_AUTH_HANDLER_V1` marker echo, and
3. the handler→host call body,

all live today on both arms
(`packages/snapback-harness/workerd/handler-server.mjs`,
`cloudflare/src/coordinator.js` `serveHostCall`/`invokeHandler`,
`src/workerd_exec.rs` loopback transport) and hand-mirrored JS↔Rust.
LLP 0051 §D4 already assigns them Rust serde authorities, generated
committed schemas under `schemas/`, positive/negative instances, and the
shared drift gate; being private is not a hand-mirror exemption. Their
closed fields, compatibility semantics, and rollout stay owned by LLP
0060.

Also in scope (same mechanism, LLP 0094 §0F item 3): a hosted-side
executable schema-validation gate for the JS-composed kit-route
responses (`kitSubscribe` et al.), which are governed by the committed
schemas but have no hosted drift check today beyond the acceptance
suites.

Out of scope by decision (LLP 0094 §0F item 2, restated in v0.2): the
hosted **proof-socket response framing** is frozen (LLP 0040 pinned
regression surface) and stays out of the gate inventory. The exemption
is scoped to the proof socket only.

**Amended 2026-07-25 (LLP 0094 v0.2, review round 1; corrected v0.3,
round 2):** additionally in scope — schema/gate coverage for the
**kit-socket in-band request grammar**
(`validateLiveSocketFrame`'s `subscribe`/`unsubscribe`/`ping`; LLP 0094
§0A.1 WS-kinds row and §0F item 2); the in-band **reply** grammar is
mixed-dialect as served and enters the gates only after its
convergence to kit dialect
(`issues/20260725-0094-hosted-response-shape-divergences.md` item 5 —
do not schematize the mixed as-built replies); standalone committed
schemas for `QueryOutput` / the action output / the ephemeral HTTP
request-outcome families / `SessionLiveSocketClientMessage` (LLP 0094
§0C gap rows and §0F item 4), and the hosted response-schema assertions
of the divergences ticket.

## Resolution (2026-07-27)

Executed on branch `agent/0094-schemagates-20260726` (LLP 0094 §0F items
1–4; the §0F inventory, §0A.1/§0A.5 rows, §0C gap rows, and LLP 0051 D4's
as-built notes were updated in the same landing).

**1. Marker envelopes (item 1).** Rust serde authorities in
`src/handler_wire.rs` — `HandlerInvokeRequest`, `HandlerInvokeResponse`
(untagged fatal/didNotSettle/settled), `HandlerHostCallRequest` —
committed as `schemas/handler.invoke.input.schema.json`,
`handler.invoke.output.schema.json`, `handler.host-call.input.schema.json`
via `schema_export::artifact_schemas()` under the shared drift gate.
Schematized **as served** (closed emission, tolerant field-pluck
receivers): the LLP 0060 D6 `SNAPBACK_AUTH_HANDLER_V1` versioned marker
set is still unimplemented on every arm; its semantics/rollout stay
0060-owned and land later as ordinary schema changes through this gate.
Positive/negative instances:
`tests/artifact_schemas_v0.rs::handler_marker_envelope_schemas_accept_served_shapes_and_reject_extensions`.
Real-bytes proof on both arms:

- local: `src/workerd_exec.rs` now serializes the invoke request FROM the
  authority type, and a thread-local capture seam
  (`with_handler_wire_capture`) records the workerd-produced response
  envelope and host-call bodies;
  `tests/workerd_twin_v0.rs::handler_boundary_wire_bytes_validate_against_committed_schemas`
  validates them against the committed schemas.
- hosted: `cloudflare/test/harness.mjs` gained a test-only
  `handlerWireCapture` option that interposes byte-transparent capture
  Workers on the gateway↔handler service bindings;
  `cloudflare/test/wire-schema-gate.mjs` validates every captured
  invocation request, response envelope, and host-call body.

**2. Hosted kit-route response gate (item 3).**
`cloudflare/test/wire-schema-gate.mjs`, registered as `wire-schema-gate`
in `cloudflare/test/local-suite-manifest.mjs` (gate class, non-remote CI).
Hard-validates the currently-conformant kit routes against the committed
schemas: `/connection/open` (connection.grant), `/live/{name}/subscribe`
(live.subscribe.output), `/query/{name}` (query.output),
`/outbox/{connection_id}` (live.outbox-drain.output), `/app/ensure`
(app.ensure.output). **Allowlist handshake:** the §0C.6-divergent
emitters — `POST /mutation/{name}`, `POST /live/{name}/unsubscribe`, and
the kit-route error envelopes — are enumerated in the suite's single
`KNOWN_DIVERGENT` map (with a comment pointing at
`issues/20260725-0094-hosted-response-shape-divergences.md`) and are
exercised **report-only**: still-divergent prints `[SKIP]`, and a fixed
emitter prints a `[NOTE] … remove its KNOWN_DIVERGENT entry` hint instead
of failing, so this gate and the divergences branch merge cleanly in
either order and that branch shrinks the allowlist as it converges each
emitter. Emitter fixes were deliberately NOT made here.

**3. Kit-socket in-band request grammar (item 2 amendment).**
`live.kit-socket-request.schema.json` from the new
`KitSocketRequestFrame` authority (`src/live_wire.rs`), mirroring
`validateLiveSocketFrame` exactly (closed frames; closed
`resumeFromToken` wrapper; open `resume` with the 1–1024-byte token
check; `membershipWitness` accepted at any shape; optional members are
optional-by-absence — explicit `null` rejects). Verdict parity is proven
twice: Rust fixtures
(`kit_socket_request_schema_matches_the_served_validator_grammar`) and a
served-arm corpus in `wire-schema-gate.mjs` (one socket per case; the
served reject verdict is the 1008/`SNAPBACK_LIVE_FRAME_INVALID` close).
**Deliberately deferred:** the in-band **reply** grammar is NOT
schematized — it is mixed-dialect as served (LLP 0094 §0A.1) and enters
the gates only at its §0C.6 item-6 convergence to kit dialect
(divergences ticket item 5). Do not schematize the as-built replies.

**4. Gap-row schemas (item 4).** Committed through the same export:
`query.output` (QueryOutput), `action.output` (`FunctionRunResult`, the
served `/action/{name}` envelope body),
`ephemeral.publish.input`/`ephemeral.subscribe.input`/`ephemeral.delete.input`
(the dev wire request DTOs), `ephemeral.publish.output` (PublishOutcome),
`ephemeral.subscribe.output` (EphemeralMessage), `ephemeral.delete.output`
(nullable EphemeralMessage), and `live.socket-client.sessions`
(`SessionLiveSocketClientMessage`, now a public schema-governed type).

**Out of scope, confirmed untouched:** the hosted proof-socket response
framing (LLP 0040 pinned surface) stays exempt from the gate inventory.

Verification (all passing 2026-07-27): `cargo test --test
artifact_schemas_v0` (27/27, includes the new instance fixtures and the
14-schema census); `cargo test --test workerd_twin_v0
handler_boundary_wire_bytes` (real workerd bytes); `node
cloudflare/test/wire-schema-gate.mjs` (12/12 checks, Node 24.18.0);
`node cloudflare/test/acceptance.mjs` (52/52, harness capture option is
inert when unused); `node demos/_kit/tests/live-wire-schema.mjs`;
`./ref-check --verbose`.
