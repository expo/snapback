# 0093 P-2 spec defect: unsubscribe requires the establishing auth identity, undocumented

**Opened:** 2026-07-25
**Source:** LLP 0093 D4 clean-room discipline (P-2 Swift client build).
**Systems:** Wire Protocol, Client SDK, Live Queries

Observed black-box against a dev-mode local server (todo demo backend):

- A subscription established with `input.auth.user_id = "user_ada"` refuses
  `POST /live/{name}/unsubscribe` when the unsubscribe body carries no
  `auth`, with **HTTP 403 `SNAPBACK_LIVE_RESUME_OWNERSHIP` — "subscription
  … is owned by a different live owner"**. Re-sending with
  `auth: {"user_id": "user_ada"}` succeeds.

Three defects for the documents:

1. Neither LLP 0094 (route matrix row) nor LLP 0095 (T-UNSUB) states that
   demand release must present the subscription's establishing identity.
   T-UNSUB is a **conformance obligation** — a client that cannot release
   demand leaks billing-visible demand — so the identity requirement is
   itself conformance-load-bearing: a conformant client must *retain* the
   auth identity per subscription. `live.unsubscribe.input.schema.json`
   carries the `auth` member but nothing marks it semantically required in
   dev mode.
2. The refusal code is misleading: `SNAPBACK_LIVE_RESUME_OWNERSHIP` for an
   *unsubscribe* mismatch reads as an RQS/reattach concern. Either the code
   is intentionally shared across live-ownership checks (then the registry
   should say so) or unsubscribe deserves its own code.
3. The same ownership rule presumably governs `supersedes` resubscribes;
   the reconnect path (T-RECONNECT) should state that the fresh subscribe
   must repeat the identity, or reconnect breaks for authed subscriptions.

**Resolution taken in the Swift client (best effort):** the client retains
`authUserId` per subscription and repeats it on unsubscribe and on every
`supersedes` resubscribe. Verified live (13/13 harness checks).

**Fix wanted:** P-1 (LLP 0095) documents the live-owner identity rule on
T-UNSUB/T-RECONNECT, and the refusal-code registry gains the code with its
actual scope.

## Resolution (2026-07-25)

All three defects addressed as spec edits, verified against the code:

1. **T-UNSUB** (LLP 0095 §1.4) now states the live-owner identity rule:
   release must present the subscription's establishing resolved identity
   (dev mode: the subscribe input's `auth` object) on the same connection
   grant; the predicate is `LiveSubscription::is_owned_by` (`src/local.rs`)
   over `RetainedLiveAuthority::matches` (`src/auth/invocation.rs`), a
   mismatch refuses HTTP 403 `SNAPBACK_LIVE_RESUME_OWNERSHIP`, and
   retaining the identity per subscription is named
   conformance-load-bearing.
2. **The code's scope is now registered**: LLP 0094 §0E gained a scope
   clarification — `SNAPBACK_LIVE_RESUME_OWNERSHIP` is the intentionally
   shared live-ownership refusal minted by `live_owner_mismatch` /
   the shared ownership predicate across unsubscribe, `supersedes`
   replacement on subscribe, resume/reattach, and
   authorization-invalidation manual retry (all call sites in
   `src/local.rs`); the resume-flavored name is recorded as historical
   (LLP 0032 S2).
3. **T-RECONNECT** (LLP 0095 §1.4) now states the fresh subscribe must
   repeat the establishing identity: the `supersedes` validation applies
   the same ownership predicate and known foreign owners fail closed with
   the same code (`subscribe_live` supersession validation,
   `src/local.rs`), so authed reconnect depends on the same retained
   per-subscription identity.

Not done here (deliberately): marking `auth` semantically required in
`live.unsubscribe.input.schema.json` — the member is genuinely optional at
the wire layer (unauthed dev subscriptions release without it); the
requirement is behavioral and now lives in the specs.
