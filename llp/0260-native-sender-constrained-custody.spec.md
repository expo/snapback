# LLP 0260: Native sender-constrained credential custody

**Type:** Spec
**Status:** Draft
**Systems:** Auth, Security, Native clients, React/Expo, Swift, Android, Wire Protocol, Client integration, Packaging, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-15
**Revised:** 2026-08-15
**Related:** LLP 0059, LLP 0060, LLP 0064, LLP 0077, LLP 0093, LLP 0096,
LLP 0181, LLP 0258

## Summary

This Spec defines the future native counterpart to LLP 0077's browser
sender-constrained session custody. It will bind a Snapback session to a
per-installation signing key held through Apple Secure Enclave/Keychain or
Android Keystore, carry proof on native HTTP and WebSocket transports, and
make copied bearer bytes insufficient for off-device replay.

The document deliberately separates two properties:

1. **ordinary durable custody**, owned by Accepted LLP 0258: the whole
   LLP 0059 custody record persisted in one OS-secure-storage domain with
   atomic compare-and-replace (0258 D3), giving restart persistence with
   platform at-rest protection while the bearer remains extractable by the
   app process; and
2. **sender-constrained custody**, where protected requests also prove
   possession of a non-exportable installation key.

Accepted LLP 0258 owns the first property — its D3 first-party custody
module and D6 bootstrap integration; LLP 0181's E2C slice defers to it for
Expo. This Spec owns only the second.
Nothing in this Draft changes the current capability matrix: native clients
cannot claim `auth/sender`, and a sender-constrained deployment cannot admit
them to protected surfaces until this Spec is accepted, implemented, and
qualified per operating system.

## Motivation

The shipped native clients can adopt an ordinary session bearer, and
LLP 0258's first-party custody module gives it restart persistence with
platform at-rest protection, but a bearer that is extracted through backup
exposure, application compromise, diagnostic leakage, or another custody
failure remains replayable from another device.

The browser design reduces that replay risk with a non-extractable WebCrypto
key and per-request sender proofs. Native platforms offer different key APIs,
attestation signals, background execution models, HTTP stacks, WebSocket
capabilities, and installation lifecycles. Reusing the browser wire workaround
without specifying those differences would create an unverifiable security
claim and incompatible native SDK behavior.

## Scope and non-goals

This Spec owns:

- native installation-key generation, storage, identity, and loss;
- enrollment of a native key into a Snapback session family;
- HTTP and WebSocket sender-proof carriage;
- nonce, retry, rotation, logout, and recovery behavior;
- React Native/Expo, Swift, and eventual Kotlin SDK seams;
- exact capability reporting and per-OS acceptance evidence; and
- migration between ordinary bearer custody and sender-constrained custody.

This Spec does not:

- replace LLP 0059's authority-transition and client-blanking barrier;
- redefine the server-side proof algorithm, grant binding, replay floor, or
  hosted admission requirements owned by LLP 0060 and LLP 0077;
- claim that SecureStore alone is sender constraint;
- promise that a key is hardware-backed on every device;
- protect against malicious code currently executing with the app's own key
  usage authority;
- define general application secret storage; or
- enable hosted/native auth before a target passes the existing hosted-auth
  admission profile.

## Security claims

Every implementation and receipt must use the following closed vocabulary:

- `ordinary-bearer`: no sender constraint — the bearer alone suffices for
  replay. The carrier, at-rest protection, and restart persistence are
  LLP 0258 custody facts reported separately; this vocabulary grades only
  the sender-constraint property.
- `sender-constrained-software`: the private key is non-exportable through the
  SDK API used by Snapback, but hardware residency is not established.
- `sender-constrained-hardware`: the private key is non-exportable and the
  admitted OS/device evidence establishes hardware-backed residency under the
  platform profile pinned by this Spec.
- `sender-constrained-attested`: the server verifies an accepted attestation
  statement bound to the enrolled key and current admission policy.

Higher grades imply the proof-of-possession protocol, not resistance to active
application compromise. A process able to ask the platform key to sign may act
as the current user while that authority remains available. Copying only the
bearer must be insufficient at every sender-constrained grade.

Hardware and attestation grades are per platform and device class. A passing
iOS receipt establishes nothing about Android, and a simulator/emulator can
exercise protocol behavior without establishing hardware residency.

## Proposed protocol contract

The following requirements are normative for the eventual accepted revision;
the choices explicitly marked `OPEN` remain undecided in this Draft.

