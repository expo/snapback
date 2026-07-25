# LLP 0098: The hosted-edge adapter and the loopback-terminated profile

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Security, Deployment, Control plane, HTTP, TLS, Realtime, Operations, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-25
**Revised:** 2026-07-25 (initial contract: the first concrete adapter that
owns LLP 0060's hosted-edge attestation)
**Related:** LLP 0009, LLP 0012, LLP 0031, LLP 0039, LLP 0051, LLP 0053,
LLP 0057, LLP 0058, LLP 0059, LLP 0060, LLP 0072, LLP 0074, LLP 0075,
LLP 0077, LLP 0096

## Summary

Accepted [LLP 0060](./0060-hosted-auth-security.rfc.md) defines what a hosted
Snapback deployment must attest before `--auth-deployment hosted` may serve. It
deliberately designs no control plane, so every one of its facts has been
unowned since it was accepted: `HostedAdmission`, `HostedServingAuthority`, the
shared authentication throttle, and the whole LLP 0077 sender-constrained
admission path are implemented and tested but **structurally unreachable** —
`AppState.hosted_serving` is always `None`, its installer is `#[allow(dead_code)]`,
and `validate_auth_deployment` refuses `hosted` unconditionally without ever
consulting a capability. The 2026-07-25 Fly.io drill witnessed exactly that:
`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`, recorded as a refusal, never a claim
(`demos/competitive-checkpoint/acceptance/results/hosted-auth-refusal.v0.json`).

This Spec pins the first concrete adapter: the **`loopback-terminated-single-instance.v1`
hosted-edge profile**. It owns three things LLP 0060 named and left to a target:

1. **A topology that makes the edge facts checkable rather than promised**
   (§1). The origin process binds **loopback only**; the public TLS leg is
   terminated inside the deployment's own network namespace and forwarded over
   loopback. LLP 0060 D2's "every hop between the TLS-terminating edge and the
   origin process is either same-host loopback/Unix-socket transport or
   confidential and mutually authenticated" is then satisfied *by construction*,
   and the direct-origin bypass D2 fences is not merely improbable but
   unreachable — nothing outside the namespace can address the origin socket.
2. **An admission production and verification contract** (§2–§3): how a
   control-plane key bound into the immutable release authenticates a
   `HostedAdmission`, exactly which facts the origin re-derives rather than
   believes, and how a stale, replayed, foreign, or rolled-back snapshot is
   refused.
3. **The admission seam and its live-health withdrawal** (§4–§5): where the
   verified authority is installed, what each request re-checks, and how loss of
   a required health fact withdraws serving instead of logging.

**The central claim boundary, stated first.** This adapter binds the control
plane's assertions to a deployment identity, a configuration digest, and a
monotone epoch. It does **not** make the control plane honest. An operator who
signs false facts with the release's own control-plane key serves under false
facts; that residual is inherent to a single-tenant profile whose operator owns
the deployment, and §7 states it rather than hiding it behind the word
"attestation".

**This Spec ships no positive capability claim.** `hostedAuthCapable` remains
unclaimed until §8's matrix passes against a real served origin under a real
attestation, exactly as LLP 0077's program index requires.

## Scope

This Spec owns the adapter: topology requirements, attestation production and
verification, the admission seam, health withdrawal, effective-source
derivation for this topology, and the negative-test ledger that gates the
capability claim.

It consumes without re-owning:

- LLP 0060's five-axis descriptor, closed `HostedAdmission` shape, D1 fence, D2
  transport/source rules, D3 throttle algorithm, D4 invalidation guarantee, D5
  conjunction, D6 handler boundary, and C1/C2/C3 browser contract. Where this
  Spec is stricter, it says so; it never relaxes.
- LLP 0077's sender-constrained protocol, its 13-item ledger, and its author
  decisions.
- LLP 0072's control-plane object model, adapter contract, and drill corpus.
- LLP 0096 §7's hosted-production mandatory-profile floor.

It does **not** design a multi-tenant hosting product, a horizontally scaled
topology, a certificate provisioner, or the release/rollback control plane LLP
0072 sketches. It defines the smallest complete thing that can honestly serve
`--auth-deployment hosted`.

## 1. The topology: why loopback termination is the contract, not a detail

### 1.1 The requirement

A conforming `loopback-terminated-single-instance.v1` deployment is:

- **One** Snapback origin process, holding the single durable authority for the
  application, bound to a **loopback address only** (`127.0.0.1` or `::1`).
- A **TLS terminator in the same network namespace** that owns the public
  hostname, terminates the public HTTPS leg with a certificate the deployment's
  client population trusts, and forwards to the origin over loopback.
- **No other route to the origin socket.** Every hop from the terminator to the
  origin is loopback within one namespace; no address outside the namespace
  routes to the origin's port.

### 1.2 Why this, and not "plaintext behind a trusted platform edge"

The tempting alternative — let the platform edge terminate TLS and let the
origin bind `0.0.0.0` behind it — is what the 2026-07-25 drill actually ran,
and it fails LLP 0060 D2 on a specific, checkable point rather than on a
technicality. On a platform whose edge reaches the origin over a shared private
network (the Fly.io 6PN case the drill used), **any other workload in the same
private network can address the origin's port directly**, without traversing
the edge. That peer then supplies its own forwarding headers. The consequence is
not theoretical: it converts D2's "trustworthy effective-source derivation" into
a header any co-resident peer can write, and it converts the edge's TLS into a
property of the *usual* path rather than of *every* path.

Admitting that topology would require a new trust assumption — "no hostile
workload shares this private network" — that neither Snapback nor the operator
can verify from inside the deployment, and that no code can fail closed on.
LLP 0060 D2 offers exactly two ways to satisfy the edge-to-origin hop, and
"probably nobody else is on the network" is not one of them.

Loopback termination takes the other door. The origin's bind is loopback, so:

- **LLP 0060 D1 is satisfied by its ordinary rule.** No fence is weakened, no
  sessions override is invented, and `validate_plaintext_auth_transport` keeps
  its exact shipped behavior. A hosted deployment is *not* an exemption from the
  plaintext fence; it is a deployment that never needed one.
- **The bypass class is empty by construction.** There is no address a peer
  could use, so there is no forged-forwarding-header attack to fence, and the
  trusted proxy set (§6) is the one loopback peer.
- **D2's edge-to-origin clause is met literally** — "same-host loopback
  transport" — rather than by arguing about a private network's properties.

This is the conservative choice. It costs the adapter a TLS terminator inside
the deployment and rules out platforms that will only terminate TLS at a shared
edge; §7 records that cost honestly instead of paying it with a trust
assumption.

### 1.3 The origin enforces its own half

The origin cannot see the terminator, so it does not claim to. It enforces the
half it *can* observe, and refuses hosted serving otherwise:

**H1 (new, strictly stronger than D1).** A hosted deployment whose listener
posture is anything other than `Loopback` refuses. `Unknown` refuses,
`NonLoopback` refuses. The posture derives from the actual bound socket or the
listener-construction token exactly as ENG-25000 established; a caller-supplied
value can no more authorize hosted serving than it can authorize sessions.

The diagnostic is `SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID`, raised before the
listener serves traffic and repeated in the request path for embedded
composition.

H1 is what makes the rest of this document honest. Everything the attestation
asserts about the public leg is an assertion about a component the origin
cannot inspect; H1 is the one structural fact the origin proves for itself, and
it is the fact that makes the assertion's failure mode bounded — a false
`externalTls` attestation on a loopback-bound origin exposes the traffic
between terminator and client, and nothing that reaches the origin socket
arrived from an unauthenticated peer.

### 1.4 First-contact strict transport

LLP 0060 D2 requires predelivered first-contact protection with no prose escape
hatch. The adapter's attestation names which of D2's three mechanisms the
deployment uses, as a closed enum carried in the attestation and bound into
`configurationSha256`:

```
firstContactTransport: "hstsPreloadedHost" | "hstsPreloadedSuffix" | "installTimeHttpsOnlyBinding"
```

- `hstsPreloadedHost` — the exact public hostname is in the browser preload
  list.
- `hstsPreloadedSuffix` — a parent suffix covering the hostname is preloaded
  with `include_subdomains`, so the hostname is HTTPS-only before first contact
  (the `.dev` TLD's blanket preload is the motivating case, and it is a genuine
  predelivered mechanism, not a dynamically learned policy).
- `installTimeHttpsOnlyBinding` — a non-browser client population whose
  transport is pinned at install time. A deployment attesting this value
  **may not** claim a browser-facing posture; §7 records the narrowing.

There is no fourth value and no `unknown`. A deployment that cannot name one of
these cannot attest `externalTls = enforced`, per D2.

## 2. Producing an admission: the control-plane contract

### 2.1 The key and where its halves live

The control plane holds an **Ed25519 admission signing key**. Its private half
never enters the deployment — not as a file, not as an environment variable, not
as a platform secret. Its public half is **bound into the immutable release
artifact** and is therefore covered by the release digest chain LLP 0072
defines. For a container/VM adapter, the image bytes are the
provider-authenticated binding LLP 0060 D5 asks for: the provider guarantees
which image the deployment runs, the image determines the verification key, and
the deployment cannot substitute a key without becoming a different release.

This is the whole of the answer to D5's "No operator-supplied JSON, environment
variable, or app artifact can mint this object". The snapshot travels as data;
its authority comes from a signature verifiable only against a key the release
fixes.

### 2.2 The signed envelope

```json
{
  "profile": "loopback-terminated-single-instance.v1",
  "admission": { ...the exact LLP 0060 HostedAdmission object... },
  "firstContactTransport": "hstsPreloadedSuffix",
  "publicOrigin": "https://example.fly.dev",
  "signature": "base64url(Ed25519 over the canonical signing input)"
}
```

The canonical signing input is the domain-separated concatenation

```
"snapback.hosted-admission.v1" ‖ LP(profile) ‖ LP(publicOrigin)
  ‖ LP(firstContactTransport) ‖ LP(canonical_json(admission))
```

where `LP(x)` is the 8-byte big-endian byte length of `x` followed by `x`, and
`canonical_json` is the schema-governed serialization of `HostedAdmission` with
members in declaration order. Length prefixing is not decoration: without it a
signature over a concatenation of attacker-influenced strings admits the
ordinary boundary-shifting forgery, and `publicOrigin` is exactly the kind of
field an adversarial control plane would try to shift into.

The envelope has its own generated, drift-gated schema
(`auth.hosted-admission-envelope.schema.json`) registered under LLP 0051 D4's
inventory, with `deny_unknown_fields` at every level.

### 2.3 What the control plane must bind

The control plane computes and signs, per snapshot:

- `deploymentId` — the exact never-reused deployment identity (LLP 0072).
- `configurationSha256` — a digest over the **effective serving configuration**:
  the profile id, public origin, first-contact mechanism, bind address family,
  throttle configuration, operator-surface disposition, and the admission
  public key itself. The key is inside its own configuration digest so a key
  rotation is a configuration change, not a silent substitution.
- `supportSha256` — a digest over the served support artifact set, including the
  browser artifact whose direct-bearer seam exclusion the admission asserts
  (LLP 0060 C1's positive prerequisite).
- `admissionEpoch` — monotone, advanced on every configuration, routing,
  rollout, or health-relevant change.
- `senderReplayEpochFloor` — the LLP 0077 decision-1 anti-rollback floor,
  stored by the control plane **outside** the deployment's durable set and only
  ever advanced.
- `issuedAtMs` / `expiresAtMs` — lifetime at most five minutes, per D5.

### 2.4 Renewal, and the honest cost of pre-signing

A five-minute maximum lifetime means a serving deployment consumes a stream of
snapshots. Two delivery modes are admissible, and they have different withdrawal
properties, so the attestation records which one is in force:

- `renewal: "online"` — the control plane is reachable and delivers each
  successor before its predecessor expires. Withdrawal latency is bounded by the
  remaining lifetime of the current snapshot (≤5 minutes): the control plane
  simply stops signing.
- `renewal: "presignedWindow"` — the control plane pre-signs a bounded chain of
  consecutive snapshots covering a declared window, delivered once. This is
  admissible for a drill or a maintenance window, and its cost is exact: **the
  control plane cannot withdraw inside the window.** Health withdrawal (§5)
  still applies, because that is evaluated by the origin, but attestation
  withdrawal does not.

A `presignedWindow` deployment MUST record the window bound in its receipt and
MUST NOT be described as having control-plane withdrawal. The window is capped
at 24 hours.

### 2.5 Delivery is not an app-origin route

Snapshots are installed through a **loopback-only admission socket** owned by
the origin process, distinct from the application listener and never routed on
the public origin. `/_snapback/*` remains `disabled` on the application origin
exactly as LLP 0060 C2 and the first hosted profile require; the admission
socket is not an operator surface and exposes no read, inspection, or
administration verb — its only operation is "install this signed envelope",
and its only responses are a coded accept or a coded refusal.

An unsigned, foreign, expired, or non-monotone envelope is refused there, and
the refusal never reveals the expected digests (§3.3).

## 3. Verifying an admission: what the origin re-derives rather than believes

Verification is a conjunction. Every clause fails closed with its own code, and
no clause is skippable by configuration.

### 3.1 The ordered checks

1. **Envelope shape** — closed schema, `deny_unknown_fields`, known profile id.
   Failure: `SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID`.
2. **Signature** — Ed25519 over §2.2's canonical input, against the
   release-bound public key. Verified **before** any field is interpreted, so a
   malformed-but-unsigned envelope cannot steer later checks. Failure:
   `SNAPBACK_AUTH_HOSTED_ADMISSION_UNAUTHENTICATED`.
3. **Closed facts** — the existing `HostedAdmission::closed_admission_facts_hold()`
   conjunction: version, digest syntax, positive epochs under
   `Number.MAX_SAFE_INTEGER`, lifetime ≤5 minutes, throttle config validity,
   `operatorSurface == disabled`, `browserDirectBearerSeam == excluded`, and
   `hostedAuth.hosted_auth_capable()`. Failure:
   `SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID`.
4. **Identity binding** — `deploymentId` equals the origin's own configured
   deployment identity. A snapshot signed for another deployment of the same
   release is refused. Failure:
   `SNAPBACK_AUTH_HOSTED_ADMISSION_FOREIGN`.
5. **Configuration binding** — `configurationSha256` equals the digest the
   origin computes over its own effective configuration (§2.3). This is the
   clause that makes a stale snapshot after a configuration change refuse rather
   than serve. Failure: `SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_CONFIGURATION`.
6. **Support binding** — `supportSha256` equals the digest over the artifact set
   the origin actually serves. Failure:
   `SNAPBACK_AUTH_HOSTED_ADMISSION_STALE_SUPPORT`.
7. **Topology (H1)** — the origin's listener posture is `Loopback`. Failure:
   `SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID`.
8. **Origin canonicality** — `publicOrigin` is `https`, lowercase host, no
   userinfo, no query, path `/`, no explicit `:443`, and round-trips exactly.
   This is the shipped `HostedServingAuthority::from_authenticated_target`
   check, retained. Failure: `SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID`.
9. **Monotonicity** — `admissionEpoch` is greater than or equal to the highest
   epoch this deployment has ever installed, and `senderReplayEpochFloor` never
   decreases. Both high-water marks are durable and survive restart. A replayed
   older snapshot inside its own validity window is refused. Failure:
   `SNAPBACK_AUTH_HOSTED_ADMISSION_ROLLED_BACK`.
10. **Currency** — `issuedAtMs ≤ now ≤ expiresAtMs` at install and at every
    subsequent use. At install the failure is
    `SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID` (the envelope was never admissible
    here); once installed, lapsing during serving is
    `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED`. The two codes stay distinct so an
    operator log distinguishes "the control plane sent a dead snapshot" from
    "the control plane stopped renewing".

Only after all ten does the authority install, and installation performs the
existing side effects in order: create the sender-proof replay/nonce tables,
create the shared throttle table, and apply the sender-replay-epoch floor as
`max(durable, floor)` with its atomic clear (LLP 0077 decision 1).

### 3.2 What verification deliberately does not prove

Naming these is the point of the section:

- It does not prove the terminator holds a valid certificate, or any
  certificate.
- It does not prove the public hostname resolves to this deployment.
- It does not prove the first-contact mechanism is really in force.
- It does not prove the control plane's assertions are true — only that they
  are the control plane's, bound to this deployment and this configuration.

The origin proves H1 and the digest bindings. Everything else is an
authenticated assertion, and §8's drill is what turns the assertions into
observed facts for one concrete deployment.

### 3.3 Refusal opacity

Admission refusals are operator/control-plane state, not client-facing
authentication outcomes. They are logged with their code and refused at the
admission socket. **No refusal reveals an expected digest, epoch high-water
mark, deployment identity, or key.** A control plane that supplied the wrong
`configurationSha256` learns that it was wrong, never what the right value was —
otherwise the socket becomes an oracle that hands an attacker the exact
configuration digest to forge against, and the digest is the one field a
compromised-but-unprivileged co-process would most want.

## 4. The admission seam

### 4.1 Composition

`validate_auth_deployment` changes from an unconditional refusal to a
conjunction, and this is the only line in the codebase whose behavior change
admits hosted serving:

- `AuthDeploymentTarget::Local` — unchanged, always admitted.
- `AuthDeploymentTarget::Hosted` — admitted **only** when the startup composition
  supplies a verified `HostedServingAuthority` per §3. Absent one, the shipped
  `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` refusal with its exact closed blocker
  list is retained, unchanged, including the five unconditional blockers
  (`deploymentAttestation`, `liveHealth`, `handlerCompatibility`,
  `browserDirectBearerSeam`, `operatorSurface`) whose presence is now genuinely
  conditional on the verified snapshot rather than permanent.

The capability tuple a hosted deployment publishes is the one **inside the
verified admission** (`admission.hostedAuth`), never a build constant. A local
target keeps `HostedAuthCapabilities::local_target()` — all-negative — so an
ordinary `snapback dev` server never advertises `externalTls: enforced` in its
public manifest. This is the design's answer to the obvious overclaim: the
descriptor is a property of a *verified deployment*, not of a binary anyone can
download.

### 4.2 The blocker list stays closed

`deployment_unsupported()` keeps exposing only closed axis names. The blocker
list gains no new member from this Spec: `SNAPBACK_AUTH_HOSTED_TOPOLOGY_INVALID`
and the admission codes are distinct diagnostics on the admission path, not
public capability blockers, because a public blocker naming "topology" would
tell an unauthenticated client how the deployment is wired.

### 4.3 Ordering

The hosted composition runs **before the listener binds** and after the bind
address resolves, so H1 has a real posture to check and no socket ever serves
under an unverified authority. The order at startup is: resolve bind address →
verify admission envelope → check H1 against the resolved address → open target
state → install authority (with its table creation and epoch floor) → bind →
serve.

## 5. Live health and withdrawal

LLP 0060 D5 layer 3 requires that loss of a required health fact **withdraw
serving**, not merely log. The origin evaluates three facts:

- **Admission currency** — a current, unexpired snapshot exists.
- **Limiter reachability** — the shared throttle table is present and a probe
  transaction succeeds. The shipped limiter already fails closed on
  unavailability (`AuthenticationThrottleError::Unavailable`); health promotes
  that from a per-request refusal to a serving withdrawal.
- **Serialized-authority currency** — this process holds the single durable
  authority: the database instance lock is held and the auth coordinator is
  installed. This is what makes `sessionInvalidation = globallyFenced` true for
  a single-instance profile — the guarantee holds because the deployment
  structurally admits exactly one serving process, not because a replication
  protocol converges. §7 records the invariant this depends on.

On loss of any fact the deployment **withdraws**: new protected work refuses
with `SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED` (currency) or
`SNAPBACK_AUTH_INVALIDATION_LAGGING` (authority), existing sockets drain before
publishing another payload, and `/health` reports the withdrawn state. Recovery
requires a fresh verified snapshot; there is no automatic re-entry on a health
fact silently coming back, because a flapping authority is exactly the condition
under which a stale projection would serve.

## 6. Effective source under this topology

LLP 0060 D2 requires one canonical effective source, and the shipped code has
none: `src/server.rs` reads the raw peer socket address. Under loopback
termination that address is *always* the loopback terminator, which would
collapse every per-source throttle bucket into one — turning D3's five-bucket
set into a global bucket and making per-source limiting a fiction. So the
derivation is not optional polish for this profile; it is load-bearing.

The rule, closed:

1. The immediate transport peer must be **loopback**. It is the only member of
   the trusted proxy set, and the set is not configurable — under this topology
   a non-loopback peer cannot exist, and if one appears the derivation fails
   closed rather than inventing a policy for it.
2. Exactly **one** header family is consulted: `X-Forwarded-For`. `Forwarded`,
   `X-Real-IP`, and every provider-native variant are ignored entirely, so a
   terminator that emits several cannot create a conflict the origin resolves in
   the attacker's favor.
3. Syntax is strict: a comma-separated list of at most **eight** entries, each a
   valid IPv4 or IPv6 literal (no ports, no brackets-with-port, no hostnames, no
   obsolete forms). Any malformed entry fails the whole header.
4. The chain is walked **from the trusted edge toward the client**: the
   rightmost entry is the one the trusted terminator itself appended, and the
   effective source is the rightmost entry the trusted set vouches for. With
   exactly one trusted hop, that is the last entry. The leftmost entry is never
   selected merely because it is present — it is fully client-controlled.
5. Absent, malformed, conflicting, or empty ⇒ `SNAPBACK_AUTH_SOURCE_UNTRUSTED`,
   fail closed. There is no fallback to the peer address, because under this
   topology the peer address is the terminator and using it would silently
   restore the collapsed-bucket failure.
6. The derived source is normalized (IPv4 `/32`, IPv6 `/64` grouping, as the
   shipped throttle already does) and used for throttling, connection caps, and
   audit correlation. It never appears on a public surface.

`effectiveSource = trusted` may be attested only by a deployment whose
terminator is known to overwrite (never append to) a client-supplied
`X-Forwarded-For`. That is a terminator configuration fact the origin cannot
verify; it is bound into `configurationSha256` and stated in §7 as a residual.

## 7. Threat model deltas and residuals

Relative to LLP 0060's threat model, this adapter changes these things:

**Removed.** The forged-forwarding-header attacker reaching the origin directly
is removed by construction (§1.3, H1) rather than fenced. The multi-replica
stale-invalidation attacker is removed by the single-instance invariant rather
than converged.

**Added — the single-instance invariant is load-bearing.** `globallyFenced` is
true here only while exactly one process serves. The invariant rests on: the
platform running one instance (no autoscaling, no rolling overlap), the database
instance lock refusing a second opener, and the admission's `deploymentId`
binding. A platform that silently starts a second instance during a deploy
breaks the guarantee **without breaking any check in §3**. Mitigation is the
lock; the residual is a deploy strategy that runs two instances against two
copies of the data, which is a different deployment, not a race. An operator
MUST NOT configure rolling deploys for this profile.

**Added — the operator is inside the trust boundary.** §2's key authenticates
the control plane to the deployment; it does not constrain what the control
plane says. A single-tenant operator who wants to serve under false facts can.
The adapter's contribution is that they cannot do so *by accident*: every
assertion is bound to an identity and a configuration digest, so drift, staleness
and rollback — the realistic failure modes — refuse.

**Added — the terminator is unverified.** Certificate validity, hostname
resolution, first-contact enforcement, and `X-Forwarded-For` overwrite
discipline are all terminator properties asserted by the control plane and
proven, for one deployment, only by §8's drill.

**Narrowed.** A deployment attesting `installTimeHttpsOnlyBinding` has a pinned
non-browser client population and makes **no browser-facing claim**. LLP 0060's
`hostedAuthCapable` covers browser posture, so such a deployment reports the
capability only alongside the narrowing, and the receipt must carry it.

**Unchanged and still true.** LLP 0060 C1/C3's honesty rules survive intact:
sender constraint is an off-device-replay constraint, never XSS resistance, and
this Spec adds no browser-side claim of any kind.

## 8. Acceptance — the negative-test ledger

Every security-relevant behavior above gets a negative test. This ledger is the
gate: `hostedAuthCapable` may not be claimed while any row is open.

**Admission verification (§3).** Each of these is a distinct refusal fixture
over an otherwise-valid envelope:

| # | Fixture | Expected |
| --- | --- | --- |
| A1 | valid envelope, valid signature, all bindings correct | installs |
| A2 | signature by a non-release key | `_UNAUTHENTICATED` |
| A3 | signature valid, one admission byte flipped after signing | `_UNAUTHENTICATED` |
| A4 | length-extension/boundary-shift between `publicOrigin` and `firstContactTransport` | `_UNAUTHENTICATED` |
| A5 | unknown member anywhere in the envelope | `_INVALID` |
| A6 | `deploymentId` of a sibling deployment, correctly signed | `_FOREIGN` |
| A7 | `configurationSha256` of the previous configuration | `_STALE_CONFIGURATION` |
| A8 | `supportSha256` of a different browser artifact | `_STALE_SUPPORT` |
| A9 | `admissionEpoch` below the durable high-water mark | `_ROLLED_BACK` |
| A10 | `senderReplayEpochFloor` below the durable floor | `_ROLLED_BACK` |
| A11 | lifetime 5 min + 1 ms | `_INVALID` |
| A12 | `now` one ms past `expiresAtMs` at install | `_INVALID` — install-time currency is an envelope-validity failure; `_EXPIRED` is reserved for a snapshot that lapses *during* serving (`admission_epoch_at`), so the two are distinguishable in a log |
| A13 | any epoch above `Number.MAX_SAFE_INTEGER` | `_INVALID` |
| A14 | `operatorSurface: "isolated"` | `_INVALID` |
| A15 | `browserDirectBearerSeam` absent or not `excluded` | `_INVALID` |
| A16 | `hostedAuth` tuple one axis short of the five positives | `_INVALID` |
| A17 | non-canonical `publicOrigin` (uppercase host, `:443`, query, userinfo, trailing path) | `_INVALID` (five cases) |
| A18 | refusal message/details for A6–A9 | contain no expected digest, epoch, or identity |

**Topology (§1.3).**

| # | Fixture | Expected |
| --- | --- | --- |
| T1 | hosted composition on a resolved non-loopback bind | `_TOPOLOGY_INVALID`, before bind |
| T2 | hosted composition on `Unknown` posture (detached/embedded) | `_TOPOLOGY_INVALID` |
| T3 | hosted composition on loopback | admitted |
| T4 | sessions on non-loopback, unchanged | `SNAPBACK_AUTH_TRANSPORT_INSECURE` (regression: the shipped fence is untouched) |

**Seam (§4).**

| # | Fixture | Expected |
| --- | --- | --- |
| S1 | `--auth-deployment hosted` with no envelope | `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED`, exact shipped blocker list |
| S2 | local deployment's public manifest | all-negative `hostedAuth`; never `enforced` |
| S3 | hosted deployment's public manifest | the verified admission's tuple, byte-identical |
| S4 | `/_snapback/*` on the hosted application origin | fixed 404, no CORS, direct-host and alternate-host alike |
| S5 | admission socket reachable from the public origin | not routed; no path admits it |

**Effective source (§6).**

| # | Fixture | Expected |
| --- | --- | --- |
| E1 | no `X-Forwarded-For` | `SOURCE_UNTRUSTED` |
| E2 | nine entries | `SOURCE_UNTRUSTED` |
| E3 | any malformed entry (hostname, port, brackets, empty) | `SOURCE_UNTRUSTED` |
| E4 | `Forwarded` / `X-Real-IP` present and disagreeing with `X-Forwarded-For` | ignored; XFF wins |
| E5 | client-supplied leftmost entry spoofing another address | rightmost trusted entry selected |
| E6 | non-loopback immediate peer | `SOURCE_UNTRUSTED`, no fallback |
| E7 | two clients behind the terminator | distinct source buckets (proves the collapse is fixed) |

**Health withdrawal (§5).**

| # | Fixture | Expected |
| --- | --- | --- |
| H1t | admission expires mid-serving | new work refuses; sockets drain |
| H2t | throttle table dropped underneath a serving process | withdrawal, not silent unlimited |
| H3t | health fact returns after withdrawal | still withdrawn until a fresh snapshot |

**The served matrix (the capability gate).** All of the above are in-process. The
claim additionally requires, against the **real served public origin**:

- LLP 0072's hosted-auth drill leg passing rather than witnessing a refusal;
- the complete LLP 0077 matrix — grant matrix over every grant-presenting route
  and both carriers, the issuance outcome matrix, the nonce/anti-oracle axes,
  replay refusal, and the WebSocket `sender_nonce` release — run over HTTPS
  against that origin, not in process;
- a secret scan over every receipt and log.

Anything less is recorded as a partial result naming exactly which legs passed.

### 8.1 First served-origin run — 2026-07-25

The adapter was deployed to the LLP 0072 Fly.io target
(`snapback-drill`, machine `819701c927ee68`, sjc) in the profile's real
topology: Caddy terminating a Let's Encrypt certificate in the container behind
Fly raw-TCP passthrough on 443, the origin bound to `127.0.0.1:4287`. Receipt:
`demos/competitive-checkpoint/acceptance/results/hosted-edge-admission.v0.json`.

**Passed.** Hosted admission on the served public origin (superseding the
2026-07-25 `SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` refusal witness); publication
of the attested tuple through `/inspect`; and `externalTls` first-contact
strict transport (`hstsPreloadedSuffix` — the `dev` TLD is preloaded with
`include_subdomains`, verified against the preload list).

**Two attested facts are not enforced by the origin, and both block the
claim.** These are the run's real product:

- **S4 failed, and is now fixed.** The admission asserts
  `operatorSurface: "disabled"`, which C2 defines as a *fixed 404* for every
  `/_snapback/*` route on the public application origin. The served origin
  answered `/_snapback/admin` with **503** and an "Admin Console unavailable"
  body — an incidental unavailability, not a deliberate disablement. The origin
  *verified that the snapshot said disabled* without *enforcing disabled*.
  Closed the same day: a hosted deployment now serves a fixed, body-free 404 on
  every `SystemStatic`/`SystemApi` route before any handler, identically for
  pages and API routes and regardless of a valid admin token, while `/inspect`
  stays reachable so the deployment can still publish its own descriptor.
  Regression: `hosted_admission_enforces_the_operator_surface_it_attests`.

  **Residual, recorded rather than hidden:** a *method-mismatched* probe (a GET
  to a POST-only operator route) is rejected by the router's method filter with
  405 before this gate runs, so such a probe still distinguishes a present
  operator route from an absent one. Closing it requires the disablement to move
  ahead of method routing.
- **A new row, D2-plaintext, fails.** D2 requires credential-bearing plaintext
  to be refused, never redirected. The terminator issues a blanket 308 on every
  plaintext path, so a credential-bearing plaintext request is redirected rather
  than refused.

Both were the same defect class and it is the one this Spec exists to prevent:
**an attested fact with no enforcing code behind it.** §3.2 already says
verification does not make the control plane honest — but these two facts are
ones the *origin itself* could enforce and currently does not, which is worse
than an unverifiable assertion because it looks verified. Until both are closed,
an admission asserting them is an overclaim in LLP 0074's exact sense, and
`hostedAuthCapable` cannot be claimed no matter what the matrix does.

The correct fix is not to relax the attestation but to make the origin enforce
what it attests: a hosted deployment must serve a fixed 404 on `/_snapback/*`
(refusing to install an admission that asserts `disabled` while the routes are
reachable), and the profile must refuse, not redirect, plaintext on
credential-bearing paths.

**Not run.** The LLP 0077 matrix. The deployment's active auth mode is `dev`;
sessions mode is selected by the application schema and requires a
`--startup-artifacts` carrier plus a two-boot staging transition that this
deployment does not yet stage. `POST /auth/request-code` refuses
`SNAPBACK_AUTH_MODE_DEV`. This is a deployment-composition gap, not a protocol
finding.

**Bounded, and narrower than §2.4 first implied.** Renewal is
`presignedWindow`. The chain supplies only the snapshot covering the **boot**
instant: the origin installs exactly one authority at startup and does not
advance through the chain at runtime, so the real serving window is **one
snapshot lifetime (5 minutes) from boot**, not the chain's span. Confirmed in
production — a machine that booted at 15:14:56Z answered
`SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED` by 15:25Z.

Two consequences, both recorded rather than smoothed over:

- **A renewal loop is not optional polish; it is required for any drill longer
  than five minutes.** The LLP 0077 matrix will need it (or must complete inside
  one snapshot lifetime) even after sessions are staged. This made open
  question 1 a blocking implementation item, not a design preference.

  **Closed 2026-07-25.** The origin holds the admission document and a
  hot-swappable authority slot (`HostedServingHandle`); every 30 seconds it
  re-reads the document, selects the snapshot covering the clock, and — if it is
  not the incumbent — runs the **identical §3.1 conjunction** before swapping.
  Renewal is deliberately *not* a cheaper trust path: a successor signed by the
  wrong key, bound to another configuration, or violating any other clause is
  refused exactly as a first install would be.

  **It cannot widen the serving window.** Each installed authority keeps its own
  `issuedAtMs`/`expiresAtMs` and every request re-checks them; the loop only
  ever *replaces* a snapshot with another verified one. When the document stops
  covering the clock the loop installs nothing and the incumbent expires, so
  withdrawal is composed with rather than suppressed. Both properties are
  pinned by negative tests
  (`renewal_installs_nothing_once_the_chain_stops_covering_the_clock`,
  `a_renewal_successor_runs_the_full_conjunction`), and empirically a local
  hosted deployment served across three consecutive 90-second snapshots where
  it previously withdrew after one.

  The renewal *mode* remains the author decision already filed: this implements
  the conservative default in force (`presignedWindow`), and an `online` mode
  would reuse the same slot with a different document source.
- **Observed withdrawal is broader than D5 requires.** `/health` withdrew along
  with everything else, where LLP 0060 D5 permits diagnostics to remain
  reachable. Failing closed in the safe direction, but it should be deliberate
  rather than incidental.

## 9. Non-goals

- A multi-tenant or horizontally scaled hosted profile.
- A certificate provisioner, DNS controller, or release/rollback control plane
  (LLP 0072 owns those; this Spec consumes their identities).
- Making the operator trustworthy.
- Any browser-side security claim beyond LLP 0060 C1/C3's existing ones.
- Admitting a platform-edge-terminated topology. §1.2 states why; a future
  amendment could add one only by pinning a verifiable edge-to-origin
  authentication mechanism, never by assuming a private network is empty.

## Open questions

1. Which mechanism should carry `renewal: "online"` delivery in a production
   profile — a machine-side agent polling a control-plane endpoint, or a
   control-plane push to the loopback admission socket? The drill uses
   `presignedWindow`; production wants online, and the choice interacts with
   whether the deployment may make outbound control-plane connections.
2. Should `configurationSha256` cover the terminator's own configuration bytes
   when the terminator ships inside the same release artifact? Doing so would
   convert the "terminator is unverified" residual into a digest binding for
   co-packaged terminators, at the cost of a release rebuild per terminator
   tweak.
3. Does a second instance ever become admissible for this profile under a
   documented handoff (stop-then-start with lock transfer), or does
   `globallyFenced` require the deployment to accept bounded downtime on every
   deploy? The drill accepts downtime.

## Status

**Draft.** No capability is claimed by this document. The §8 ledger is the gate,
and the served-origin rows are the ones that turn LLP 0077's program index from
open to closable.
