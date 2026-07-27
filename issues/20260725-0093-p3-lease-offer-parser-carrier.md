# 0093 P-3: authorized-lease route parses protocol offers with the WebSocket-upgrade grammar

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “0093 P-3: authorized-lease route parses protocol offers with the WebSocket-upgrade grammar” shows the issue reaches a security, correctness, release, or core product boundary; delay compounds an active rollout, reliability, or verification risk, while the implementation is localized and has concrete acceptance witnesses, with a direct reproduction or current implementation proof.

**Opened:** 2026-07-25
**Source:** LLP 0096 §8.2 (P-3 verification pass)
**Systems:** Auth, Server
**Kind:** doctrine divergence (decide + align)

## Finding (verified at `0de3e875`)

`invoke_authorized_lease_query` reads its protocol offers via
`AuthClientProtocolOffers::from_headers` (`src/server.rs:16205`) — the
WebSocket-upgrade parser whose `Sec-WebSocket-Protocol` fallback exists
solely for genuine browser upgrades — on the ordinary HTTP route
`POST /query/{name}/authorized-lease`.

The doctrine is explicit in two places that this must not happen:

- `src/auth/handshake.rs:42-44` (`from_http_headers` doc): "Ordinary
  HTTP requests accept only the four named decimal headers.
  `Sec-WebSocket-Protocol` is a carrier exclusively for a genuine
  browser WebSocket upgrade and must not become a second bootstrap
  grammar."
- `src/server.rs:7865-7875` (route-level gate): only
  `/live/{connection_id}/stream` uses `from_headers`; "a forged
  Sec-WebSocket-Protocol header must not become a second HTTP grammar."

Effect: a `Sec-WebSocket-Protocol: snapback.authorized-lease.1,
snapback.auth-invalidation.1` header on the lease POST is an accepted
alternate offer carrier on this one route. Offers are not credentials,
so this is a second-grammar divergence, not a credential hole — but it
means the lease route's refusal behavior differs from every other
protected HTTP route, and LLP 0096 §2.4's carrier claim ("HTTP header,
per-request") is true only up to this seam.

## Fix shape

One token: `from_headers` → `from_http_headers` at
`src/server.rs:16205`, plus a regression test asserting the subprotocol
carrier is ignored on the HTTP lease route. This changes observable
refusal behavior for any caller relying on the subprotocol carrier
there (none known in-repo; the kit sends headers), so land with a brief
blast-radius note rather than silently.