### Installation key and custody identity

Each native app installation generates one P-256 signing key for each
canonical Snapback app id and target security partition. The private key never
crosses the SDK boundary as encoded key bytes. The client derives the same
RFC 7638 public-JWK thumbprint used by LLP 0077 and treats
`(appId, target identity, thumbprint, custodyGeneration)` as its local custody
identity.

The adapter reports, rather than guesses:

- key availability;
- exportability;
- hardware residency;
- user-presence/biometric policy;
- backup and device-migration behavior; and
- attestation availability and verification result.

The server never grants a stronger capability from a client-authored grade.
Only target admission plus verified platform evidence may establish hardware
or attested grades.

`OPEN D1`: pin the minimum supported Apple key API and protection class, and
whether user presence is required for ordinary background-safe sessions or is
reserved for step-up operations.

`OPEN D2`: pin the minimum Android Keystore security level, StrongBox posture,
user-authentication policy, and API-level floor.

### Enrollment and session-family binding

Enrollment is an authority-changing credential operation under LLP 0059. The
client proves possession of the new key, the server binds its thumbprint and a
new `custodyGeneration` to the session family, and publication occurs only
after the durable native key reference and coordinator transition agree.

One native installation is one custody generation. Browser and native
installations do not share a private key. The default proposal is that each
installation receives a distinct server-side session-family member so loss or
revocation can target one installation without invalidating all others.

`OPEN D3`: decide whether those members share one refresh family with
installation-scoped grants or use independent refresh families connected only
through the user principal.

An ordinary bearer may upgrade only through an authenticated enrollment route
that is unavailable to a copied bearer after the server has committed the
sender-bound successor. Downgrade never happens implicitly. A target that
requires sender constraint refuses an ordinary bearer rather than silently
issuing an unbound successor.

### HTTP proof carriage

Native HTTP requests should use the standard `DPoP` header where the platform
HTTP stack admits it, binding the proof to method, canonical target URI,
credential identity, issued-at window, unique proof id, custody generation,
and the current server nonce exactly as LLP 0077 requires.

`OPEN D4`: decide whether native clients use the browser proof serialization
byte-for-byte or a versioned native profile sharing only the semantic claims.
Any divergence requires distinct negotiation and conformance vectors; it may
not be inferred from the client platform.

### WebSocket proof carriage and nonce delivery

Native WebSocket stacks may set upgrade headers, unlike browser JavaScript.
The preferred proposal carries the sender proof in the `DPoP` upgrade header
and keeps `Sec-WebSocket-Protocol` for the Snapback wire token and connection
grant. A server may accept the browser subprotocol proof carrier only under
the already-declared browser profile; native support must not widen or make
ambiguous that grammar.

The preferred proposal retains the in-band `sender_nonce` frame on every
client so nonce rotation and reconnect share one state machine across browser
and native clients.

`OPEN D5`: verify each supported native WebSocket stack exposes the required
upgrade-header and failed-upgrade semantics. If any does not, decide whether
that tuple uses the browser carrier or remains a capability GAP.

### Rotation, key loss, and recovery

Bearer refresh preserves the enrolled key and advances the existing custody
revision/nonce state atomically under LLP 0059. Delayed success and failure
from a predecessor generation cannot publish, clear, or sign for a successor.

Key rotation requires proof from the current key plus possession of the new
key unless the server executes an independently authenticated account-recovery
flow. Logout revokes the installation member, blanks application state through
the authority barrier, removes bearer material, and schedules deletion of the
platform key reference. A failed key deletion remains a local diagnostic but
does not resurrect server authority.

If the key is missing, locked, invalidated by biometric enrollment changes,
restored onto an incompatible device, or otherwise unusable, the client must
not fall back to bearer-only requests. It enters a credential-blocked state,
blanks protected publication, and offers only a typed reauthentication or
account-recovery route.

`OPEN D6`: define the backup/device-transfer policy. The safe default is that
sender keys do not migrate and a restored app must enroll as a new
installation.

### Native SDK surface

The shared semantic interface is an injected `NativeSenderCustody` owner, not
raw key bytes:

```ts
interface NativeSenderCustody {
  describe(appId: string): Promise<NativeSenderCustodyDescriptor | null>
  create(appId: string, policy: NativeSenderPolicy): Promise<NativeSenderCustodyDescriptor>
  sign(appId: string, thumbprint: string, payload: Uint8Array): Promise<Uint8Array>
  remove(appId: string, thumbprint: string): Promise<void>
}
```

