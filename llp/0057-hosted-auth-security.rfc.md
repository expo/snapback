# LLP 0057: Hosted auth deployment and client-page security

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Security, Deployment, HTTP, Realtime, Client integration, Browser, Operations
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-07-13 (initial contract for ENG-24607)
**Related:** LLP 0000, LLP 0009, LLP 0011, LLP 0012, LLP 0030, LLP 0031, LLP 0039, LLP 0040, LLP 0047, LLP 0053, LLP 0054, LLP 0055, LLP 0056

## Summary

This RFC owns the two security boundaries that the auth program previously
named without assigning: deployment security for a session-enabled public
service, and the client-page XSS posture of browser-held credentials.

The current local Rust target is **not a hosted-auth target**. It may serve
session mode on a plaintext loopback listener for local development and for an
operator-managed reverse proxy, but the latter is an operator-owned exposure:
Snapback cannot see the browser-to-edge TLS leg, identify the original peer,
share throttle state, or propagate session invalidation between replicas. It
therefore makes no hosted-readiness claim from a loopback bind.

The current browser protocol is deliberately bearer-first. The
`AuthCoordinator` keeps the session family in transactional app-origin custody
and never uses `localStorage` as the authority source, but an active script in
that origin can still read or use the bearer. Content Security Policy and
dependency hygiene reduce the chance of XSS; they do not change that boundary.

This RFC makes three decisions:

1. A session-enabled local server MUST refuse a plaintext non-loopback listener
   before bind with `SNAPBACK_AUTH_TRANSPORT_INSECURE`. There is no sessions
   override. A loopback reverse proxy remains explicitly outside that fence.
2. A target MUST NOT advertise hosted auth until it can attest all four edge
   facts in this RFC: end-to-end external TLS, trustworthy effective-source
   derivation, shared throttling, and multi-replica invalidation convergence.
3. Browser auth v1 remains bearer-first and honestly not XSS-resistant.
   Sender-constrained credentials are the v2 direction. They are required
   before Snapback advertises an XSS-hardened hosted-browser posture, and their
   guarantee is off-device replay resistance—not immunity to an attacker
   executing inside the live page.

This document does not thaw or reinterpret LLP 0039. It owns the companion
contract that LLP 0039 deliberately left open.

## Scope and ownership

This RFC owns:

- the minimum edge facts required to call a Snapback session deployment
  hosted-ready;
- the local target's plaintext listener refusal and its exact limit;
- effective client-source derivation behind proxies;
- shared authentication throttling and multi-replica invalidation requirements;
- browser credential-custody threat claims;
- the v1-to-v2 sender-constraint direction; and
- the capability and diagnostic honesty rules for those properties.

It consumes without re-owning:

- LLP 0009's runtime sandbox and tenant-isolation floor;
- LLP 0030/0031's local dev proxy and route-taxonomy boundaries;
- LLP 0039's authority, session, connection, and activation model;
- LLP 0053's authorization-invalidation stream; and
- LLP 0056's session projection, two-phase revocation, and client clear barrier.

It does not design a hosting control plane, certificate provisioner, global
rate-limit database, or multi-region topology. Those implementations may vary
by target. The claims and fail-closed gates below may not.

## Threat model

### Deployment attackers

The deployment contract considers:

- a network observer or active intermediary between browser and public edge;
- a caller that forges forwarding headers by reaching the app server directly;
- a caller distributing login, exchange, refresh, and connection-open attempts
  across replicas;
- a replica that has not yet observed a logout, expiry, rotation, reset, import,
  restore, permission event, or authorization-stream incarnation change; and
- ordinary process loss, partition, retry, and message duplication.

The contract does not make application code safe to host on the local Hermes
target. LLP 0009 and LLP 0047 separately gate untrusted execution and resource
limits.

### Browser attackers

The browser contract considers an attacker who can execute JavaScript in the
application origin through an application XSS, compromised dependency, injected
extension/content script with page privileges, or equivalent supply-chain
failure. Such an attacker can inspect page memory, invoke same-origin APIs, and
access origin storage permitted to page scripts.

The browser contract does not pretend to protect a fully compromised device,
browser profile, native runtime, or operating system. It also does not treat a
non-extractable signing key as a sandbox: code executing in the origin may still
ask the browser to sign while that code is active.

