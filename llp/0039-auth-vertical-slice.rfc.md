# LLP 0039: Auth vertical slice

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Sync, Storage, API, Security, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-07 (cross-family review revisions, ratified by Charlie —
see `reviews/0039-auth-vertical-slice.claude.md`: connection-namespace
ownership, 0011 alignment on `roles`/accounts/user-switch, provisioning and
redaction constraints restated, acceptance expanded. Same day: connection
section corrected against post-0038 code — the transport-level
`connectionToken` guard already shipped; this slice binds it to principals.
Initial same day)
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0020, LLP 0024, LLP 0031, LLP 0032, LLP 0038, LLP 0042, LLP 0043, LLP 0045

## Summary

This RFC defines the smallest auth slice that changes Snapback from "dev
impersonation with auth-shaped hooks" into a product that can run a real
multi-user application. It does not replace [LLP 0011](./0011-auth-and-permissions.rfc.md);
it selects a first implementation path through it. Where this document
restates a contract 0011 pins, 0011 wins; divergences from 0011 are called out
explicitly below, not implied.

The slice is:

- server-issued sessions and a stable `ctx.auth`;
- one built-in passwordless email-code provider with local capture in dev;
- protected `_auth_*` identity/session tables that are never synced to clients;
- app-visible profile and membership rows keyed by Snapback user id;
- live/outbox connections bound to the session's principal, extending the
  existing server-minted `connectionToken` transport guard to real user
  identity;
- declared auth-variable dependencies for sync filters;
- authorization epochs feeding the existing `resync_required` path;
- diagnostics for denied, unauthenticated, and stale-auth cases.

## Motivation

Auth is the offering hole with the widest blast radius. Without it, Snapback
cannot honestly support private rooms, team apps, card games with hidden state,
authorized partial sync, generated app-data MCP with hosted authority, or the
"auth data next to your data" claim from [LLP 0000](./0000-snapback.explainer.md).

The implementation should be deliberately narrow. The goal is not to become
Clerk or WorkOS in one pass. The goal is to make one real session flow drive the
same query, mutation, live, sync, diagnostics, and test machinery that app
authors will use for every later provider.

## Design

### Protected identity core

Snapback owns protected identity tables:

- `_auth_users`
- `_auth_identities`
- `_auth_sessions`
- `_auth_verification_codes`

