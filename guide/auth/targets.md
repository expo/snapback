---
title: Targets — what each one claims
id: auth.targets
order: 7
audience: agent-first
capabilities: [auth.target-honesty, auth.sender-constrained-browser]
authorities: [llp/0060-hosted-auth-security.rfc.md, llp/0072-trusted-single-tenant-control-plane.rfc.md, llp/0077-sender-constrained-browser-auth.spec.md, llp/0002-canonical-local-target.decision.md, llp/0014-cloudflare-strategy.rfc.md, src/admin.rs, packages/snapback-client/hosted-browser.mjs, README.md]
examples: [packages/snapback-client/hosted-browser.test.mjs, packages/snapback-client/sender-transport.test.mjs, tests/sender_proof_cross_language.rs]
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-10
reviewed-authorities-digest: sha256:c9a46467cbe390642c43535f8e137e9f239cb51d3887f1c412bfd5004db1caf9
---

# Targets — what each one claims

Snapback is deliberately honest about which guarantees belong to which
execution target. Guide pages carry `targets:` frontmatter for exactly this
reason; this page is the map those banners point to.

## Local (Ibex + SQLite) — the canonical dev/test target

The full local server (LLP 0002) is where every guide technique on a
`targets: [local]` page holds: server-authoritative mutations with one
commit version and read-set validation, live queries over the durable lane,
ephemeral realtime, and local sessions-mode auth with server-derived
principals, connection-bound live grants, auth-invalidation barriers, and
signed authorized-lease offline retention. The systematic local contract is
[protecting live and retained data](./protecting-data.md).

**What the local target deliberately does NOT claim** (LLP 0060; the
README's must-not-claim posture): these are local-target guarantees, not
hosted-auth readiness. The local target reports no target-owned external
TLS, no trusted effective-source derivation, no shared authentication
throttle, no multi-replica invalidation, and no sender-constrained browser
credential. Hosted auth is honestly **disabled** on the local bearer
target rather than half-claimed.

### A public tunnel does not make the loopback server production-ready

Profile derivation sees the server's actual bind address, not the URL that a
reverse proxy advertises. A server listening on `127.0.0.1` remains in the
development profile when ngrok, Cloudflare Tunnel, Tailscale Funnel, SSH, or
another proxy exposes it publicly. The tunnel does not add trusted effective
source derivation, TLS ownership, shared throttling, or hosted credential
custody, and Snapback cannot infer those properties from forwarded headers.

Setting `SNAPBACK_PROFILE=prod` is not a repair. The explicit production
profile fails closed when the hosted prerequisites are absent and may refuse
the local-only provisioning and impersonation operations the app needs. Treat
a tunnelled loopback server as an unsupported public exposure: use it only in
a controlled development context, never as a production deployment recipe.

## Cloudflare — the hosted proof, as far as it is real

The Cloudflare target (LLP 0014/0040/0049) is a working proof — the All
Aboard demo runs live on it with Durable Objects storage, deploy-time
secrets, gated action egress, and settled idle-to-zero evidence. It is a
narrow proof, not a paved product target: treat any technique on a page
without `cloudflare` in its `targets:` as unverified there, and treat
hosted auth as absent until LLP 0060's contract is implemented and
witnessed. Deployment, secret, egress, hibernation, and non-claim details are
in [deploying the Cloudflare proof](../deploying/cloudflare.md).

## Single-instance container/VM — selected, not yet available

LLP 0072 selects `single-instance-container-vm.v1` as the first target that
must satisfy the complete trusted single-tenant profile. The target-neutral
release, plan, lifecycle, backup, rollback, restore, log, inspection, and audit
contracts exist and pass a deterministic non-remote driver. No provider,
account, region, public origin, remote storage, or external audit sink has yet
passed the qualification drill. Therefore the profile is **partial** and no
server may report `trusted-single-tenant-app-complete.v1`.

The package contains a future hosted app-browser entrypoint:
`HostedBrowserSnapbackClient` from
`@expo/snapback-client/hosted-browser`. Its constructor requires coordinator-owned
custody, accepts only HTTPS, and exposes no bearer, admin-token, or
agent-authority option. The implementation generates a non-extractable P-256
key, binds issuance and refresh to it, signs protected HTTP and WebSocket
requests, rotates server nonces, and rejects replay. Sender sessions and grants
use legacy-rejecting v2 syntax; unknown carriers receive keyed stateless cover
nonces; a bounded key-bound tombstone recovers a committed logout whose
response was lost; and the socket queue releases only after the first
in-band successor-nonce frame. Cross-language, pre-body, custody-recovery,
challenge-retry, refresh, grant-route-matrix, and real WebSocket tests exercise
those facts.

This is implementation evidence, not an authoring technique on a live target.
Do not use the generic `SnapbackClient` direct-bearer constructor as a
production-browser substitute. A concrete adapter must first authenticate the
public origin and admission producer, pass the complete negative/pressure
matrix, produce the monotone replay-epoch floor outside the application backup
set, and execute the remote LLP 0072/0077 drill.

## How to check instead of trusting prose

A running server states its own capabilities: `GET /inspect` carries the
capability manifest with runtime facts including `authProgramReadiness`
and the active auth mode. When a page's claim and a server's report
disagree, the server is right and the page has drifted — file a guide gap
(see [conventions](../conventions.md)).

## Anti-patterns

- **Do not generalize a local guarantee into a hosted claim.** The gap is
  the product's honesty boundary, and this guide inherits it mechanically.
- **Do not ship a browser bearer credential to real users on the local
  target and call it auth.** That configuration exists for local
  development; LLP 0060 documents why it must not be marketed as more.