## Deployment security contract

### D1. Plaintext listener fence

The local `snapback` server speaks plaintext HTTP. Before binding a listener it
resolves the configured host to the exact IP it will bind and applies this
matrix:

| Effective auth posture | Loopback IP | Non-loopback IP |
| --- | --- | --- |
| settled `dev` | allowed | refused unless the explicit non-production dev override is present |
| desired or active `sessions` | allowed | always refused; no override |
| production profile with `dev` | health only; app data refused | refused |

The sessions refusal is `SNAPBACK_AUTH_TRANSPORT_INSECURE` and occurs before the
listener binds. The request middleware repeats the refusal as defense in depth
for embedded/test composition. Staging sessions is enough to trigger it: a
pending deployment may not bind plaintext to a non-loopback interface and wait
for a restart to become dangerous.

The diagnostic is an operator/startup failure, not a client-authentication
failure. `/health` may remain available only in an already-composed embedded
router used for diagnostics; normal CLI startup binds no listener after the
pre-bind refusal.

**Limit.** `127.0.0.1` or `::1` behind a public reverse proxy still appears
loopback to Snapback. This fence proves only that Snapback itself did not bind
plaintext to a routable interface. It proves nothing about the proxy, its TLS
configuration, forwarding headers, public reachability, or alternate paths to
the backend.

### D2. External TLS and effective source

A hosted target MUST prove that the browser-to-public-edge leg is HTTPS and that
HTTP is redirected or refused before credentials are accepted. TLS termination
may live outside Snapback, but the target—not an operator convention—must own the
fact.

The target MUST derive one canonical effective source for security decisions:

1. Start with the immediate transport peer.
2. Consult `Forwarded`, `X-Forwarded-For`, or target-native connection metadata
   only when that immediate peer belongs to an explicitly configured trusted
   proxy set or arrives through a provider-authenticated binding.
3. Parse one documented header family with strict syntax, bounded hop count, and
   normalized IPv4/IPv6 representation. Conflicting or malformed sources fail
   closed; they do not fall back to caller text.
4. Walk the chain from the trusted edge toward the client, stopping at the first
   untrusted hop. Never select the leftmost string merely because a header
   contains one.
5. Use the resulting source consistently for rate limits, connection caps,
   audit correlation, and abuse diagnostics without publishing raw private
   addresses on public surfaces.

The local target currently derives `ctx.loopback` once from the bind address and
does not install peer-address extraction on requests. It therefore reports no
effective-source capability and MUST NOT claim per-source hosted throttling.

### D3. Shared authentication throttling

Hosted auth needs atomic, shared limits at least for challenge request,
challenge exchange, refresh, connection open, and repeated invalid-credential
attempts. Limits MUST combine dimensions so neither NAT concentration nor
identity spraying defeats the model:

- effective source;
- normalized provider subject or challenge destination where available;
- session family / user after credential resolution; and
- application/deployment identity.

The shared limiter MUST have bounded state, monotone retry windows, explicit
clock ownership, and one documented failure policy. A target may choose
fail-closed or a sharply bounded local emergency budget when the shared limiter
is unavailable; it may not silently become unlimited. Rejections use a typed
diagnostic and a bounded retry hint without confirming whether an account or
challenge exists.

Process-local grant caps, challenge caps, and provider cooldowns remain useful
defense in depth. They do not satisfy this requirement in a multi-replica
deployment.

### D4. Multi-replica session and authorization invalidation

Every replica that accepts session traffic MUST consume one authoritative,
monotone invalidation stream for:

- pending and committed session-family revocation;
- refresh rotation and supersession;
- expiry and logout;
- app reset, import, and declared restore;
- authorization-stream incarnation/version changes; and
- LLP 0053's persistent authorization obligations.

The target MUST reserve or recover stream positions durably, authenticate the
publisher, reject stale incarnations, make duplicate delivery idempotent, and
rebuild before declaring ready. A replica may not accept a credential or drain a
live payload while it knows its projection is behind the required position.
Partitions therefore degrade to refusal or bounded unavailability, never to a
replica-local authorization guess.

