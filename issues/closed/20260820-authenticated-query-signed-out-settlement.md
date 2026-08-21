# Authenticated headless query started signed out can hang without settlement

**Status:** Resolved
**Opened:** 2026-08-20
**Resolved:** 2026-08-21
**Landing SHA:** 5521ca7eb
**Systems:** Headless client, Auth, Queries, Settlement, Diagnostics
**Related:** LLP 0059; LLP 0095; LLP 0277 P16; LLP 0295; Diary 0099

## Problem

The Grok Coterie Familiar lane observed an authenticated `client.query`
started while signed out that never issued HTTP and did not settle with the
expected auth-required result. That made provider bootstrap indistinguishable
from a transport stall and prolonged M3 correction work.

## Resolution

One-shot admission now settles in the promise microtask queue before transport
when generated authenticated metadata or an active coordinator transition says
that no request is admissible. Refusals carry `transitionOwner:
"auth-coordinator"`, `effectCommitted: false`, and one of three documented
reasons:

- signed out: `SNAPBACK_AUTH_REQUIRED` / `authentication-required`;
- signing in or signing out: `SNAPBACK_CLIENT_AUTHORITY_CLEARING` /
  `authentication-not-settled`;
- revoked: the recorded terminal code (for the proof,
  `SNAPBACK_AUTH_SESSION_REVOKED`) / `authentication-terminated`.

The active-transition check also covers older generated query references that
do not carry `authRequirement`, without changing their settled server-side
classification or durable outbox replay ownership. Signed-in one-shots issue
transport and settle normally.

React live-query projection now exposes an auth-owned state at every boundary:
`blocked(authentication-required)` while signed out,
`blocked(authentication-not-settled)` while a transition owns publication,
`ready` while signed in, and `error` carrying the recorded terminal code after
revocation. Nonterminal authorization proof errors retain their prior blank
projection.

## Reproduction and proof

The exact published `@expo/snapback-client@0.1.24` tarball (npm integrity
`sha512-DDrNi+zxe/H2FHAYWiVykQ9xfjRQGe4+lb6npBHAUePMx9jUbC6MMASxRSJqrvJ03PFES06ab/xjYX5EtHbrvg==`)
reproduced the transition join with a legacy generated authenticated query:

```json
{"packageVersion":"0.1.24","sentinel":"sentinel","outcome":"pending","queryRequests":0}
{"afterBarrierRelease":"resolved","queryRequests":1}
```

The timeout-independent source tests use one microtask and exact transport
counters; they do not use an operation timeout. The packed proof installs only
the freshly packed contract, client, and React tarballs into an external
`node_modules` closure and runs the same five-state by two-kind matrix:

| Authority state | One-shot query | Live query |
| --- | --- | --- |
| signed out | `SNAPBACK_AUTH_REQUIRED` | `blocked:authentication-required` |
| signing in | `SNAPBACK_CLIENT_AUTHORITY_CLEARING` | `blocked:authentication-not-settled` |
| signed in | `success` | `ready` |
| signing out | `SNAPBACK_CLIENT_AUTHORITY_CLEARING` | `blocked:authentication-not-settled` |
| revoked | `SNAPBACK_AUTH_SESSION_REVOKED` | `error:SNAPBACK_AUTH_SESSION_REVOKED` |

Fresh packed tarball integrities:

- `@expo/snapback-contract`: `sha512-ALx5GYme79Kf45WRtTYXC3oAeCNGQAryIYIDLeCSCnsCaOmvbBkIiN7gBgCjHMGK2cX21mhpkIYr/oLtI4RGCA==`
- `@expo/snapback-client`: `sha512-iNbDRo3NV+ivhflECAkJeXLwl/YSHLiw82MEVobaQbQ/D3JxQxyKKp8sXl3vO8aD+KUNRDQoHhKDHR16/go/AQ==`
- `@expo/snapback-react`: `sha512-SBXg9b1HRdRNWSD19gfJnAuRXqd5BE1G1KIE4WDBEJUVJpzYYuBayax/tQCH5ScdvQDSH7ZklMW4r51YFIRULQ==`

The client test body, focused React settlement suites, optional-user transition
matrix, React type fixtures, packed proof, generated Guide projections, and
`ref-check --verbose` cover the repair. Guide check passes 18 of 19 sections;
its symbol-registry section and the inventory wrapper reach the inherited
`@expo/snapback-expo` CommonJS `module.exports` parity red. The two full-package
test commands also expose inherited failures reproducible unchanged at clean
`3f9e26af0`: the generated optimistic outbox fixture handles an outbox barrier
request as a mutation and reads absent `settlementClaims.mints`, and the React
optimistic replay-advisory fixture observes zero warnings instead of one.
