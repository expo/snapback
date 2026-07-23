# Sender-bound grants: proof on every carrier and route (no bare-bearer grant path)

**Status:** Open
**Severity:** P1
**Systems:** Auth, HTTP, WebSocket, Hosted runtime, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §WebSocket and connection binding + defect 2, LLP 0059 (BoundGrantAuthorityV1), src/server.rs (grant admission, connection-token routes), packages/snapback-client/index.mjs (generic HTTP proof ath), issues/20260723-llp0077-client-contract.md, issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, grants, security

Closes LLP 0077 ledger **defect 2** — the highest-severity live seam. Sender
admission recognizes a grant only through the WebSocket subprotocol carrier;
header-carrier connection-token HTTP acts (live, outbox, ephemeral) reach
ordinary connection-token authentication and act as **bare bearers**, and the
generic client hashes the session bearer into `ath` where a grant is the
presented credential. The Spec requires a valid proof on **every** grant use,
on both permitted carriers, with `ath` covering the grant token.

Depends on the versioned `BoundGrantAuthorityV2` shape (thumbprint + admission
epoch) and its equality/invalidation rules plus the LLP 0059 amendment, tracked
in `20260723-llp0077-client-contract.md`.

**Done when:**

- One carrier-independent grant resolver gates every grant-presenting route;
  each grant use requires a grant-token-`ath` proof regardless of carrier.
- The client forms the grant-token `ath` (not the session bearer) on every
  grant-presenting request.
- `BoundGrantAuthorityV2` lands with equality/invalidation rules and the LLP
  0059 amendment note.
- A generated route × carrier negative matrix proves missing, malformed,
  wrong-`ath`, replayed, and authority-unavailable proofs are refused before
  handler execution on every grant route and both carriers.
- LLP 0077's defect 2 row moves to closed; the "no sender-bound grant acts as a
  bare bearer *(defect 2)*" rule drops its tag.