Session projection in one Rust process is not multi-replica invalidation. A
shared database without a wakeup/ordering protocol is also insufficient: it
would reintroduce per-operation durable reads or leave a stale-memory window.

### D5. Hosted readiness is conjunctive

A target's hosted-auth readiness is the conjunction of:

- `externalTls = enforced`;
- `effectiveSource = trusted`;
- `authenticationThrottle = sharedEnforced`; and
- `sessionInvalidation = multiReplicaConvergent`.

Unknown, advisory, operator-asserted, or target-inapplicable values are not
truthy aliases. Deployment tooling and the receiving target MUST both reject a
sessions deployment that asks for hosted posture while any fact is absent. The
target should use `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` for a missing hosted
capability and retain `SNAPBACK_AUTH_TRANSPORT_INSECURE` for the concrete local
plaintext-bind violation.

The current local target's hosted readiness is always false, including when its
listener is loopback and an operator happens to place a proxy in front of it.

## Client-page credential contract

### C1. The v1 custody claim

Browser auth v1 uses bearer credentials. The `AuthCoordinator` is the sole
custody authority and serializes cross-context replacement through Web Locks or
a transactionally fenced IndexedDB lease. Its durable record contains the
current bearer so a browser restart can resume the session. `localStorage` may
carry only a secret-free revision hint; it is neither a mutex nor credential
storage.

That architecture prevents stale-tab overwrites, late-A-clears-B races, and
accidental token exposure through ordinary client return values. It does **not**
prevent an active app-origin script from reading IndexedDB/page memory or using
the current credential. App-origin XSS therefore has the authority of the
logged-in user for the credential's remaining lifetime.

The short-lived `AdminSecretRead` browser lease is memory-only, named-table,
row/byte bounded, and not refreshable by itself. Active XSS can still steal or
exercise it during the remaining window. The root minting authority never
enters the browser; that bounds the loss without making the window zero.

The client MUST NOT place session bearers, refresh successors, login codes,
admin master credentials, `AdminSecretRead` leases, keyring material, or DPoP
private keys in logs, errors, URLs, wakeup payloads, analytics, generated
artifacts, or public diagnostics.

### C2. Defenses that do not change the boundary

Hosted applications SHOULD use a restrictive CSP, Trusted Types where
available, integrity-pinned/static dependencies, framework escaping, no unsafe
HTML sinks, and a separate operator surface when practical. Snapback should
provide deployment guidance and tests that make these controls observable.

These are prevention and blast-radius controls. No combination of headers turns
a JavaScript-readable bearer into an XSS-proof credential. The product must say
“app-origin XSS can act as the user,” not “tokens are safe because they are in
IndexedDB” or “CSP solves XSS.”

### C3. Sender-constrained v2

The v2 direction is sender-constrained credentials with a DPoP/RFC-9449-shaped
proof:

- one non-extractable browser keypair per custody installation;
- the public-key thumbprint bound into access and refresh-family state;
- a proof on every protected HTTP request and connection open, covering method,
  canonical target URI, issued-at time, unique proof id, and access-token hash;
- bounded proof replay storage and server nonce support where the target needs
  stronger freshness;
- rotation/recovery rules that treat loss of the private key as loss of the
  session family rather than silently falling back to bearer-only; and
- a closed protocol/capability version so old clients cannot downgrade a bound
  family.

The private key MUST be generated by the platform with `extractable: false` and
must never be serialized by Snapback. Native targets should use their equivalent
hardware/OS-backed key facility when available.

Sender constraint prevents a copied token from being replayed on another device
and narrows refresh-family takeover. It does not stop active same-origin code
from asking the live key to sign while compromised. Stronger active-XSS
isolation would require a separately trusted origin/process or a user-presence
boundary and is not claimed here.

Browser auth v1 remains supported for local development and explicitly
operator-accepted self-hosted deployments. Snapback MUST NOT advertise an
“XSS-resistant” or equivalent hosted-browser capability until v2 lands. A
hosted product may expose bearer v1 only as an explicit, named compatibility
posture whose UI and deployment facts state this residual; it is never the
secure default.

## Diagnostics and observability

- `SNAPBACK_AUTH_TRANSPORT_INSECURE`: concrete local plaintext/non-loopback
  violation. No session-mode override exists.
