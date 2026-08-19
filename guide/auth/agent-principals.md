---
title: Agent principals and scoped grants
id: auth.agent-principals
order: 6
audience: agent-first
capabilities: [auth.agent-principals, auth.agent-registration]
authorities: [llp/0055-agent-principals-and-scoped-grants.rfc.md, packages/snapback-client/agent-authority.mjs, packages/snapback-app-cli/auth.mjs, packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, crates/snapback-server/src/server.rs]
examples: [packages/snapback-app-cli/package.test.mjs, packages/snapback-app-cli/auth.test.mjs, demos/_kit/tests/auth-handshake.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:4b8a139980b6dd9eaa3f142ff8a2ac66e6c116ddb3bd92c13383ad1ba4f4af54
---

# Agent principals and scoped grants

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

An agent is a service principal with its own credential. It does not borrow a
human session bearer. A grant gives that principal a closed set of function
scopes, and each short-lived scoped token names the agent credential,
credential generation, grant, and token carrier. The server still applies
ordinary auth requirements, row scoping, and
[roles](./scoped-roles.md); a token never bypasses those gates.

## Register an agent

Registration is an explicit sessions-mode schema policy. Omission is
`disabled`; an app must choose `open` or `invited`:

```js fragment reason="show the closed nested policy without coupling this page to an app schema"
auth: {
  mode: 'sessions',
  agents: { mode: 'open' },
}
```

With `open`, call `POST /auth/agents/register` without an Authorization header.
The closed body accepts optional `displayName` and `operatorContact`. The
response returns `{ credentialId, userId, generation, credential }`; generation
is `1` and `credential` is the initial `sbac_` secret. Principal, stable
identity, and credential are committed atomically. The secret is returned once,
so move it directly into credential custody and never put it in source, logs,
generated artifacts, or model output.

```sh
curl -X POST "$SNAPBACK_URL/auth/agents/register" \
  -H 'content-type: application/json' \
  -H 'x-snapback-auth-client-protocol: 1' \
  --data '{"displayName":"Build agent"}'
```

With `invitedBy: 'users'`, a signed-in human first requests an
`agentInvitation` step-up challenge through `POST /auth/step-up/request`, then
submits that proof to `POST /auth/agent-invitations`. The returned `sbagi_`
creation invitation is single-use. Pass it as `invitation` to
`POST /auth/agents/register`; registration consumes it in the same transaction
and records the minting user as the agent owner. A bearer alone cannot mint an
invitation, and the user has at most ten live unconsumed invitations.

`invitedBy: 'operators'` remains declarable so policy is forward-compatible,
but S0 has no host-operation minting twin and codegen emits
`SNAPBACK_AUTH_AGENT_ONBOARDING_PROD_UNAVAILABLE`. Also still absent are the
registration template, agent listing/deletion, owner-issued replacement
credentials, recovery, approval-link ceremony, OAuth facade, and `/api/v1/*`
exposure. Self-service rotation and revocation remain available after an agent
has registered. The app CLI consumes an existing `sbac_` credential and does
not call registration for you.

## Pair a registered agent

Pairing delegates a user's authority without letting the agent name or
enumerate users:

1. A signed-in user calls `POST /auth/pairing-codes` and conveys the short-lived
   code out of band.
2. The agent calls `POST /auth/agents/pair` with `credential`,
   `pairingRequestId`, `pairingCode`, and the exact `requestedScopes`.
3. The user inspects `GET /auth/grant-requests` and approves or denies the
   pending request. Approval displays the agent, provenance, scopes, expiry,
   and owner-assumption disclosure.
4. The agent polls `POST /auth/agents/token` with its credential and
   `pairingRequestId`. `SNAPBACK_AUTH_GRANT_PENDING` means wait; the
   non-enumerating `SNAPBACK_AUTH_GRANT_INVALID` means stop.

The token response contains `tokenId`, `grantId`, server-resolved
`actorUserId`/`effectiveUserId`, `credentialId`, `credentialGeneration`,
absolute expiry, server-relative `expiresInMs`, canonical scopes, and the
bearer. Schedule from `expiresInMs`; do not compare a client clock with the
server's absolute timestamp. Re-polling an approved request rotates the first
token; it does not retrieve old plaintext.

## Choose scopes deliberately

An explicit function scope binds a stable function id, kind, manifest basis,
and whether the function can create authority. A tier scope such as
`{ tier: "query" }` follows the current manifest and therefore includes later
queries. Prefer explicit function scopes when deployment must not silently
expand reach. `authorityCreating` operations never join a tier implicitly.

Delegated grants expire, at most 90 days. Renewal is a new consent. Autonomous
grants come only from the app's registration template on production-like
postures; the local operator mint exists for development and testing, not as a
production escape hatch.

## Fence token custody before doing work

Construct `AgentAuthorityFence` from the token response plus the registered
agent actor id, then pass it to `SnapbackClient` as `agentAuthority`. The client
probes `/auth/session`, verifies the exact service-principal descriptor, and
only publishes results while the captured credential-generation/grant/token
carrier is still current. Use filesystem custody for a long-running Node agent;
use the volatile fence only for a bounded process.

Never return or serialize the bearer as an operation result. Rotation uses
`replaceAgentCredential(...)`; revocation or terminal auth loss synchronously
cuts publication and either retires the carrier or deletes the durable grant
tuple according to the server's classified disposition.

For a bounded command, call `POST /auth/agents/token/release` with the exact
scoped token in its closed body when work settles. It returns an empty 204,
accepts an already-released retained token for lost-response retry, and ends
only that carrier. It never accepts an Authorization header. This release is
not durable grant revocation.

The app CLI's version-1 profile stores the target/app/grant and complete
durable authority tuple plus an absolute credential file reference or named
environment reference. It stores neither the durable credential nor a scoped
token. The CLI re-attests the token receipt against that tuple on every mint,
uses the target-advertised per-grant cap for cross-process admission, and
reserves two cap slots for watch/renewal. Agent credential transport is
literal-loopback-only and non-redirecting.

## Revoke and verify

An agent can use `/auth/agents/revoke-self` and `/auth/agents/rotate` for its own
credential lifecycle. A signed-in grantor manages grants through
`/auth/grants`; operator-only lifecycle actions stay on the host-operations
plane. After a mutation, verify through a query or live snapshot under the same
fenced authority. The packaged acceptance witness in
`packages/snapback-app-cli/package.test.mjs` exercises discovery, pairing,
scoped custody, mutation, subscription, and verification without exposing the
token in its returned result.

## Anti-patterns

- Do not put an admin token into an app agent; host operations and app data are
  separate authority planes.
- Do not let an agent choose an effective user id in a request body.
- Do not treat a tier grant as deployment-pinned.
- Do not persist bearer plaintext in the durable custody ledger or print it in
  diagnostics.
- Do not use `expiresAtMs` and a local wall clock as renewal authority; use the
  server-relative lifetime.
- Do not treat exact token release as grant revocation.
- Do not retry `SNAPBACK_AUTH_GRANT_INVALID` as if it were pending.
