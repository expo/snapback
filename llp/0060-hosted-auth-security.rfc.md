# LLP 0060: Hosted auth deployment and client-page security

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Security, Deployment, HTTP, Realtime, Client integration, Browser, Operations
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-07-15 (ENG-25000: detached and caller-described server
contexts now carry an unforgeable `Unknown` listener posture; only the
listener-owning serve path records the bound socket, and sessions app-data plus
`/auth/session` fail closed while posture is unknown; a real `0.0.0.0`
embedded-listener regression closes the reviewed bypass; review follow-up makes
the public network surface consume the serving listener and overwrite posture
previously derived from a different socket). 2026-07-14 (round-3 dual-family revision, /llp-super-refine:
withdrew D6's `_snapback_meta`-before-preflight carve-out that **contradicted
frozen LLP 0039** — preflight now precedes all DDL, split into startup and
per-invocation domains; removed D2's strict-transport prose escape hatch (HSTS
is a required component of `externalTls = enforced`); clarified the five static
enums attest `*Capable`, with D6 compatibility and C2 operator-origin isolation
as mandatory fail-closed **admission** inputs alongside deployment attestation
and live health; **bounded the D4 serving-lease state machine** (normative max
lifetime, skew, durable epoch, no-renewal-after-fence, admission, rollback),
reproduced LLP 0053's exact durability matrix, and flagged `multiReplicaConvergent`
as a companion rename; completed the acceptance surface. Round-3 triage in
§Status.) 2026-07-14 (round-2 dual-family revision, /llp-super-refine: D5
splits **target support profile / deployment-bound attestation / live health**
and renames the four-fact conjunction *deployment readiness* — `--auth-deployment
hosted` requires all five facts, matching the shipped gate, and hosted bearer-v1
compatibility becomes a **distinct named must-understand request** rather than an
open question; new **D6** owns the coordinator-to-handler mixed-version boundary
LLP 0058 delegates here (marker, preflight-before-effects, rollout/rollback
interleavings); D4 defines the **two conforming invalidation topologies**
(single serialized authority; replicated projections with pre-commit fencing and
expiring serving leases) with a conformance-grade completion bound; D3 pins the
**simultaneous bucket set** with atomic acquisition and unattributed-failure
charging; D2 requires refusal (never redirect) for credential-bearing plaintext,
strict transport as part of `externalTls`, and confidential mutually
authenticated edge-to-origin hops; D1 pins transport posture to the **actual
bound socket** and names the shipped detached/caller-supplied-loopback gap; C1
replaces universal custody assertions with a **carrier-by-carrier matrix**
(naming the intentional `localStorage` console record and the uncoordinated
headless seam) and pins the **opaque-failure rule for credential-issuing
endpoints** with the shipped 2xx-snippet and request-code-passthrough gaps named
as defect obligations; C2 hardens the operator-origin rule for hosted exposure;
C3 renames the v2 claim to off-device replay constraint — "XSS-resistant" is
permanently forbidden for DPoP alone — and requires nonce for the
pre-generated-proof claim.) 2026-07-14 (ENG-24996 review gate: archived the GPT-family review artifact at `reviews/0060-hosted-auth-security.codex.md` and applied its editorial corrections — D1 posture-matrix accuracy and the return-value sentinel scope; material findings remain for author triage). 2026-07-14 (ENG-24986: numeric response positions in kit/admin/setup projections compare known secrets in canonical string form, and the console-credential projection rejects the submitted master anywhere in the serialized record, including `expiresAtMs`). 2026-07-14 (hosted-future reconciliation: distinguish ENG-24607's implemented local refusal, capability-honesty, CSP, and credential-sentinel boundary from the still-unbuilt hosted edge facts and sender-constrained browser v2; retain Draft/unratified status). 2026-07-13 (ENG-24607 final review hardening: master-substring console-mint refusal and post-2xx logout body-read failure barrier); 2026-07-13 (ENG-24607 second review hardening: nonempty semantic-secret and property-name handling, request-and-successor credential exclusions, and exact empty-204 logout projection); 2026-07-13 (ENG-24607 review hardening: desired/active transport ordering, closed client success projections, operator-client/setup credential redaction, real-Chromium CSP/Trusted Types boot proof, and frozen-0039 restoration); 2026-07-13 (ENG-24607 enforcement: target-owned capability schema, must-understand hosted composition refusal, CSP/security headers, and client-secret sentinel); 2026-07-13 (initial contract for ENG-24607)
**Related:** LLP 0000, LLP 0009, LLP 0011, LLP 0012, LLP 0030, LLP 0031, LLP 0039, LLP 0040, LLP 0047, LLP 0053, LLP 0057, LLP 0058, LLP 0059

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
2. A target MUST NOT advertise hosted **deployment readiness** until it can
   attest all four edge facts in this RFC: end-to-end external transport
   confidentiality, trustworthy effective-source derivation, shared throttling,
   and convergent session invalidation — plus the mixed-version
   coordinator-to-handler boundary (D6). Secure hosted-browser auth
   (**hosted-auth readiness**) additionally requires the sender-constrained
   client posture; the two derived facts remain distinct so CSP cannot silently
   upgrade bearer v1.
3. Browser auth v1 remains bearer-first and honestly not XSS-resistant.
   Sender-constrained credentials are the v2 direction. They are required
   before Snapback advertises an **off-device-replay-hardened** hosted-browser
   posture — never an "XSS-hardened" one: their guarantee is that a copied
   credential cannot be replayed from another device, not immunity to an
   attacker executing inside the live page, and that naming rule is permanent
   rather than pending v2.

ENG-24607 implements the **local enforcement and claim-honesty boundary** for
those decisions: pre-bind plaintext refusal, a target-owned capability
descriptor, must-understand refusal of unsupported hosted composition,
Snapback-owned CSP/security headers, and credential non-exposure sentinels. It
does not implement end-to-end edge TLS attestation, trustworthy proxy-source
derivation, shared throttling, multi-replica invalidation convergence, a hosted
control plane, or sender-constrained browser credentials. No current target may
advertise those future facts.

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
- LLP 0059's session projection, two-phase revocation, and client clear barrier.

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
| non-production settled `dev` | allowed | refused unless the explicit non-production dev override is present |
| desired or active `sessions` | allowed | always refused; no override |
| production profile with `dev` | ordinary app data refused; diagnostic (`/`, `/health`), handshake (`/auth/session`), and provisioning (`/app/ensure`) routes remain subject to their own separate gates | refused |

The sessions refusal is `SNAPBACK_AUTH_TRANSPORT_INSECURE` and occurs before the
listener binds. The request middleware repeats the refusal as defense in depth
for embedded/test composition. Staging sessions is enough to trigger it: a
pending deployment may not bind plaintext to a non-loopback interface and wait
for a restart to become dangerous.

**The middleware's posture input is unforgeable as built (ENG-25000).** The
legacy `ServerContext` fields remain descriptive for admin/dev compatibility,
but they do not establish session transport authority. Detached and
caller-described contexts carry a private `Unknown` posture. The CLI records
the address returned by its actual listener before composing the router; an
embedded caller may instead construct from an already-bound listener. Active
or desired sessions on `Unknown` refuse app-data and `/auth/session`, while
`/health` remains diagnostic. The pinned rule: **transport posture derives
from the actual bound socket address, or from an unforgeable
listener-construction token minted by the code that bound the socket — never
from a caller-supplied boolean.** An unknown or detached posture **fails closed
for sessions** (refuse app-data and `/auth/session`; identity and diagnostics
may remain), and detached construction is a test-and-tooling seam that must
never carry a sessions network listener. A real `0.0.0.0` embedded-listener
regression serves the detached router and proves both protected paths refuse
with `SNAPBACK_AUTH_TRANSPORT_INSECURE` before bearer handling.

The public embedded network path is `server::app(state).bind(listener)`: it
consumes the Tokio listener, overwrites any posture already present in the
context from that exact socket, and returns a bound application whose listener
and router are private and inseparable. The unbound `SnapbackApp` remains a
direct `Service<Request>` for tests and in-process callers but intentionally is
not Axum's incoming-connection make-service. Thus the ordinary public API
cannot repeat the reviewed `axum::serve(other_listener, app(state))` mismatch.

The diagnostic is an operator/startup failure, not a client-authentication
failure. `/health` may remain available only in an already-composed embedded
router used for diagnostics; normal CLI startup binds no listener after the
pre-bind refusal.

The local CLI's must-understand declaration is `--auth-deployment
local|hosted`, defaulting to `local`. `hosted` is validated immediately after
the bind name resolves and before the database path is created, the database is
opened, restore/mode state is consumed, provider state is inspected, or a
listener is bound. Because the local target's target-authored capabilities do
not satisfy this contract, it fails with
`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`. The flag is a request, never an
operator assertion of TLS, proxy, limiter, invalidation, or browser facts.
Embedded composition carries the same requested deployment in `ServerContext`;
app-data and `/auth/session` refuse while `/` and `/health` remain available for
identity and diagnosis.

**Limit.** `127.0.0.1` or `::1` behind a public reverse proxy still appears
loopback to Snapback. This fence proves only that Snapback itself did not bind
plaintext to a routable interface. It proves nothing about the proxy, its TLS
configuration, forwarding headers, public reachability, or alternate paths to
the backend.

### D2. External TLS and effective source

A hosted target MUST prove that the browser-to-public-edge leg is HTTPS, and
`externalTls = enforced` covers the **whole credential path**, not one hop:

- **Credential-bearing plaintext is refused, never redirected.** A redirect
  answers a request whose bearer, login code, or secret-bearing body has
  already crossed the wire in the clear; the useful response is a refusal, and
  a target SHOULD treat a credential observed on plaintext as compromised
  (revoke or force-rotate its family). Redirects are permitted only for
  credential-free navigation.
- **Strict transport is part of the fact, with no prose escape.** HSTS — or a
  target-native equivalent that closes the first-visit/SSL-stripping window — is
  a **required component of `externalTls = enforced`**: a target that cannot
  attest it cannot attest `enforced`. There is deliberately no "exclusion
  recorded with a justification" hatch, because the fact is a two-value machine
  enum the readiness derivation reads and D5 forbids truthy aliases —
  a justification living in prose the derivation cannot see would let two
  targets both claim `enforced` while differing on the SSL-stripping window.
  Both derived facts are browser-facing (hosted-auth readiness by definition;
  the bearer-v1 compatibility request too), so there is no deployment where the
  exclusion is harmless.
- **Edge-to-origin hops are in scope.** The Summary says end-to-end and means
  it: every hop between the TLS-terminating edge and the origin process is
  either same-host loopback/Unix-socket transport or confidential **and
  mutually authenticated**. A plaintext LAN hop behind the edge is a failed
  fact, not an internal detail.

TLS termination may live outside Snapback, but the target—not an operator
convention—must own the fact.

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
attempts. "Combine dimensions" is an algorithm, not a mood: one composite key
such as `(source, subject, app)` still lets one source spray many subjects and
many sources converge on one subject. So **every attempt charges a set of
independent buckets simultaneously**, and the operation is admitted only when
every bucket in the set admits it, acquired atomically (no partial charge that
a concurrent attempt can slip past):

- the **app/deployment-global** bucket (the backstop that survives every
  attribution failure);
- the **per-effective-source** bucket;
- the **per-subject/destination** bucket (normalized provider subject or
  challenge destination), where one is present in the request;
- the **source × subject** bucket, so neither NAT concentration (many users,
  one source) nor identity spraying (one source, many subjects) borrows the
  other's headroom; and
- the **session-family/user** bucket, once a credential resolves.

**Unattributed failures still charge.** A malformed, unparseable, or
unresolved credential charges the per-source and global buckets — the attempts
least able to identify themselves are exactly the ones an attacker controls.
Bucket key cardinality is bounded (normalization caps per-source keys;
subject keys are hashed/normalized so the limiter is not a directory of
attempted identities), and normalization is privacy-preserving: bucket keys
never appear on public surfaces.

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
rebuild before declaring ready.

**"While it knows it is behind" is not a conforming bound** — a partitioned
replica that has heard nothing knows nothing, and an asynchronous post-commit
stream cannot, by itself, make refusal fail-closed. The
`sessionInvalidation = multiReplicaConvergent` fact attests a **guarantee, not
a topology**, and exactly two topology families conform:

1. **A single serialized authority.** All session acceptance and live-payload
   drains flow through one linearizable authority (LLP 0040's single Durable
   Object is this shape). Convergence is trivial; the fact is satisfied by the
   serialization itself, and calling this "not multi-replica" would punish the
   safer design.
2. **Replicated projections with pre-commit fencing and expiring serving
   leases.** A replica may accept credentials or drain payloads only inside an
   unexpired **serving lease** granted at a proven stream position by a single
   lease-issuing authority; a replica that cannot prove currency refuses with
   `SNAPBACK_AUTH_INVALIDATION_LAGGING`. The lease is a bounded, linearizable
   state machine, not an open-ended grant: it has a **normative maximum
   lifetime** (short — on the order of seconds, so "fence or wait out the lease"
   is a bounded delay, not an unbounded one), a stated **clock-skew allowance**,
   a **durable lease epoch** so a restart cannot resurrect an expired lease, a
   **no-renewal-after-fence** rule (a fenced replica cannot re-lease at the old
   position), and defined **new-replica admission** and **exact-owner rollback**
   on an ambiguous fence outcome. Revocation-class operations report complete
   only when every lease-holding replica is fenced **or its bounded lease has
   provably expired** — "every live replica" is enumerable precisely because
   leasing makes the live set the set of unexpired-lease holders, not an
   unbounded population a partition hides. The local implementation's safety
   comes from installing the pending fence before the provider transaction
   begins, and the distributed protocol must reproduce that ordering, not
   approximate it after commit.

The `sessionInvalidation` axis attests the **guarantee**, and the single-
authority topology satisfies it without being replicated — so the value
`multiReplicaConvergent` is a semantic misnomer for topology 1. This document
names the axis's *meaning* as **globally-fenced revocation** and flags the enum
label as a companion rename (either a topology-neutral positive value, or
distinct positive values for single-serialized-authority and replicated-fenced).

**LLP 0053's obligations are level-triggered state — but its durability matrix
is exact and must be reproduced, not paraphrased.** Accepted LLP 0053 makes
**client-query tombstones and authorization versions genuinely durable**, while
**subscription and connection projections are persistent only while continuity
exists and are deliberately *not* disk-durable** — process loss destroys them
and forces a fresh subscribe. So "durable level-triggered state" here means the
durable half (tombstones, versions, the fence high-water) survives loss,
duplication, and reordering because a replica converges to it; the
continuity-scoped projections do not, and a replica that loses them re-derives
by forcing resubscribe, never by serving stale. The stream is only the ordered
replication/wakeup transport. Partitions therefore degrade to refusal or bounded
unavailability, never to a replica-local authorization guess.

Session projection in one Rust process is not multi-replica invalidation. A
shared database without a wakeup/ordering protocol is also insufficient: it
would reintroduce per-operation durable reads or leave a stale-memory window.

### D5. Hosted readiness is conjunctive

Conjunctive — and layered: the derived facts are named exactly, and static
capability is only the first of three layers.

Two derived facts, named consistently everywhere in this document:
**deployment readiness** is the conjunction of the four deployment facts —

- `externalTls = enforced`;
- `effectiveSource = trusted`;
- `authenticationThrottle = sharedEnforced`; and
- `sessionInvalidation = multiReplicaConvergent`

— and **hosted-auth readiness** additionally requires
`clientCredentialPosture = senderConstrainedV2`: five facts, never four. The
must-understand request `--auth-deployment hosted` requires **hosted-auth
readiness (all five)**, exactly as the shipped gate implements. A future
hosted product that wants public bearer v1 as C3's explicit compatibility
posture does **not** get it by weakening `hosted`: it is a **distinct, named
must-understand deployment request** (a separate flag value, never the
default, never `hosted`) that requires deployment readiness (the four edge
facts), records an explicit operator acceptance artifact, and surfaces the
bearer-v1 residual in deployment facts and UI. The silent alternative — an
operator-managed public bearer deployment running under the default `local`
posture — is exactly what this section exists to make impossible to mistake
for a supported configuration.

Unknown, advisory, operator-asserted, or target-inapplicable values are not
truthy aliases. Deployment tooling and the receiving target MUST both reject a
sessions deployment that asks for hosted posture while any fact is absent. The
target should use `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` for a missing hosted
capability and retain `SNAPBACK_AUTH_TRANSPORT_INSECURE` for the concrete local
plaintext-bind violation.

The current local target's hosted readiness is always false, including when its
listener is loopback and an operator happens to place a proxy in front of it.

**Readiness is three layers, because most of these facts are not static.** TLS
routing, trusted-proxy configuration, limiter binding and health, and
invalidation catch-up are deployment or runtime facts; a committed manifest
cannot attest them, only what the target is *capable* of attesting. So:

1. **Target support profile** — the committed, immutable `hostedAuth`
   descriptor below: what mechanisms this target build *has*. This is the only
   layer that exists today.
2. **Deployment-bound attestation** — produced when a concrete deployment is
   configured, bound to the deployment identity and configuration hash, with a
   freshness epoch. Serving admission consumes this, not the static profile.
3. **Live health** — limiter reachability, invalidation currency, lease state.
   Loss of a required health fact withdraws serving (refusal or bounded
   unavailability), it does not merely log.

The machine-readable `hostedAuth` target descriptor uses five independent,
closed values:

```json
{
  "externalTls": "unavailable | enforced",
  "effectiveSource": "unavailable | trusted",
  "authenticationThrottle": "processLocal | sharedEnforced",
  "sessionInvalidation": "singleProcess | multiReplicaConvergent",
  "clientCredentialPosture": "bearerV1XssExposed | senderConstrainedV2"
}
```

It is target-authored in the capability manifest and has its own generated,
drift-gated schema. Candidate artifacts and operator config cannot supply or
override it. `deploymentReady` is derived from the first four exact positive
values; `hostedAuthReady` additionally requires
`clientCredentialPosture = senderConstrainedV2`. The executable matrix covers
all 32 combinations and fails closed for the 31 non-conjunctive cases. Public
diagnostics expose only the names of missing axes.

**The static descriptor attests `*Capable`, not `*Ready`; readiness has more
inputs than the five fields.** The five enum values describe mechanisms a target
build *has*; serving admission consumes the deployment-bound attestation and
live health (layers 2 and 3), plus **two mandatory gates the five fields do not
encode**: D6's mixed-version compatibility (a compatible handler/coordinator
pair, both preflight domains satisfied) and C2's operator-surface isolation (a
separately trusted operator origin, or `/_snapback/*` disabled on the app
origin). Both are **closed, fail-closed inputs to actual hosted admission** — a
build with all five capability enums positive but stale configuration, an
unhealthy limiter, an incompatible handler, or same-origin operator pages is
**not ready** and admission refuses. The naming follows: the static enums mean
`externalTlsCapable`/…, and `deploymentReady`/`hostedAuthReady` are the
admission-time conjunctions of capability **and** attestation **and** health
**and** the D6/operator-origin gates. Reconciling the shipped
`deployment_ready()`/`hosted_auth_ready()` names (which today read only the five
static enums) with this layered predicate is a named companion obligation.

Two honesty rules the descriptor still owes: **an absent `hostedAuth` field
deserializes to the all-unavailable, bearer-v1 local posture** (fail-closed —
already implemented, now stated), and a hosted-candidate target MUST publish
the descriptor explicitly rather than lean on the default. And the three
non-TLS axes lack a value for "this target has no auth surface at all":
`processLocal`, `singleProcess`, and `bearerV1XssExposed` assert mechanisms
that *exist*, which the dev-only Cloudflare target — advertising no auth
protocol — currently publishes anyway. Extending those axes with an explicit
`unavailable`/not-applicable value (a schema change with matrix coverage) is a
named companion obligation, so a no-auth target's descriptor stops implying
mechanisms it does not have.

### D6. Mixed-version coordinator-to-handler boundary

LLP 0039 requires a must-understand invocation marker so a sessions-aware
handler refuses an absent, unknown, or session-unaware coordinator before
executing anything, and LLP 0058 explicitly delegates the hosted form of that
marker — and its deployment interleavings — to this document. It is a
**positive prerequisite of deployment readiness**, not an implementation
detail:

- **The marker.** Every coordinator-to-handler invocation under sessions
  carries a versioned, must-understand auth-protocol marker naming the
  session-authority contract it was built against. A handler that does not
  understand the marker's version — or receives no marker — refuses the
  invocation, typed, before any application effect. Marker semantics compose
  with LLP 0058's per-request offer/echo handshake; this section owns the
  hosted deployment story, not a second handshake.
- **Preflight precedes effects — and D6 does not weaken frozen LLP 0039.** LLP
  0039 requires refusal **before any durable mutation**, names `_snapback_meta`
  explicitly, and moves the preflight ahead of its DDL so a refusal leaves the
  target byte-for-byte unchanged. This document does not reinterpret that, so
  there is **no "app-invisible metadata" carve-out**: the earlier round-2
  wording that blessed creating `_snapback_meta` before validating is withdrawn
  as a contradiction of frozen 0039. The distinction D6 actually needs is
  between **two preflight domains**, because they guard different effects: a
  **startup/deployment preflight** runs before the coordinator performs *any*
  DDL (the Cloudflare constructor's current constructor-time DDL must move
  behind it, per 0039), and a **per-invocation preflight** validates the marker
  before any handler app effect. A per-invocation marker cannot guard
  constructor effects; both domains exist, and both are prerequisites of
  deployment readiness.
- **Rollout order is pinned.** Activation is **handler-first**: handlers that
  understand the marker deploy before any coordinator emits it; a coordinator
  never emits a marker version some serving handler cannot understand.
  Rollback is **coordinator-first**, reversing the same edge. The acceptance
  matrix covers handler-first activation, coordinator-first rollback, delayed
  deployment (a coordinator meeting a handler several versions behind), and
  third-party stale-worker interleavings (a platform reviving an old handler
  instance mid-rollout must be refused by incarnation, not trusted by
  liveness).

The current Cloudflare target is dev-only and advertises no auth protocol;
nothing here retroactively blesses it. This section exists so the first real
hosted target has its transition contract before it needs one.

## Client-page credential contract

### C1. The v1 custody claim

Browser auth v1 uses bearer credentials. For coordinated browser clients the
`AuthCoordinator` is the custody authority and serializes cross-context
replacement through Web Locks or a transactionally fenced IndexedDB lease. Its
durable record contains the current bearer so a browser restart can resume the
session. For the **session family**, `localStorage` may carry only a
secret-free revision hint; it is neither a mutex nor credential storage.

The coordinator is not the only seam that can hold a bearer, and pretending
otherwise would be the kind of universal claim this document exists to refuse.
The kit's `SnapbackClient` accepts a directly supplied `bearerToken` and
performs an uncoordinated handshake when no coordinator is composed — a
**headless/test seam**, useful for servers and harnesses, that a browser page
can nonetheless reach. The pinned rule: **a browser client that observes
sessions mode uses coordinator custody**; the direct-bearer seam is for
non-browser composition, and hosted-browser capability claims never cover a
page that opts out of custody through it. Making the browser/headless split
structural (rather than a usage convention) is a named obligation.

That architecture prevents stale-tab overwrites, late-A-clears-B races, and
accidental token exposure through ordinary client return values. It does **not**
prevent an active app-origin script from reading IndexedDB/page memory or using
the current credential. App-origin XSS therefore has the authority of the
logged-in user for the credential's remaining lifetime.

The implemented ordinary `settledView()` contains authority, epoch/revision,
and refresh scheduling but no bearer. Auth exchange/refresh project only the
non-secret session result. The kit's deliberately narrow transport accessor
can still obtain the bearer to populate `Authorization`; v1 cannot both send a
bearer and pretend same-origin JavaScript is unable to exercise it. Client
transport errors defensively replace known request credentials/codes and
sensitive protocol fields before constructing an app-visible `Error`, even if
a broken receiver reflects them. Successful auth-session and credential
responses are also exact, closed, reconstructed projections: unknown root or
nested fields fail generically. Exchange excludes the submitted challenge id,
login code, and issued bearer from every string, numeric, and property-name
position in its public projection. Refresh applies the same exclusion to both
the predecessor and successor bearer before custody advances. Logout accepts
only exact empty HTTP 204, exposes fixed `null`, and never publishes arbitrary
successful JSON. Because a malformed 2xx may follow a committed server-side
revocation, the coordinator compare-clears only the captured authority before
returning a fixed credential-free protocol error. This includes a body-read
failure after the transport has already supplied a 2xx status: only status,
empty-body false, and read-failed true cross the transport boundary; the body
reader error and credential do not.

**Credential-issuing endpoints get a stricter failure rule than redaction can
deliver.** Request-scoped redaction can only replace secrets the client
already knows; a **newly issued** credential in a malformed 2xx body is
unknown until parsing succeeds, so a diagnostic that embeds any response bytes
can exfiltrate the successor no redaction set contains. The rule: on the
issuing paths — exchange, refresh, console mint, and challenge request — a
parse failure, body-read failure, or shape failure after a 2xx produces a
**fixed, opaque error carrying no response bytes and no reader-error
payload**; and every issuing success is an exact, closed projection
(challenge request returns exactly `{challengeId, expiresAt}`, never
passthrough JSON). The shipped clients do not fully meet this rule yet — the
kit and shared admin client both include a redacted body snippet in 2xx
parse-failure diagnostics before the successor is known, and the kit's
`authRequestCode()` returns successful JSON unprojected — and closing those
gaps, with poison tests for malformed 2xx text, reader failures, and unknown/
nested/property-name/numeric positions across all four paths, is a named
defect obligation of this contract.

The short-lived `AdminSecretRead` browser lease is memory-only, named-table,
row/byte bounded, and not refreshable by itself. Active XSS can still steal or
exercise it during the remaining window. The root minting authority never
enters the browser; that bounds the loss without making the window zero.

**The custody matrix.** Universal "never anywhere" assertions invite exactly
the contradictions a reviewer will find, so custody is a carrier-by-carrier
matrix: each credential class has its named permitted locations, and every
location not named is forbidden — logs, errors, URLs, wakeup payloads,
analytics, generated artifacts, and public diagnostics are forbidden for
**every** class.

| Credential class | Permitted locations (exhaustive) |
| --- | --- |
| Session bearer | Coordinator's transactional IndexedDB record; `Authorization` header via the narrow transport accessor; the headless direct-bearer seam (above) |
| Refresh successor | Coordinator custody, transiently during rotation; never returned, never persisted elsewhere |
| Login code / challenge id | The exchange request itself; nowhere at rest |
| Admin master credential | Operator input and the mint request; never persisted by any Snapback client |
| Derived `sbcc_` console credential | Admin-client memory **and its `localStorage` console record** — an intentional, named carrier (below), not an accident |
| `AdminSecretRead` lease | Admin-client memory only; never persisted |
| DPoP private key (v2) | Platform keystore as a non-extractable `CryptoKey`; never serialized |

The `sbcc_` `localStorage` row deserves its own honesty paragraph, because it
is the one carrier whose custody is weaker than the session family's: the
shared admin client persists the derived console record (credential plus
`expiresAtMs`) in origin `localStorage` so an operator page reload does not
re-prompt for the master. That record grants ordinary `AdminRead`/`AdminWrite`
for its remaining lifetime (about ten minutes), and **any script in that
origin can read it** — which is why the operator-origin rule in C2 is a hosted
requirement, not advice: if application pages and `/_snapback/*` operator
pages share an origin, an application XSS escalates from the logged-in user's
authority to administrative write authority for the window. Locally the
exposure is an operator's own machine; hosted, it is a boundary violation.

Snapback's shared admin client applies the same last-mile rule to its distinct
operator carriers. Master tokens, derived `sbcc_` console credentials,
memory-only `AdminSecretRead` leases, and submitted config values are collected
as request-scoped secrets at every nonzero length; a length floor is permitted
only for heuristic discovery, never for a known carrier. Transport exceptions,
structured diagnostics, non-JSON bodies, and successful reflected responses
are reconstructed with those values replaced before reaching UI code. Numeric
positions are not exempt in any of those projections (kit, shared admin, and
embedded setup alike): a response value that is a JSON number is compared
against every known secret in its canonical string form, so an all-numeric
master, bearer, lease, login code, or config value reflected as a number is
replaced exactly like its string twin. Error object property names are
sanitized too, while a successful object whose property name contains a known
secret is rejected generically rather than reinterpreted under a replacement
key. The credential exchange accepts only its exact two-field response and
consumes it internally. Before persistence it also rejects a candidate derived
record that would contain the submitted nonempty master anywhere in its
serialized keys or values — the `sbcc_` credential as an exact substring
(including unavoidable one-byte collisions with the fixed prefix), the numeric
`expiresAtMs` in canonical string form, and the serialized record bytes as a
whole — so no console record carrying its minting authority can reach
`localStorage`, a return value, or a thrown error. The Contract UI logs only
that safe scalar projection, and the embedded setup program executes the same
rule before writing DOM text or browser storage.

### C2. Defenses that do not change the boundary

Hosted applications SHOULD use a restrictive CSP, Trusted Types where
available, integrity-pinned/static dependencies, framework escaping, and no
unsafe HTML sinks. Snapback should provide deployment guidance and tests that
make these controls observable.

**Operator-origin separation is a hosted requirement, not a courtesy.** The
custody matrix (C1) shows why: the operator surface persists a derived
`sbcc_` credential readable by any same-origin script, so a shared origin
turns application XSS into administrative authority. A hosted exposure MUST
either serve `/_snapback/*` operator pages from a **separately trusted
origin** or keep them **disabled on the application origin**; hosted
administration stays disabled until its control-plane authorization contract
exists (this document deliberately does not design one). Locally, where the
operator and the application author are the same person on the same machine,
same-origin operator pages remain acceptable and the residual is theirs.

These are prevention and blast-radius controls. No combination of headers turns
a JavaScript-readable bearer into an XSS-proof credential. The product must say
“app-origin XSS can act as the user,” not “tokens are safe because they are in
IndexedDB” or “CSP solves XSS.”

Snapback-owned static operator pages now ship a concrete baseline: `default-src
'none'`, no objects or framing, same-origin scripts/connect/assets, an exact
SHA-256 admission for the one embedded setup script, and response-specific
exact hashes for the built Exact shell's inline manifest/bootstrap blocks. It
admits no `unsafe-eval`, enforces Trusted Types, and adds `nosniff`,
no-referrer, denied browser powers, and same-origin opener/resource policies.
A router test hashes each document's served inline bytes and compares them with
that response's CSP; shared middleware preserves the built shell's dynamic
policy instead of overwriting it with the setup fallback (the setup-script
hash is the fallback policy for any Snapback-owned static document that does
not install a response-specific one, not a per-document admission). Inline
styles remain admitted for the embedded setup page and React style props. This controls
Snapback's operator surface only; an application or hosting target still owns
the app document's CSP and dependencies, so these headers do not promote the
local target or bearer v1 to hosted readiness.

The embedded program also has an executable DOM/network regression using its
actual served source. A headless-Chrome acceptance launches the real server
against the production Contract build, captures `securitypolicyviolation`,
console errors, runtime exceptions, and unhandled page failures from both
operator documents, traverses each master-to-derived credential recovery path,
and requires the admin `Overview` surface and setup summary to render. It then
proves Trusted Types is actually enforced by requiring an intentional string
`innerHTML` assignment to fail with `TypeError` and the
`require-trusted-types-for` violation. The first runtime exercise found the
brand mark's otherwise-sanitized inline-SVG parser still crossed
`template.innerHTML`; the console now uses theme-specific static SVG image
assets so it boots without weakening Trusted Types through a default policy.

### C3. Sender-constrained v2

The v2 direction is sender-constrained credentials with a DPoP/RFC-9449-shaped
proof:

- one non-extractable browser keypair per custody installation;
- the public-key thumbprint bound into access and refresh-family state;
- a proof on every protected HTTP request and connection open, covering method,
  canonical target URI, issued-at time, unique proof id, and access-token hash;
- bounded proof replay storage, and **server nonce as a required part of the
  off-device claim**: RFC 9449 itself records that an XSS attacker can
  pre-generate future-dated proofs for off-device use and that server nonce is
  the mitigation, so a target either enforces nonce on the protected surfaces
  it claims replay resistance for, or narrows its claim to
  copied-token-without-proof-material explicitly;
- rotation/recovery rules that treat loss of the private key as loss of the
  session family rather than silently falling back to bearer-only; and
- a closed protocol/capability version so old clients cannot downgrade a bound
  family.

The private key MUST be generated by the platform with `extractable: false` and
must never be serialized by Snapback. (Non-extractable `CryptoKey` handles
survive structured clone into IndexedDB, so origin-IndexedDB custody and
non-extractability are compatible.) Native targets should use their equivalent
hardware/OS-backed key facility when available.

Sender constraint prevents a copied token from being replayed on another device
and narrows refresh-family takeover. It does not stop active same-origin code
from asking the live key to sign while compromised. The only same-device
boundary that changes the active-XSS story short of user presence is a
**separately origined signing broker** (a postMessage-brokered iframe or
worker on its own origin holding the key) — recorded here as the deferred
stronger-isolation option so v2 does not re-litigate it — and it is not
claimed.

Before any positive sender-constraint capability is emitted, v2 owes a
versioned wire/storage specification covering at minimum: issuance and refresh
proofs versus protected-resource proofs (including the `ath` access-token
hash), every protected credential class (session family, connection tokens,
console credentials, secret-read leases — or their explicit exclusion),
HTTP **and** WebSocket proof transport, canonical external URI reconstruction
behind proxy rewrites, admitted JOSE algorithms, time-window and nonce policy,
replay-store key dimensions and shared-store failure behavior, downgrade
refusal, and key persistence/deletion/recovery.

Browser auth v1 remains supported for local development and explicitly
operator-accepted self-hosted deployments. The claim name is pinned
permanently: sender constraint is a **copied-credential / off-device-replay
constraint**, and Snapback MUST NOT advertise an “XSS-resistant” or equivalent
hosted-browser capability for DPoP alone — not before v2 lands and not after.
A hosted product may expose bearer v1 only through D5's distinct named
compatibility request, whose UI and deployment facts state this residual; it
is never the secure default.

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
- The middleware's posture input is unforgeable: transport posture derives
  from the actual bound socket or a listener-construction token, a detached or
  unknown posture fails closed for sessions, and a **real non-loopback
  embedded-listener bypass test** proves a caller-supplied loopback flag
  cannot expose a sessions router (closes the shipped
  `ServerContext::detached()` / independent-`loopback` gap).
- Diagnostic inventory and `ref-check` include the transport code and both
  enforcement references.

### Hosted target

- The committed capability manifest and standalone generated schema carry the
  exact five-axis `hostedAuth` descriptor; unknown values and unknown fields
  are rejected.
- A target matrix proves every hosted-readiness fact is independently
  fail-closed, only the four deployment positives produce deployment readiness,
  and only those four plus sender constraint produce hosted-browser readiness.
- Direct access to an origin cannot forge trusted forwarding metadata.
- Plaintext requests carrying credentials are refused, never redirected; a
  WebSocket downgrade attempt, a direct-origin bypass of the edge, and an
  unauthenticated edge-to-origin hop each fail their fact.
- Rate limits converge across replicas and remain bounded during
  shared-limiter failure; the bucket set holds under source spray (one source,
  many subjects), identity spray (many sources, one subject), NAT
  concentration, and malformed/unattributable credentials (which still charge
  source and global buckets).
- Logout, rotation, expiry, reset/restore, and permission invalidation each
  fence a stale replica before it accepts or delivers session work —
  revocation-class operations do not report complete until every live replica
  is fenced or its serving lease has expired. The invalidation matrix covers
  partitions beginning before and after a mutation starts, commit-before-
  delivery, ambiguous outcomes, duplication, reordering, restart, rebuild,
  lease expiry, and payload-drain fencing; a single-serialized-authority
  target satisfies the same rows by construction and proves the serialization
  instead.
- The mixed-version matrix (D6) covers handler-first activation,
  coordinator-first rollback, delayed deployment, a marker-less coordinator
  against a sessions-aware handler (refused before any app effect), and a
  revived stale handler instance (refused by incarnation). Both preflight
  domains are proven: a startup/deployment preflight refuses **before any DDL**
  (the target left byte-for-byte unchanged, per frozen LLP 0039), and a
  per-invocation preflight refuses before any handler app effect.
- Readiness is proven to be capability **plus** attestation **plus** health
  **plus** the D6/operator-origin gates: a build with all five capability enums
  positive but stale/rebound configuration, an unhealthy limiter, an
  incompatible handler, or same-origin operator pages is refused hosted
  admission; and losing a required live-health fact **withdraws serving** (HTTP
  refusal and existing socket/drain) rather than only logging.
- The `externalTls = enforced` attestation is proven to require strict
  transport (no prose-exclusion hatch): a target that cannot attest HSTS/
  equivalent cannot attest `enforced`.
- The serving-lease state machine is proven bounded: a lease past its normative
  maximum never serves, a fenced replica cannot renew at the old position, a
  restart cannot resurrect an expired lease, and revocation completes only once
  every lease-holder is fenced or provably expired.
- Operator-surface isolation (C2) is proven for hosted exposure: `/_snapback/*`
  is served from a separately trusted origin or disabled on the application
  origin, so an application XSS cannot reach the derived `sbcc_` console
  credential.

### Browser custody

- Secret sentinels prove every carrier stays inside its C1 matrix row:
  `localStorage` never contains session-family, master, secret-read-lease, or
  submitted-config material (the derived `sbcc_` console record is the one
  named `localStorage` carrier, and its sentinel asserts the record contains
  no embedded master rather than pretending the record is not there); wakeups,
  diagnostics, URLs, errors, and auth-control/coordinator return values
  contain no credential of any class, with the narrow transport accessor and
  the headless direct-bearer seam named as the intentional exceptions.
  Arbitrary application payloads are not a credential-redaction
  boundary: an app that deliberately echoes a bearer as ordinary result data is
  out of this sentinel's scope and is covered by the client-page XSS contract.
- One-, two-, and three-byte master/config sentinels prove known semantic
  carriers have no redaction floor. Poisoned diagnostic and successful-response
  property names prove keys cannot retain those values.
- Credential-success poison cases cover exchange request proof and successor,
  refresh predecessor and successor, and logout body reflection. Exact empty
  204 alone returns `null`; malformed 2xx logout clears only current captured
  custody and then returns a generic credential-free error.
- Issuing-path opaque-failure cases (currently failing; the named defect
  obligation in C1): a malformed 2xx on exchange, refresh, console mint, and
  challenge request produces a fixed error with **no response bytes and no
  reader-error payload** — proven with a poisoned body containing a
  freshly-issued credential the client could not know — and challenge-request
  success is the exact `{challengeId, expiresAt}` projection, never
  passthrough JSON.
- Console-mint poison cases cover a longer master embedded after `sbcc_` and a
  one-byte master colliding with the fixed prefix; neither candidate reaches
  storage. A known-2xx logout whose body reader rejects with credential-bearing
  state follows the same captured-authority clear and generic-error path, while
  a peer-installed successor remains untouched.
- Ordinary coordinator views contain no bearer. The acceptance test names the
  transactional custody record and authorization header as the intentional v1
  carriers instead of hiding them from the assertion.
- Snapback-owned static pages carry the restrictive CSP/security-header
  baseline, and every inline setup/Exact-shell hash is derived from the exact
  bytes of its own response.
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

- Which hosted target first implements the four deployment facts, and via
  which conforming D4 topology: a single serialized authority (the LLP 0040
  Durable Object shape), a single-region reverse-proxy profile with
  lease-based replicas, or both?
- Is v2 custody isolated in a service worker/dedicated worker, or does the
  initial sender-constrained slice use origin IndexedDB with the narrower
  off-device-replay claim? (A separately origined signing broker is the
  recorded stronger option, deliberately deferred — C3.)
- What key-recovery UX is acceptable when a non-extractable key is lost?
- What is the exact shape of the operator-acceptance artifact behind D5's
  named bearer-v1 compatibility request — a signed deployment-config fact, a
  console acknowledgement, or both? (Whether such a posture exists at all is
  now pinned: it does, as a distinct request; it is never `hosted` and never
  the default.)

## Status

**Draft.** ENG-24607 assigns ownership and implements only the current local
enforcement/claim-honesty boundary: the plaintext fence, target-owned capability
descriptor, must-understand hosted-composition refusal, Snapback-owned CSP
baseline, and credential non-exposure sentinel. It does not make the local
target hosted-ready and does not claim sender constraint before v2 exists.
There is no hosted auth deployment in this implementation. A future hosted
target must implement and prove every conjunctive edge fact above; a future
browser v2 must receive its own wire/storage spec and review before activation.

The review evidence includes exact live-server hash admission for both operator
documents, execution of the embedded setup program, a successful production
admin build, and a clean Chrome 150 run of both complete credential-recovery
boot paths with zero unintentional policy violations, console errors, or
runtime exceptions. The intentional sink probe confirms the browser enforces
Trusted Types rather than merely receiving the header.

That evidence validates the implemented local boundary only. It is not evidence
for public-edge TLS/source derivation, shared throttle state, replica
convergence, or sender-constrained custody, and it does not ratify this RFC on
the author's behalf.

The ENG-24996 review gate obtained a cross-family GPT (Codex) review of this
document on 2026-07-14; its verbatim report and provenance are archived in
`reviews/0060-hosted-auth-security.codex.md` (round 1, verdict: NOT READY —
nine material implemented-boundary and hosted/future-contract findings). A
**round 3 (the latest) corrected the D6-vs-frozen-0039 contradiction** (the
`_snapback_meta`-before-preflight carve-out is withdrawn; preflight precedes all
DDL, split into startup and per-invocation domains), removed D2's strict-
transport prose escape hatch, clarified that the five static enums attest
`*Capable` not `*Ready` with D6/operator-origin as mandatory admission inputs,
bounded the D4 serving-lease state machine and reproduced LLP 0053's exact
durability matrix (projections are continuity-scoped, not disk-durable), flagged
`multiReplicaConvergent` as a companion rename, and completed the acceptance
surface. Remaining protocol-grade items (the marker schema owner/wire form, the
lease constants, the machine-readable attestation/health authorities) are named
implementation-altitude obligations, since this RFC does not design the control
plane and its altitude is not yet author-ratified.

Two further dual-family rounds (fresh Codex and fresh Fable, blind, via
/llp-super-refine) reviewed the committed revision at `b11a6fa`;
all artifacts are archived with provenance in
`reviews/0060-hosted-auth-security.{codex,fable}.md`. **The round-2 revision
was the author-side triage of the first two rounds**: every material finding is
either resolved in the text (D1 unforgeable posture, D2 refusal/strict-
transport/edge-to-origin, D3 bucket algorithm, D4 conforming topologies, D5
naming/layers/compat request, new D6 mixed-version boundary, C1 custody
matrix and issuing-path rule, C2 operator-origin requirement, C3 claim
renaming and protocol inventory) or recorded as a named defect obligation
with acceptance rows (the now-closed detached-loopback bypass; the issuing-path 2xx
snippet and request-code passthrough; the descriptor's missing not-applicable
values; the structural browser/headless custody split). Dispositions live in
the review ledger alongside the verbatim reviews. The review advises — it
does not ratify, and this document remains Draft pending author ratification.

## Changelog

- **2026-07-15 (ENG-25000):** separated listener-owned transport posture from
  descriptive `host`/`loopback` fields, made unknown posture fail closed for
  active or desired sessions, recorded concrete addresses only from bound
  listeners, migrated external fixtures off struct-literal posture forgery,
  and added a real non-loopback detached-router bypass regression.
- **2026-07-13 (ENG-24607 final review hardening):** made both real operator
  credential exchanges reject an exact derived record whose credential embeds
  its submitted master, including a one-byte `sbcc_` prefix collision, before
  any persistence; split response acquisition from body reading so a known-2xx
  logout read failure carries only opaque success facts into compare-clear;
  and added exact collision, reflected-reader, current-clear, and stale-peer
  preservation replays.
- **2026-07-13 (ENG-24607 second review hardening):** removed the four-byte
  floor from known admin, config, bearer, and challenge carriers while retaining
  collision-safe redaction markers; sanitized diagnostic property names and
  generically rejected secret-bearing property names in successful operator
  responses; excluded exchange challenge/code/successor and refresh
  predecessor/successor values from all public credential projection positions;
  made logout accept only exact empty 204 and return fixed `null`, with captured
  custody safely cleared before a generic malformed-success error; and added
  short-secret, property-key, numeric-code, predecessor/successor, and reflected
  logout regression cases.
- **2026-07-13 (ENG-24607 review hardening):** moved the desired-or-active
  sessions plaintext refusal ahead of bearer resolution on embedded routing;
  made auth-session and credential successes exact reconstructed projections
  with poisoned-200 sentinels; applied master/derived/secret-read/config-value
  redaction to the shared admin client, Contract UI, and embedded setup page;
  discovered and closed the built Exact shell's two-inline-block CSP admission
  gap with per-response hashes preserved through shared route middleware; ran
  the real Chrome boot paths, replaced the TT-incompatible inline-SVG brand
  sink with static theme assets, and proved enforcement with an intentional
  rejected sink while keeping both ordinary boots violation-free;
  restored frozen LLP 0039 byte-for-byte to its pre-ENG-24607 state; and
  added the browser acceptance as a repeatable admin-ui script.
- **2026-07-13 (ENG-24607 enforcement):** added the generated five-axis target
  capability descriptor and exact 32-case matrix; made `--auth-deployment
  hosted` fail before target creation and repeat in embedded routing; removed
  bearer material from ordinary coordinator views; added defensive client
  diagnostic redaction and a bearer/admin sentinel across hints, wakeups,
  URLs, errors, and auth return values; and installed a hash-pinned CSP plus
  browser security headers on Snapback-owned static pages.
- **2026-07-13 (ENG-24607):** initial owning contract. Assigned deployment edge
  security and client-page credential posture, pinned the no-override sessions
  plaintext fence and its reverse-proxy limit, made hosted readiness
  conjunctive, documented v1 bearer/XSS honesty, and chose sender-constrained
  credentials as the v2 direction without overstating active-XSS protection.
