# Align the agent `/auth/session` DTO across server, schema, and client

**Status:** Open
**Severity:** P1
**Systems:** Agent auth, Bootstrap handshake, JavaScript client, Generated schema
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0058 §Exact response DTO
**Marker:** bug, protocol

A real scoped-token `/auth/session` response is rejected by the shipped
JavaScript client and contradicts the generated response schema.

Service principals project as authenticated with a UUID user id and
`session_id: None` in `src/auth/invocation.rs`. `auth_session` in
`src/server.rs` copies that shape into the response. However,
`AuthSessionAuthority`'s schema in `src/auth/handshake.rs` requires every
authenticated authority to have both UUIDv7 `userId` and `sessionId`, and
`projectAuthSessionResponse` in `demos/_kit/client.mjs` enforces the same rule.
`AgentAuthorityFence.authSession()` consequently throws
`SNAPBACK_AUTH_HANDSHAKE_INVALID` before binding its authority descriptor.

The agent handshake unit test masks the defect: `agentHandshake()` starts from
a human session fixture and leaves its non-null session id intact while merely
setting descriptor generation to zero.

**Done when:**

- The closed DTO distinguishes human-session and service authority, or
  otherwise admits the service shape without weakening human session custody.
- Rust serialization/schema, the shared parity corpus, generated artifacts,
  and the JavaScript projector accept exactly the same shapes.
- Browser `AuthCoordinator` still refuses an authenticated human authority
  with a null session id.
- A real-server integration mints a scoped token and completes `/auth/session`,
  a queued mutation, and a live subscription through `AgentAuthorityFence`.