- `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`: the selected target lacks one or more
  conjunctive hosted-readiness facts.
- `SNAPBACK_AUTH_SOURCE_UNTRUSTED`: forwarding metadata is malformed,
  conflicting, or supplied by an untrusted peer.
- `SNAPBACK_AUTH_THROTTLED`: a shared or local limit refused the operation;
  response details do not confirm account existence.
- `SNAPBACK_AUTH_INVALIDATION_LAGGING`: the replica cannot prove its projection
  has reached the required stream position.
- `SNAPBACK_AUTH_SENDER_PROOF_REQUIRED`,
  `SNAPBACK_AUTH_SENDER_PROOF_INVALID`, and
  `SNAPBACK_AUTH_SENDER_PROOF_REPLAYED`: reserved for the v2 protocol; v1 code
  must not emit them as if sender constraint existed.

Public capability output may expose closed readiness states and protocol
versions. It must not expose source addresses, proxy secrets, limiter keys,
session identifiers, proof ids, token hashes, or invalidation authentication
material.

## Acceptance

### Current local target

- A resolved non-loopback bind with active **or desired** sessions fails before
  listener bind with exact code `SNAPBACK_AUTH_TRANSPORT_INSECURE`, regardless
  of the dev override or non-production profile.
- A non-loopback dev bind requires the explicit override and is still refused
  under the production profile.
- Loopback sessions remain possible, and tests/documentation state that this
  does not validate a reverse proxy or create hosted readiness.
- The request-level app-data fence repeats the non-loopback refusal for
  embedded/router composition; diagnostic health remains available.
- Diagnostic inventory and `ref-check` include the transport code and both
  enforcement references.

### Hosted target

- A target matrix proves every hosted-readiness fact is independently
  fail-closed and that only their conjunction enables sessions.
- Direct access to an origin cannot forge trusted forwarding metadata.
- Rate limits converge across at least two replicas and remain bounded during
  shared-limiter failure.
- Logout, rotation, expiry, reset/restore, and permission invalidation each
  fence a stale replica before it accepts or delivers session work.

### Browser custody

- A secret sentinel proves `localStorage`, wakeups, diagnostics, URLs, errors,
  and return values never contain bearer/admin material.
- The documented IndexedDB record is explicitly treated as JavaScript-readable
  bearer custody, not encrypted/XSS-safe storage.
- The future v2 conformance suite proves non-extractable key generation,
  method/URI/token binding, proof replay refusal, nonce handling, refresh-family
  binding, and fail-closed downgrade behavior.
- Security copy distinguishes off-device replay resistance from active-XSS
  resistance.

## Non-goals

- Claiming the local Rust target is a public hosting product.
- Treating TLS alone as trusted-proxy, throttling, or invalidation readiness.
- Encrypting browser storage with a key available to the same page and calling
  that XSS protection.
- Replacing the bearer protocol with cookies without a complete Origin/CSRF
  contract.
- Promising that DPoP stops malicious code executing in the live origin.
- Solving hostile-client offline retained-data access; LLP 0053 owns the honest
  lease bound and its limit.

## Open questions

- Which hosted target first implements the four deployment facts: the
  Cloudflare profile, a single-region reverse-proxy profile, or both?
- Is v2 custody isolated in a service worker/dedicated worker, or does the
  initial sender-constrained slice use origin IndexedDB with the narrower
  off-device-replay claim?
- What key-recovery UX is acceptable when a non-extractable key is lost?
- Does a hosted compatibility mode permit bearer v1 after an explicit operator
  acceptance, or should production tooling refuse it categorically?

## Status

**Draft.** ENG-24607 assigns ownership and implements the current local
plaintext fence, but it does not make the local target hosted-ready and does not
claim sender constraint before v2 exists. A hosted target must satisfy the
conjunctive acceptance matrix above; a future browser v2 must receive its own
wire/storage spec and review before activation.

## Changelog

- **2026-07-13 (ENG-24607):** initial owning contract. Assigned deployment edge
  security and client-page credential posture, pinned the no-override sessions
  plaintext fence and its reverse-proxy limit, made hosted readiness
  conjunctive, documented v1 bearer/XSS honesty, and chose sender-constrained
  credentials as the v2 direction without overstating active-XSS protection.
