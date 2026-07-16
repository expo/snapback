---
title: Targets — what each one claims
id: auth.targets
order: 3
audience: agent-first
capabilities: [auth.target-honesty]
authorities: [llp/0060-hosted-auth-security.rfc.md, llp/0002-canonical-local-target.decision.md, llp/0014-cloudflare-strategy.rfc.md, README.md]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-07-15
reviewed-commit: b0e8431ade5325b794d3f62bad2b58567215d74e
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

## Cloudflare — the hosted proof, as far as it is real

The Cloudflare target (LLP 0014/0040/0049) is a working proof — the All
Aboard demo runs live on it with Durable Objects storage, deploy-time
secrets, gated action egress, and settled idle-to-zero evidence. It is a
narrow proof, not a paved product target: treat any technique on a page
without `cloudflare` in its `targets:` as unverified there, and treat
hosted auth as absent until LLP 0060's contract is implemented and
witnessed.

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