The accepted revision must define closed descriptor/policy shapes and exact
diagnostics. Expo receives a first-party adapter through
`@expo/snapback-expo`; Swift receives a protocol plus Keychain/Secure Enclave
implementation; Kotlin receives the corresponding Android Keystore contract
before Android can claim the capability. The framework-neutral JavaScript
client depends only on the interface and proof vectors, never an Expo module.

No SDK exposes the bearer, private-key representation, raw SecureStore row,
Keychain persistent reference, Keystore alias, or attestation payload through
ordinary application state, errors, diagnostics, logs, or receipts.

## Capability negotiation and target admission

The client offers `auth/sender` only after it has loaded a valid custody
descriptor and can sign a local challenge. Server discovery must identify the
accepted proof version, carrier choices, nonce behavior, attestation policy,
and minimum custody grade. An unavailable or weaker client fails before
protected application data is published.

Target admission remains governed by LLP 0060. Shipping native adapters does
not make the local target hosted-auth ready, and passing local conformance does
not authorize a production capability claim.

## Failure contract

The accepted revision must map at least these classes to stable diagnostics and
state-machine dispositions:

- key missing, locked, invalidated, or unexpectedly extractable;
- hardware/attestation grade below target policy;
- enrollment proof refused or outcome indeterminate;
- nonce required, stale, malformed, or advanced concurrently;
- proof replay, wrong method/URI, wrong thumbprint, or wrong generation;
- signing cancellation and user-presence refusal;
- bearer refresh committed while local key/custody settlement is ambiguous;
- WebSocket upgrade proof unavailable or response unknowable;
- logout/revocation with local key deletion failure; and
- restored/backup custody that cannot prove continuity.

Credential-bearing or response-controlled bytes never enter app-visible
errors. Indeterminate issuing/enrollment outcomes use the same fixed opaque
error posture as LLP 0060 and reconcile through server-observed custody state
before retry.

## Verification

Qualification is a matrix, not one demo:

1. Shared deterministic vectors prove JWK thumbprints, request canonicalization,
   signatures, nonce updates, and browser/native semantic parity.
2. State-machine tests cover enrollment, refresh, reconnect, concurrent
   rotation, delayed predecessor completion, logout, revocation, key loss, and
   every failure class above.
3. iOS simulator and Android emulator receipts prove protocol behavior but
   explicitly report no hardware claim.
4. Separate physical-device receipts prove the admitted Secure Enclave and
   Android Keystore grades, including restart, device lock, biometric-policy
   change where applicable, and attempted export.
5. A copied-bearer negative test from a distinct process/device fails while
   the enrolled client succeeds.
6. Package and diagnostic scans prove no bearer, private key, signing payload,
   attestation statement, or credential-bearing error is retained in public
   artifacts.
7. Hosted qualification repeats the target admission, replay, rate-limit, and
   compromise drills required by LLP 0060; local evidence cannot substitute.

## Delivery sequence

1. Resolve D1–D6 with primary platform/API research and cross-family security
   review.
2. Freeze shared proof vectors and negotiation/diagnostic schemas.
3. Implement one native adapter and protocol client behind an unclaimable
   experimental flag; run negative replay and lifecycle tests.
4. Implement the second OS independently and compare the semantic surface.
5. Land Expo, Swift, and Kotlin public adapters with explicit capability
   grades and per-OS receipts.
6. Admit native clients only on a target that has separately passed LLP 0060.

No stage may market ordinary SecureStore/Keychain bearer persistence as an
earlier partial implementation of `auth/sender`.

## Open questions

- D1: Apple key API, protection class, and user-presence policy.
- D2: Android API floor, Keystore/StrongBox grade, and user-auth policy.
- D3: installation membership versus refresh-family topology.
- D4: byte-identical browser proof format versus a negotiated native format.
- D5: WebSocket proof carrier and nonce delivery per native stack.
- D6: backup, restore, and device-transfer semantics.
- Which attestation systems, if any, are required for the first production
  grade rather than deferred behind hardware-backed non-exportability?
- Does the first slice need background refresh, or should background execution
  remain a separate capability with stricter key-access policy?

## Status

Draft. This document assigns ownership and records the minimum decision and
evidence surface requested by LLP 0096 §5. It does not settle D1–D6, change a
capability manifest, or claim a shipped native sender-constrained client.