One deliberate narrowing of LLP 0011's model (ratified by Charlie,
2026-07-07): 0011 (following Valet's export shape) distinguishes user,
**account**, and session; this slice merges the account record into
`_auth_identities`, since the only provider is built-in email code and there
is no external account object to mirror. Whether `_auth_accounts` returns with
the first external OAuth provider is an open question below.

These tables are server-authoritative system tables. Generated client types do
not expose them as syncable app data. Export and backup may include durable user
and identity facts, but ephemeral sessions, verification codes, and secret
material are excluded by default (the same exclusion list
[LLP 0046](./0046-postgres-graduation-path.rfc.md) inherits for migration
bundles). Session tokens are stored only in hashed form, and tokens, codes, and
secret claims are redacted from logs and diagnostics
([LLP 0011](./0011-auth-and-permissions.rfc.md) §Security Considerations).

Application code sees a stable principal, matching 0011's minimum shape:

```ts
type AuthContext = {
  userId: string | null
  sessionId: string | null
  isAuthenticated: boolean
  provider?: string
  roles?: string[]
}
```

`roles` is carried because 0011 pins it in the minimum shape and LLP 0024's
`--as-role` impersonation depends on it; *role-based permission checks* are a
non-goal of this slice. (Implementation note: `src/ephemeral.rs` already has a
room-permission-shaped Rust type named `AuthContext`; the principal context
must not collide with it.)

App-visible profile and membership tables are ordinary app tables keyed by
`ctx.auth.userId`. Those rows are the joinable, queryable "auth next to data"
surface.

### Built-in first provider

The first provider is passwordless email code:

- request code, with per-address request throttling (attempt counts protect
  the exchange; throttling protects against mail-bombing) — throttle
  violations return a structured diagnostic;
- store hashed code with expiry and attempt count; codes are single-use and
  attempt-limited with a lockout diagnostic;
- deliver through a local capture mailbox in dev — owned by
  [LLP 0045](./0045-notifications-outbox.rfc.md)'s outbox design, which this
  slice seeds with a minimal implementation;
- later deliver through the notifications/provider subsystem (0045 records
  this handoff decision);
- exchange valid code for a server-issued session.

Two constraints restated from 0011 because a builder will otherwise violate
them by default: first-login provisioning is transactional from the verified
request — it must not depend on a webhook racing in first — and credential
hashing/verification runs outside the single-writer lock, so slow hashing can
never serialize the write lane.

This is enough to prove first-login provisioning, login, logout, session
refresh, handler `ctx.auth`, and unauthenticated denial without binding the
first slice to an external provider's account model.

### Session transport

The local web target should support bearer tokens and same-site cookies. The
server derives `ctx.auth` from the session token. Cookie-mode requests require
an origin check: the local server's loopback CORS deliberately echoes any
localhost origin, so cookie sessions without an origin/CSRF stance would let
any local page ride a logged-in browser. Clients may not supply `userId`
directly except through the explicit local-dev impersonation authority already
modeled by LLP 0024; impersonated operations emit 0024's audit fact
(`localDevOnly: true`), not just console labeling.

Every request and WebSocket subscription records the resolved auth context.
The transport-level connection guard already exists: the unauthenticated
connection-id surface [LLP 0038](./0038-snapback-system-review.research.md)
Part 4 #6 reported was closed after that review — `/outbox/{connection_id}`
and `/live/{connection_id}/stream` are `ConnectionAuth`-classified and require
the server-minted `connectionToken`. What this slice adds is the *principal*
binding on top of it: a connection created under a session carries that
session's auth context, a connection token minted under one principal is
rejected when presented under another, and session expiry or revocation
invalidates the connection's grant. Without that, "private rooms" would be
private only per transport handle, not per user.

If a session expires or switches users, the client must wipe all local data,
mutation queues, and subscriptions for the prior user (0011's ratified rule —
stronger than merely invalidating results; the offline-retention consequences
are [LLP 0043](./0043-offline-replay-retention.rfc.md)'s to enforce). Replay
parity of `ctx.auth` between optimistic client runs and authoritative replay
is a hard 0011 requirement that this slice defers, explicitly, to LLP 0043's
queued-replay milestone.

### Permission dependencies

The first permission model is intentionally small:

- function handlers may reject based on `ctx.auth`;
- syncable query filters may reference declared auth variables such as
  `auth.userId` (the `authUserId()` expression and fail-closed scope
  evaluation already exist — `ValueExpr::AuthUserId`,
  `PermissionScopeExpr::AuthUser`);
- permission-affecting writes may advance an authorization epoch for a
  declared scope. Which writes are permission-affecting is declared, not
  inferred: membership/profile writes that back a declared scope advance that
  scope's epoch. Session lifecycle is handled directly — logout and
  session revocation invalidate that session's subscriptions without
  a general epoch sweep;
- affected subscriptions receive `resync_required` and re-enter with a fresh
  authorized snapshot.

This avoids claiming arbitrary per-row live permission re-evaluation in v1 while
still making permission changes fail closed.

### Diagnostics

Denied auth paths return structured diagnostics, not generic 500s:

- `SNAPBACK_AUTH_REQUIRED`
- `SNAPBACK_AUTH_SESSION_EXPIRED`
- `SNAPBACK_AUTH_PERMISSION_DENIED`
- `SNAPBACK_AUTH_STALE_RESULT`
- `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE`

The code already ships `SNAPBACK_AUTH_USER_MISSING` (fail-closed scope
evaluation without an authenticated user); it remains valid and this slice
maps it alongside the new codes rather than replacing it.

The admin console and host-ops surfaces should display whether an operation ran
as unauthenticated, a real session, local-dev impersonation, or an admin bypass.
New `/auth/*` routes are classified in the LLP 0031 route registry with the
same enforcement-test coverage as existing routes.

## Non-goals

- OAuth/OIDC provider adapters in the first slice.
- Organizations, teams, invitations, SCIM, SAML, or enterprise policy.
- Role-based permission checks (the `roles` field is carried; checks are not).
- Declarative write-side row-level rules (insert/update/delete checks) — that
  remains 0011's later surface; this slice's write authorization is handler
  rejects.
- Cross-provider identity linking policy.
- Client-side visual hiding of unauthorized rows.
- Encryption at rest for client-retained data (see LLP 0043's open question).
- Universal incremental permission re-evaluation for every live subscription.
- Hosted service-principal tokens; those depend on the session core but remain a
  later authority layer (consumed by [LLP 0042](./0042-agent-mcp-surface.rfc.md)).

## Acceptance

- A test app can request an email code, read the local capture mailbox, exchange
  the code, and receive a session.
- Verification codes are single-use and attempt-limited; exceeding attempts
  yields a lockout diagnostic, and repeated requests hit the per-address
  throttle diagnostic.
- Query, mutation, action, and live subscription handlers receive the same
  server-derived `ctx.auth`.
- An unauthenticated client subscribing to an auth-filtered query fails closed
  rather than receiving all rows.
- Two clients subscribed to the same logical query receive different authorized
  results (0011's sharpest partial-sync proof).
- A permission-affecting mutation advances an authorization epoch and causes an
  affected live subscription to resubscribe.
- Session expiry produces `SNAPBACK_AUTH_SESSION_EXPIRED` on both the request
  path and the live path; logout revokes the session server-side and the
  revocation is observable on the live path.
- A connection token minted under one session cannot drain or attach another
  principal's connection, and session revocation invalidates the connection's
  grant.
- A user switch wipes local data, mutation queues, and subscriptions for the
  prior user.
- Local-dev impersonation remains available, is labeled as dev-only in
  diagnostics, emits the 0024 audit fact, and cannot be mistaken for hosted
  authority.
- New `/auth/*` routes are classified in the 0031 registry and covered by its
  enforcement tests.

## Open Questions

- Should the first external provider be OIDC, GitHub OAuth, Google OAuth, or a
  generic bring-your-own verified-token hook? Does `_auth_accounts` return with
  it, or does the identity merge hold?
- What are the session refresh semantics — sliding expiry, rotation on use, or
  explicit re-issue? (One phrase in the flow today; a real design fork.)
- How does the WebSocket handshake carry the session — header, first-message
  auth, or per-subscription token? This blocks a builder on day one.
- What syntax should app authors use for permission declarations before Exact
  Design Mode owns the higher-level authoring path?
- Which auth facts are safe to mirror into app-visible profile rows by default?

## Status

Draft. This is a gap-closing implementation RFC for the first auth slice. LLP
0011 remains the broader auth and permissions design.
