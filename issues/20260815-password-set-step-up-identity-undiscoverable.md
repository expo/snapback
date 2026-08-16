# `authPasswordSet`'s step-up `identityId` is not discoverable from any product surface

**Status:** Open
**Opened:** 2026-08-15 · **Severity:** P2 · **Area:** Client surface / auth / Guide
**Found by:** the password clean-install proof
(`issues/closed/20260809-password-credential-auth.md`), against published
0.1.22 packages.

## Problem

Setting a first password on an email-code principal requires a step-up mint:
`POST /auth/step-up/request` with `{"operation":"passwordSet","identityId":…}`
(a request-code challenge **without** `identityId` refuses
`SNAPBACK_AUTH_REQUEST_INVALID`). But `identityId` is not exposed anywhere on
the product surface — not in the exchange response, not in `/auth/session`,
not in the control catalog. The proof had to read `_auth_identities` directly
from its own sqlite store.

Consequently `@expo/snapback-client.authPasswordSet` appears **uncallable
end-to-end from the published client alone**: it forwards `stepUp` verbatim,
but the client exposes no step-up mint method and no identity listing.

Compounding guide defect: `guide/auth/passwords.md` says to acquire the
step-up "with `POST /auth/request-code`" — the working route is
`POST /auth/step-up/request`.

## Desired resolution

- Expose the caller's identity id (or an identity-free step-up spelling for
  the self-service `passwordSet` case) on a product surface the published
  client can reach, and give the client a step-up mint path so
  `authPasswordSet` is callable without raw HTTP.
- Correct the passwords guide's step-up route and document the working shape.
- The HTTP journey itself works once the id is known (proven end to end);
  this is a discoverability/surface gap, not a broken mechanism.
