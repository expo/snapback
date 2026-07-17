# Attribution wire seams: finite non-2xx retention and live-subscription metadata

**Status:** Open
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
