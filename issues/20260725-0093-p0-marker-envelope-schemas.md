# 0093 P-0: bring the LLP 0060 D6 marker envelopes under the schema drift gates (LLP 0094 §0F)

**Status:** Open
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
