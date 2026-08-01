---
title: Authenticate a native app
id: auth.native-apps
order: 6
audience: agent-first
capabilities: [auth.external-identity-broker]
authorities: [llp/0024-agent-operating-surface.spec.md, llp/0045-notifications-outbox.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, packages/snapback-client/index.mjs, clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift]
examples: []
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-26
reviewed-commit: HEAD
---

# Authenticate a native app

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Snapback supports two native session-entry shapes on the local target:

1. a reachable email-code delivery surface drives `/auth/request-code` and
   `/auth/exchange`; or
2. a trusted server-side identity broker authenticates the user through its
   own front door, invokes `auth.mintSession`, and returns the resulting
   Snapback session bearer to that user.

The second shape is the sanctioned bridge for native development and demos
whose identity system is outside Snapback. It is no longer necessary to
hand-write a second Snapback protocol client after the bearer is issued:
JavaScript uses `createExternalSessionClient(baseUrl, { bearerToken })`, while
Swift sets `Configuration.sessionBearer`.

## Keep the broker server-side

`auth.mintSession` is a host operation available only in dev/test/demo. It
requires all three independent authorities: the ordinary AdminWrite token, the
process-bound impersonation capability, and active sessions mode. The broker
must live in the trusted server deployment that can hold those authorities.
It authenticates the external user, maps that identity to the email passed to
the host operation, and releases the returned bearer only to that same user.

Never put the admin token, impersonation capability, ready-file, or mailbox
reader in a browser or native bundle. Never expose a generic “mint for email”
endpoint without the broker's own user authentication and abuse controls.

## Carry the adopted bearer

An external bearer is ordinary protocol-client custody, not
`AuthCoordinator` browser custody and not sender-constrained custody. The
client must offer `auth/rr`; auth-scoped live work must additionally offer
`auth/live`, create an authorization namespace, process invalidation snapshots,
and acknowledge them after apply. The first-party JS factory and Swift client
do this.

Replacing or clearing a bearer is an authority transition. In JavaScript use
`await client.replaceBearerToken(nextBearer)` (or `null` to clear): it releases
protected live-query demand, blanks predecessor rows, retires old grants and
transports, and only then fresh-subscribes under the successor. The synchronous
`setBearerToken` method refuses a changed value because it cannot provide that
barrier. A broker that rotates credentials supplies the replacement bearer
explicitly; the external-bearer seam does not silently assume refresh
ownership.

A transition that completes settles — including a downgrade. When the server
answers a handle's successor fresh-subscribe with an authorization refusal
(for example `SNAPBACK_AUTH_PERMISSION_DENIED`), the transition still
resolves; the denial lands on that handle as the frozen
`handle.authorizationDenial` fact (`{ code, message, atMs }`), is delivered to
`onUpdate` observers as an `authorization_denied` update, and renders as the
`error` query state under the React provider. The denied handle stays parked:
the next authority transition (for example rotating back to the original
bearer) fresh-subscribes it and clears the fact — no process restart. Genuine
lifecycle breakage during a transition (transport loss, broken callbacks)
still rejects with an `AggregateError`.

## Know the production boundary

The shipped email provider's capture mailbox and `auth.mintSession` are
non-production only. LLP 0045's production delivery adapter remains unbuilt,
and the Cloudflare arm exposes no sessions routes. This page therefore does
not claim hosted production native auth.

On a sender-constrained deployment, a generic native bearer is also
insufficient: LLP 0077 defines browser WebCrypto custody only, and native
Secure Enclave/Keystore proof transport remains a named design gap.

## Anti-patterns

- Do not fetch the process-local mailbox from a phone.
- Do not ship broker/admin authority in the app.
- Do not describe an external bearer as sender constrained.
- Do not infer hosted support from the local broker seam.
