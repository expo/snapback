# Bind ephemeral acceptance proof to granted connection identity

**Status:** Closed
**Severity:** P2
**Systems:** Ephemeral state, Connection grants, Todo acceptance
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0013; LLP 0025; LLP 0031; LLP 0032
**Marker:** ephemeral, connection-grant, disconnect, acceptance, mint-only

The Todo headless acceptance proof addressed the Snapback kit with readable
labels, then assumed the connection-owned room entry and hand-authored raw
WebSocket frames used those same strings as authoritative identities. That
assumption becomes false after a reset or retirement activates fail-closed
mint-only containment: the kit keeps each label locally, while the server grants
an opaque `conn_*` wire identity and keys/binds protocol effects to that
identity.

The publish and deterministic drain both succeeded, but the stale assertion
reported a missing cursor even though the overlay held the confirmed entry.

**Done when:**

- The proof identifies the entry by server-confirmed grant identity rather than
  a caller-local label.
- Disconnect still uses the readable kit label, proving the client maps it to
  the exact granted connection.
- Raw WebSocket frames assert the exact grant id bound to their socket rather
  than smuggling the caller-local label across the protocol boundary.
- The entry is visible before disconnect and absent after the deterministic
  disconnect/drain boundary under mint-only containment.
- The complete Todo headless acceptance suite passes.

## Resolution

The proof now retains the confirmed ephemeral publish result and uses its `key`
for both presence assertions. The disconnect call intentionally continues to
use `cursor_gone`. The raw WebSocket section resolves `ws_cursor` through the
kit and places the resulting grant id in its subscribe and publish frames. The
acceptance scenario therefore covers both halves of the public contract:
readable labels remain a client convenience, while room ownership, sender
binding, and cleanup use the server-granted wire identity.

Focused proof on 2026-07-17:

- `node demos/todo/tests/acceptance/headless.mjs` — 24/24 passed, including
  mint-only connection-owned publish/drain/disconnect and raw WebSocket
  subscribe/publish sender binding.
