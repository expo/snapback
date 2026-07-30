# Attribution wire seams: finite non-2xx retention and live-subscription metadata

**Status:** Resolved (2026-07-30)
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Attribution wire seams: finite non-2xx retention and live-subscription metadata” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the repair crosses several runtime, host, protocol, or policy seams, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** API, Server, Client integration
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §2, LLP 0055 §Audit (attribution copied verbatim, never synthesized), LLP 0012 (dated registration)
**Marker:** app-cli, sub-stage-b, server

Two verified gaps stand between the current wire and LLP 0062's
result-contract parity: the headless client's non-2xx path keeps
`diagnostic`/`status`/`receipt` but drops the server's `attribution`
sibling, and the live-subscription establishment output carries no
attribution block at all. Wrappers must never synthesize attribution
(LLP 0055 §Audit), so both are server/client seams, not CLI patches:
extend the finite client seam to retain server-derived failure
attribution, and extend the live wire so establishment carries a
server-derived attribution block as immutable subscription metadata,
carried across renew/resubscribe, with pre- vs post-resolution failure
behavior distinguished.

**Done when:**

- Non-2xx responses through the lifted client core surface the
  server's attribution block verbatim; error-path parity tests
  (HTTP vs client vs CLI) pass for every principal class.
- Live establishment carries server-derived attribution as immutable
  subscription metadata; it survives renewal resubscribes; rotation
  terminates the old watch, and a fresh restarted subscription under the
  successor carries the new generation's attribution.
- No code path synthesizes or mutates an attribution block client-side
  (test asserts byte-level pass-through of the block's fields).

## Resolution (2026-07-30)

**Status:** Resolved — both wire seams landed with tests; done-when met.

**Finite client seam (non-2xx retention).** The lifted client core
(`packages/snapback-client/index.mjs`) now retains the server's
`attribution` sibling verbatim on the non-2xx path and across
`sanitizeTransportError` re-wrapping — byte-preserving pass-through,
deliberately not routed through the redaction reshape (the block is
server-derived and ids-only; mutating it client-side is contractually
forbidden). The stage-(a) CLI's own HTTP lane
(`packages/snapback-app-cli/index.mjs`) retains it identically. Absent
stays absent: no lane fabricates or null-fills the member.

**Live seam (establishment metadata).** `LiveSubscribeOutput` and
`LiveResumeOutput` (`src/local.rs`) gained optional `attribution` — the
LLP 0094 §0C.2 open-family sanctioned additive evolution. Establishment
derives the block once from the retained establishing authority
(`RetainedLiveAuthority::function_attribution`, one shared derivation on
`ResolvedAppAuthority`); a renewal resume re-answers that establishment
block unchanged (never re-derived from the presenting caller). Committed
schemas `live.subscribe.output.schema.json` /
`live.resume.output.schema.json` regenerated via `snapback-schemagen`
under the LLP 0051 §D4 drift gates.

**Done-when evidence:**

- Error-path parity per principal class (anonymous, dev-asserted,
  session bearer, service principal), HTTP vs client vs CLI:
  `packages/snapback-client/attribution.test.mjs` and
  `packages/snapback-app-cli/attribution.test.mjs` (both registered in
  their package suites and the package-test inventory). Server-side
  denial parity was already pinned by
  `scoped_token_carrier_is_resolved_only_for_granted_current_function_scope`,
  now extended to assert the live establishment block.
- Live establishment + immutability across renewal + rotation:
  `live_attribution_is_immutable_across_renewal_and_regenerated_after_rotation`
  (`src/server.rs`) — subscribe answers the block, resume re-answers it
  byte-identically, credential rotation terminates the exact bound watch
  (durable-delete terminal + topology purge), the old subscription is
  not resumable under the successor, and a fresh restarted subscription
  under the successor generation carries that generation's block.
- Byte-level pass-through / no synthesis: the client test asserts
  byte-identity against the served bytes (including with redaction
  firing on a sibling diagnostic), and absence of the member for every
  non-service-principal class on all lanes.

**Docs:** dated updates to LLP 0055 §Audit, LLP 0062 §Result contract +
Revised, LLP 0094 §0C.2 row + Revised.

**Deliberately out of scope:** the dev-asserted class has no CLI-lane
projection (the stage-(a) CLI selects principals at client
construction; per-call dev assertion is a client option it does not
project), so its CLI lane runs anonymous — parity for the class is
asserted on the HTTP and client lanes; the hosted arm still refuses
`servicePrincipal` wholesale, so it never emits (and must never
synthesize) the block.
