# Preserve durable custody on unclassified terminal transport loss

**Status:** Closed
**Severity:** P1
**Systems:** Auth wire, JavaScript client, Durable replay
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0059 §Typed terminal auth error
**Marker:** security, durability

Malformed terminal frames and close-only `4401/auth_error` events selected
`durableDelete` even though they carried no authenticated causal disposition.
A lost expiry frame followed by only the close could therefore delete a valid
durable queue.

**Done when:**

- Unknown, malformed, and close-only terminal events synchronously blank and
  retire the carrier but preserve durable custody.
- Only an exact closed `durableDelete` value selects deletion.
- Raw and managed WebSocket tests cover malformed and close-only events without
  reconnecting or clearing durable custody.

## Resolution

Closed 2026-07-16. Commits `c27cd3a` and `ece6fc4` default malformed and close-only
terminal transport events to carrier-only retirement in `demos/_kit/client.mjs`; raw
and managed WebSocket regressions in `client-errors.mjs` prove durable custody remains.
