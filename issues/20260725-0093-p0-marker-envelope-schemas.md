# 0093 P-0: bring the LLP 0060 D6 marker envelopes under the schema drift gates (LLP 0094 §0F)

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

Out of scope by decision (LLP 0094 §0F item 2): the hosted proof-socket
protocol is frozen (LLP 0040 pinned regression surface) and stays out of
the gate inventory.
