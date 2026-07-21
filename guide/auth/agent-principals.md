---
title: Agent principals and scoped grants
id: auth.agent-principals
order: 4
audience: agent-first
capabilities: [auth.agent-principals]
authorities: [llp/0055-agent-principals-and-scoped-grants.rfc.md, packages/snapback-client/agent-authority.mjs, packages/snapback-app-cli/index.mjs, packages/snapback-app-cli/package.test.mjs, src/server.rs]
examples: [packages/snapback-app-cli/package.test.mjs, demos/_kit/tests/auth-handshake.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-19
reviewed-commit: 7d686f7d4ce4f606e3f9a00aeb1ea50d211ac1a7
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

## Pair an already registered agent

Registration is an owner or invitation flow that creates the agent and returns
its one-time credential. Keep that credential outside source, logs, generated
artifacts, and model output. Pairing then delegates a user's authority without
letting the agent name or enumerate users:

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

The token response contains `tokenId`, `grantId`, `credentialId`,
`credentialGeneration`, expiry, canonical scopes, and the bearer. Re-polling an
approved request rotates the first token; it does not retrieve old plaintext.

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
- Do not retry `SNAPBACK_AUTH_GRANT_INVALID` as if it were pending.
