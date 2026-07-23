# DECISION: close the client contract — AuthCustodyV3, grant shape, logout recovery, cover nonce, downgrade, WS state machine

**Status:** Open (all six forks decided 2026-07-23 — LLP 0077 §Author decisions items 2-7; residual work: draft the closed AuthCustodyV3 schema text and the LLP 0059 BoundGrantAuthorityV2 amendment)
**Severity:** P1
**Systems:** Auth, Browser client, WebSocket, Control plane
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 open questions + §Browser custody + §WebSocket, LLP 0059 (BoundGrantAuthorityV1, AuthCustodyV3 "closed" claim), LLP 0057 (repeat-logout SESSION_EXPIRED), LLP 0060 D6 (downgrade barrier), issues/20260723-llp0077-grant-binding.md, issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, decision, client-contract

The bundle of open author decisions that must close before a second **client**
is buildable from LLP 0077 and before it can leave Draft. Each is a fork to
resolve, not a defect to fix. LLP 0060 C3 delegates the custody contract, so
these are within charter; the Spec currently scopes itself honestly as the
server-wire contract until they close.

**Resolved when** each of the following is pinned in LLP 0077 (and the relevant
authority amended):

- The complete closed `AuthCustodyV3` top-level and nested `formatVersion`
  schema, including anonymous, clearing, pending, corrupt, migration, and
  recovery states (LLP 0059 calls it "closed"; 0077 says "V2 plus" is
  insufficient — reconcile).
- The versioned `BoundGrantAuthorityV2` grant shape (thumbprint + admission
  epoch), its equality/invalidation rules, and the LLP 0059 amendment (feeds
  `20260723-llp0077-grant-binding.md`).
- The final logout-lost-response mechanism (the bounded revoked-family tombstone
  is the current default): its exact retention bound, resolution/lookup path,
  nonce treatment, convergence to LLP 0057 `SESSION_EXPIRED`, and the
  long-offline eventual-safe-deletion guarantee.
- Whether unknown carriers receive a stable keyed cover nonce (e.g.
  `HMAC(secret, replay_epoch‖token_digest‖time_bucket)`) or the residual
  bound-family existence signal is accepted.
- The downgrade defense: a legacy-rejecting v2 token/carrier syntax, or sole
  reliance on LLP 0060 D6's activation/rollback barrier — plus the v1-family
  activation/rollback matrix.
- The browser-observable WebSocket successor-nonce state machine: queue release
  and resynchronization after a successful upgrade whose 101 header JS cannot
  read; open/error/cancel/reconnect transitions.

## Decisions record (2026-07-23)

All six forks decided by Charlie Cheever (interactive session 1681e9d6) and
pinned in LLP 0077 §Author decisions — 2026-07-23: logout = bounded
revoked-family tombstone (retention = max TTL + skew, 30-day cap; no nonce
rotation for tombstoned families; converges to LLP 0057 SESSION_EXPIRED);
keyed cover nonce for unknown carriers (HMAC(secret, epoch‖token_digest‖
time_bucket)); downgrade = legacy-rejecting v2 syntax + D6 barrier;
WebSocket queue releases on the first server frame carrying the successor
nonce (failure paths resync via fresh challenge); BoundGrantAuthorityV2 =
V1 + custody JWK thumbprint + issuance sender_replay_epoch, exact-tuple
equality; AuthCustodyV3 = complete closed seven-state schema
(anonymous/pending/active/clearing/corrupt/migrating/recovery).

Remaining before this ticket closes (spec drafting, now unblocked and
shape-pinned): the closed AuthCustodyV3 schema text in LLP 0077, and the
LLP 0059 amendment for BoundGrantAuthorityV2 (rides
20260723-llp0077-grant-binding.md, which is now unblocked). Coordinate the
schema text with the in-flight custody implementation
(packages/snapback-contract/auth-custody-indexeddb.mjs).
