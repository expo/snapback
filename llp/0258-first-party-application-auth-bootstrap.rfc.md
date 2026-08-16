# LLP 0258: First-party application auth bootstrap

**Type:** RFC
**Status:** Accepted
**Systems:** Auth, Client integration, Sessions, React, React/Expo, Native
clients, Custody, Password auth, Code generation, Packaging, Diagnostics,
Guide, Testing, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-15
**Revised:** 2026-08-16 (Phase 2 evidence admits Android native custody at
`single-runtime`; iOS remains refused pending a real extension-refusal probe)
**Revised:** 2026-08-16 (publication posture: the first-party native custody
package enters the 0.1.24 qualified closure as Experimental without changing
either OS capability claim; see the implementation record)
**Revised:** 2026-08-15 (r5: post-convergence delta-review alignment; see
Revision history)
**Related:** LLP 0039, LLP 0043, LLP 0053, LLP 0057, LLP 0058, LLP 0059,
LLP 0060, LLP 0061, LLP 0064, LLP 0077, LLP 0096, LLP 0114, LLP 0151,
LLP 0176, LLP 0181, LLP 0214, LLP 0218, LLP 0227, LLP 0236, LLP 0238,
LLP 0241, LLP 0247, LLP 0252, LLP 0253, Diary 0079, Diary 0083

## Summary

Snapback should ship one first-party application auth bootstrap that composes
the existing session protocol, `AuthCoordinator`, generated application facts,
environment binding, platform custody, client, and React/Expo provider.

Today those components are individually strong but the ordinary application
still assembles them. A web author constructs an IndexedDB custody adapter,
`AuthCoordinator`, client, and provider. An Expo author must additionally
choose or implement native durable custody and reconcile the supervised
development session with application-driven password sign-in. The common path
therefore requires understanding the internal authority architecture before an
app can expose sign-in, sign-out, and a current principal.

This RFC proposes one composition owner, not a second auth system:

```text
generated application facts ─┐
environment AppBinding ──────┼─> AppAuthBootstrap owner
platform custody adapter ────┘          │
                                        ├─> canonical AuthCoordinator
                                        ├─> canonical Snapback client
                                        ├─> currentPrincipal projection
                                        `─> React/Expo provider projection
```

The bootstrap owns construction, restoration, adoption, disposal, and
diagnostics. LLP 0059 remains the authority-transition protocol; LLP 0227
remains the password mechanism; LLP 0238 remains the public lifecycle
vocabulary; LLP 0181 remains the Expo binding and supervision owner. Explicit
applications retain the advanced composition seam. Familiar and Explicit use
the same bootstrap semantics and runtime objects.

## Motivation

### The missing layer is composition

The existing corpus deliberately split responsibilities:

- LLP 0057/0227 issue ordinary session credentials;
- LLP 0059 owns durable authority custody and transition barriers;
- LLP 0053 owns authorization invalidation and protected-state disposition;
- LLP 0238 owns `currentPrincipal` and the public lifecycle vocabulary;
- LLP 0181 owns `AppBinding`, Expo supervision, and provider boot state; and
- LLP 0064 owns per-platform capability honesty.

No document owns the application-level composition of those parts. The result
is a seam between correctly designed systems rather than a missing primitive.
The Clique 0.1.21 Explicit lane built password sign-in but still introduced an
application `AuthCoordinator`/authority-adoption bridge. The Familiar lane
used durable web custody but left native custody volatile until an application
SecureStore adapter was added. Both reached green, but the auth journey was
not meaningfully more familiar in the Familiar profile.

### Manual composition has correctness consequences

The current work is not harmless boilerplate. An application can:

- create two coordinators for one app/storage partition during React remount;
- use memory custody where process-restart persistence was intended;
- let a supervised development credential overwrite a durable signed-in user;
- expose protected client work before custody synchronization settles;
- clear the client without completing the LLP 0059 participant barrier;
- preserve predecessor private state across a user switch;
- turn an app binding or public environment variable into a bearer carrier; or
- make web, Expo, Familiar, and Explicit disagree about auth state names.

The platform already owns enough structure to prevent these outcomes. The
ordinary path should instantiate that structure once, while leaving its exact
state and refusal facts inspectable.

## Scope

This RFC owns:

- the generated, non-secret bootstrap policy;
- one application bootstrap owner and its construction/disposal rules;
- default browser and Expo/native custody selection;
- integration of existing credential-issuance methods into the canonical
  coordinator;
- React/Expo and headless projections over the same owner;
- supervised-development adoption precedence;
- bootstrap state, diagnostics, and inspection;
- migration from hand-assembled ordinary compositions; and
- clean-package and real-process acceptance for the whole journey.

This RFC does not own:

- credential verification, password hashing, lockout, or recovery
  (LLP 0227/0151);
- session issuance, refresh, logout, or family alarms (LLP 0057);
- authority transition or participant-barrier semantics (LLP 0059/0053);
- a new client cache, query lifecycle, outbox, or presence owner
  (LLP 0114/0218/0238);
- `AppBinding`, endpoint discovery, or Expo process supervision (LLP 0181);
- hosted identity-provider selection, OAuth, production challenge delivery,
  passkeys, or MFA (LLP 0151);
- sender-constrained native key custody (LLP 0077/0096); or
- protected offline retention (LLP 0243).

## Goals

1. An ordinary Expo app reaches a truthful signed-in principal using the
   generated app and first-party provider without constructing an
   `AuthCoordinator` or calling an authority-adoption method.
2. An ordinary browser app gets the same journey from one application-client
   constructor plus the first-party React provider.
3. Web reload and native process death restore the exact settled authority
   without reissuing a credential.
4. Sign-in, sign-out, credential rotation, supervised development, and user
   switching use one LLP 0059 owner and barrier.
5. Familiar and Explicit differ only in authored source/profile projections,
   never auth semantics or custody behavior.
6. Unsupported custody or provider combinations refuse before protected app
   work, with remediation at the construction site.

## Non-goals

- A prebuilt sign-in screen or product-specific navigation state.
- Hiding whether the application is anonymous, restoring, authenticated,
  refreshing, or blocked.
- Treating a local supervised persona as production identity.
- Silently enabling persistence, external identity, or hosted auth.
- Storing a bearer in generated source, `AppDescriptor`, `AppBinding`, Metro
  environment, bundle, source map, public config, logs, or receipts.
- Claiming that SecureStore/Keychain/Keystore alone supplies
  sender-constrained, hardware-attested, or non-exportable request proof.
- Replacing an advanced application-owned broker or custom client shell.

## Terminology

**Bootstrap policy** is generated, non-secret application intent: sessions
mode, admitted entry mechanisms, required custody grade, anonymous-public
posture, and lifecycle protocol version.

**Owner key** is the pair (canonical app id, storage partition). It is
exactly LLP 0059's coordinator and custody identity; this RFC introduces no
additional key component. It is deliberately not called "authority key":
LLP 0059's `CanonicalAuthorityKey`/`authorityKey` is a different object — a
transition-rotating digest of the current authority — and the two must not
be conflated.

**Bootstrap owner** is the one process-local object, keyed by owner key,
that resolves platform custody, returns the canonical `AuthCoordinator`,
constructs the canonical client, registers provider/store participants, and
projects public auth state. It is not the durable authority; the LLP 0059
custody record is.

**Custody adapter** implements LLP 0059's durable ownership/read/compare-and-
replace contract for one platform and storage partition. It is not a generic
key-value adapter.

**Entry mechanism** proves control and yields an ordinary Snapback session,
such as LLP 0227 password sign-in, LLP 0057 email-code exchange, or LLP 0096's
explicit external-session seam. Entry does not define downstream custody.

**Authority source** records how the current settled authority entered the
coordinator: fresh server-witnessed anonymous establishment (a cold
bootstrap or the successor of an explicit sign-out), restored custody,
explicit application sign-in, supervised development bootstrap, advanced
external adoption, or an external transition — a settled authority this
owner did not perform, such as a peer context winning the intermediate
predecessor during a composed entry (D5) — so every settled state D1/D5 can
produce, anonymous states included, has exactly one source value. It is diagnostic
provenance, never authorization, and it is process-lifetime only: the
durable custody record carries no source field, so every authority that
enters by restoration reports `restored` regardless of how it was originally
entered. The bootstrap owner's *internal* record of which transitions it
itself performed in this process is a separate control fact (D5) and is
never projected as authorization.

## Constraints

- There is exactly one logical `AuthCoordinator` per canonical app id and
  storage partition. A provider, hook, client, or entry method cannot become a
  second authority owner (LLP 0059#client-custody-and-authcoordinator).
- Authority transitions quiesce and blank participants before successor
  exposure. No bootstrap shortcut bypasses the LLP 0059/0053 barrier.
- `currentPrincipal` remains LLP 0238's closed public projection. Bootstrap
  state may explain construction, but it cannot invent a competing signed-in
  boolean or user cache.
- A credential response is adopted only through its existing LLP 0057/0227
  path and exact predecessor rules. The ordinary path introduces no bearer
  setter, and the exposed client's existing bearer-replacement surface
  refuses under coordinator custody exactly as it does today
  (`createExternalSessionClient`/`replaceBearerToken` remain
  advanced-surface-only and mutually exclusive with the coordinator).
- A durable-required policy never falls back to memory. Missing trustworthy
  custody is a typed pre-I/O refusal.
- An `AppBinding` carries routing/capability facts and no authority. This RFC
  does not merge binding and credential delivery into one object.
- Generated bootstrap policy is a semantic input under LLP 0241. A change in
  custody grade, sessions posture, or admitted mechanism rotates the relevant
  semantic identity and requires ordinary generation/admission.
- Familiar and Explicit normalize to the same policy and use the same owner.
  Profile-specific runtime branches are forbidden below normalization
  (LLP 0252#d1-two-source-profiles-one-semantic-and-runtime-pipeline).
- Every target and platform claims only its proved custody grade. Browser
  evidence cannot establish Expo/native evidence, and iOS cannot establish
  Android (LLP 0064#7-capability-honesty).

## Decision

### D1. Generate one non-secret bootstrap policy

Codegen emits an `ApplicationAuthBootstrapV1` fact as part of the generated
application descriptor closure:

```ts
type ApplicationAuthBootstrapV1 = {
  readonly format: "snapback.application-auth-bootstrap.v1"
  readonly appId: string
  readonly mode: "sessions"
  readonly custody: "durable-required" | "volatile-explicit"
  readonly entryMechanisms: readonly (
    | "password-v1"
    | "email-code-v1"
    | "external-session-explicit-v1"
  )[]
  readonly anonymousPublic: "allowed" | "refused"
  readonly lifecycleProtocol: 1
}
```

The exact generated representation may be embedded in `AppDescriptor` or
referenced from it, but it has one content-addressed semantic identity and one
admission path. It contains no email, persona, user id, bearer, provider
secret, storage bytes, callback URL, or runtime endpoint.

The policy is a **derived projection, not a second auth configuration**. The
application already has one normalized auth program — the LLP 0214
`defineAuth` declaration and the schema auth mode that codegen normalizes
today. Each field has exactly one source:

- `mode` — the settled schema/`defineAuth` auth mode;
- `entryMechanisms` — the admitted mechanism/provider set;
  `external-session-explicit-v1` appears only when the program explicitly
  declares the advanced external-session seam (authoring seam below), never
  by default;
- `anonymousPublic` — whether the normalized program admits **anonymous
  operation access**: any public/optional-user operation posture or
  public-read visibility. It is *not* derived from LLP 0214's
  `guestPolicy`, which governs claimable guest principals — a different
  concept from principal-less anonymous access — and it governs only what
  anonymous principals may access, never whether bootstrap can settle (see
  below);
- `custody` — an explicit authored field that Phase 0 adds to the
  `defineAuth` program by a named LLP 0214 amendment (a semantic-identity
  change under LLP 0241). Its default is `durable-required`;
  `volatile-explicit` must be written in the program. Until that amendment
  lands, codegen emits the default and refuses a volatile request.

No bootstrap-policy field can be authored independently of the program or
disagree with it; a program the policy schema cannot express is a codegen
refusal, not a silent narrowing.

Two program facts are deliberately excluded from `entryMechanisms`:
LLP 0214's `guestPolicy` (a guest creates a claimable principal; it does not
prove control) and the passkey slot (deferred to LLP 0151). Their presence
in a program neither refuses generation nor appears in the allowlist.
Recovery codes are likewise not an entry mechanism: they are LLP 0151
account-lifecycle infrastructure whose generated rows derive from LLP 0214's
`recoveryPolicy` (D9), never from the mechanism/provider set.

Regardless of `anonymousPublic`, the bootstrap always settles the
server-witnessed anonymous state and reaches `ready`, so credential-entry
surfaces are always reachable — LLP 0227 signup/sign-in require a settled
anonymous coordinator, and a password-only, guest-disabled application must
be able to render sign-in from a cold start. `anonymousPublic: "refused"`
refuses anonymous *data* access, not anonymous boot or entry; per-operation
posture and table visibility remain the authorization authority, and the
generated summary can neither widen nor narrow them.

Supervised development entry is deliberately **not** a policy fact.
Admission of a supervised-development session is anchored on LLP 0181's
supervised binding source (D5), so release artifacts exclude it structurally
— a release binding is never supervised — rather than by pruning a generated
field.

`entryMechanisms` is an allowlist of application entry surfaces, not a claim
that the target can serve them. Binding admission intersects it with target
capabilities. Selecting `password-v1` against a target without `auth.passwords`
refuses with the missing capability before sign-in UI calls can issue network
work.

`durable-required` is the ordinary Sessions default for web and native.
`volatile-explicit` exists for tests, disposable demos, and advanced shells;
it must be written explicitly and appears in bootstrap inspection (D7).
`currentPrincipal` remains LLP 0238's closed projection and carries no
custody facts. Codegen never infers `volatile-explicit` merely because a
durable adapter is missing.

Both authoring profiles spell or default these facts through their existing
front ends and normalize them once. Familiar may offer a shorter declaration;
it cannot choose a weaker hidden custody or auth policy.

### D2. One bootstrap owner constructs the auth-bearing application client

The framework-neutral constructor is conceptually:

```ts
const appClient = await createSnapbackAppClient({
  app,
  binding,
  platform,
  storagePartition, // optional; default = the stable per-app constant
})
```

Names remain subject to API review, but the ownership shape is normative.

The bootstrap owner is keyed by the **owner key alone** — canonical app
id and storage partition — exactly matching LLP 0059 coordinator and custody
identity. `storagePartition` is the one ordinary input for the key's second
half; it is never carried by `AppBinding` or ambient environment. The
binding target is a construction *input*, never key material, and its parts
divide by role:

- **Schema/functions generation identities are rebind inputs — but only
  under a compatible bootstrap policy.** Construction against a live owner
  whose target differs only by successor generation identities of the same
  app/origin/routing, with an **unchanged (or LLP 0241-compatible) bootstrap
  policy semantic identity**, resolves as reference-counted reuse: the owner
  applies the reminted binding *and* the successor generated application
  through its own supervised-refresh/rebind path (LLP 0181's provider as
  amended in Phase 0), which requires an LLP 0241-backed successor proof —
  a stale binding arriving after its successor is refused, not rebound.
  Ordinary same-policy codegen remints, HMR, and Strict Mode remount overlap
  therefore keep one owner and one coordinator. A remint that **rotates the
  bootstrap policy** — any change to the policy's semantic identity: custody
  grade, sessions posture, admitted mechanisms, anonymous-public posture, or
  lifecycle protocol —
  is a 0241 authority rotation, and the live owner cannot absorb it by
  rebinding — its custody adapter and mechanism table were instantiated
  under the predecessor policy. Such a remint refuses with a typed
  policy-rotation diagnostic; adopting the successor policy requires
  disposal and reconstruction under ordinary generation/admission.
- **App, origin, and routing are conflict inputs.** Constructing for an
  owner key a live owner already holds with a genuinely different
  app/origin/routing refuses with `SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT`
  until the prior projection is disposed — authority is neither silently
  shared across targets nor duplicated. An application that genuinely wants
  two such targets side by side passes explicit distinct `storagePartition`
  values, which is also the D5 partition remediation.

The ordinary default storage partition is a stable per-app constant. It is
never derived from a supervisor generation or other rotating identity; the
Expo path's per-generation `clientStoreId` remains a query-store axis and is
not the auth-custody axis.

Construction:

1. validates the generated application, bootstrap policy, and binding before
   opening stores;
2. resolves one admitted custody adapter for the platform/profile;
3. obtains the process-local bootstrap owner for the owner key;
4. obtains or constructs the single logical `AuthCoordinator` for that key;
5. constructs the ordinary Snapback client with that coordinator in an
   unreleased state — the client's own constructor registers its mandatory
   transport participant, and store, connection, outbox, and provider-owned
   participants register as those owners are created;
6. synchronizes durable custody or establishes the server-witnessed anonymous
   predecessor through the client's existing session handshake owner;
7. closes the then-existing mandatory participant set under LLP 0059's exact
   settled confirmation (dynamically created live resources join later under
   the existing late-registration rules — nothing is registered before it
   exists); and
8. releases public application work only after that confirmation.

Durable custody initialization precedes every public release, including for
`anonymousPublic: "allowed"` applications: the owner and the durable
anonymous partition initialize first, so later protected adoption can never
switch storage owners. This resolves former open question 3 conservatively —
under `durable-required`, custody is a prerequisite even for public routes.

The returned object projects:

```ts
interface SnapbackAppClient {
  readonly client: SnapbackClient
  readonly auth: SnapbackAuthFacade
  bootstrapState(): AuthBootstrapSnapshot
  subscribeBootstrap(listener: () => void): () => void
  dispose(): Promise<void>
}
```

`auth` is a **composing layer over** the `client.auth` namespace that
LLP 0238 D6 specifies. That namespace is a 0238 vocabulary this RFC's
Phase 1 implements, not a shipped surface — today's client exposes the flat
`authPasswordSignup`-family methods. The landing spot is pinned: Phase 1
adds `client.auth` to the low-level `SnapbackClient` exactly as 0238 D6
spells it. The facade delegates method and state contracts to that namespace
unchanged, and adds only what needs the owner — the D5 owner-serialized
displacement and entry gating. Owner-dependent behavior lives on the facade,
never on the low-level client. `dispose` removes process-local resources and
subscriptions; it does not log out or delete durable custody. Explicit
`auth.signOut()` owns that authority transition.

Within one JavaScript context, repeat construction for the same owner key
and binding target returns a reference-counted projection of the same
bootstrap owner. React Strict Mode, Fast Refresh, and nested providers cannot
create a second coordinator. A different storage partition is a different
explicit owner key; a different binding target over a live key is the
typed conflict refusal above.

### D3. Custody is selected by capability, never convenience fallback

The first-party platform matrix begins as:

| Platform | Ordinary durable carrier | Minimum evidence |
| --- | --- | --- |
| Browser | existing IndexedDB + Web Locks adapter | two-tab ownership, reload restoration, corruption/recovery, logout replacement |
| Expo web | the same IndexedDB + Web Locks adapter (never the native carrier) | same as Browser |
| Expo iOS | first-party native durable adapter (design below) | process kill/relaunch, exact revision/epoch preservation, protected keychain/storage behavior, no overlapping-owner write |
| Expo Android | first-party native durable adapter (design below) | force-stop/relaunch, exact revision/epoch preservation, Keystore/storage behavior, no overlapping-owner write |
| Node/headless | explicit file/transactional adapter where admitted | crash/reopen, owner fencing, mode/permission checks |
| Memory | volatile only | explicit policy and visible nonclaim |

The native carrier must implement LLP 0059's ownership and compare-and-replace
semantics, not merely expose `getItem`/`setItem`. `expo-secure-store` may be a
secret/persistence component, but packaging the guide's process-local queue as
if it were a transactional cross-process adapter is insufficient.

**The selected v1 design is a first-party native custody module** shipped
from a first-party package. Its normative contract:

- it persists the entire LLP 0059 custody record (`AuthCustodyV2`, bearer
  included) as one serialized unit in one OS-secure-storage domain — the
  bearer is never split from the lease/revision metadata, preserving 0059's
  same-transaction rule;
- it implements compare-and-replace natively: every write is an atomic
  replace conditioned on the exact expected revision/epoch, with crash-safe
  read-verify, in that single storage domain;
- it provides ownership fencing at the strongest level the OS proves. Where
  cross-process fencing cannot be independently demonstrated for a platform,
  the module declares a **single-runtime capability** for that platform:
  background, extension, and multi-process use refuse with a typed
  diagnostic rather than racing; and
- it owns its storage format and migrations, validates every read and write,
  and reports its exact durability/security grade per platform; and
- like every first-party adapter (browser included), it addresses records by
  the full owner key — (canonical app id, storage partition) — so the D2/D5
  partition remediations are real; an adapter keyed by app id alone does not
  qualify.

Phase 0's iOS and Android probes validate this design's per-OS evidence
(LLP 0064 — iOS evidence is not Android evidence); they inform grade
declarations, not whether the module exists. If a probe shows a platform
cannot even satisfy the single-runtime profile, that platform's
`durable-required` capability stays refused — the design does not degrade to
an unfenced adapter. Application copies of the guide adapter do not qualify
the first-party path.

If `durable-required` cannot resolve a qualifying adapter, construction fails
with `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE` before protected resources or
credential entry start. It does not substitute memory. Explicit volatile use
reports `custody: "volatile"` in inspection and cannot pass a restart claim.

### D4. Credential entry adopts into the existing coordinator automatically

The facade exposes mechanism-appropriate projections, beginning with LLP 0227:

```ts
interface SnapbackAuthFacade {
  currentPrincipal(): CurrentPrincipalSnapshot
  subscribeCurrentPrincipal(listener: () => void): () => void
  signUpWithPassword(
    input: PasswordSignupInput,
  ): Promise<AuthRecoveryCredentialPublicProjectionV1>
  signInWithPassword(
    input: PasswordSigninInput,
  ): Promise<AuthCredentialPublicProjectionV1>
  changePassword(
    input: PasswordChangeInput,
  ): Promise<AuthCredentialPublicProjectionV1>
  signOut(): Promise<null>
}
```

Every facade method **preserves the exact result contract of the client
method it wraps** — the facade adds adoption and lifecycle ownership, never a
new route or a narrowed result. In particular, signup returns the existing
one-time recovery-credential projection (`recoveryCodes` included) exactly as
`authPasswordSignup` does today: that return is the application's one
deliberate boundary for showing recovery custody to the user, and eliding it
would silently destroy required credential custody. The owner never retains,
logs, or re-exposes that projection after the call resolves. Password
signup/sign-in adopt the ordinary composed credential response through
LLP 0227's anonymous-issuance path on the same coordinator; sign-in and
`changePassword` return the shipped `AuthCredentialPublicProjectionV1` and
`signOut` returns the shipped logout result exactly as the wrapped methods
do. `changePassword` is the rotate arm of LLP 0227's closed change union —
authenticated same-authority rotation, not an entry call, so the entry
refusal below never applies to it; the set arm (step-up proof preserved),
reset, and the recovery-lifecycle operations (consumption and rotation, both
returning the one-time recovery projection) stay available on the client
surface and join the facade under the same exact-contract mapping via D9
rows. D9 generates the facade return types
directly from the shipped client declarations, so a facade method cannot
drift from the contract it wraps. Sign-out uses the existing server logout plus
coordinator barrier and exposes anonymous state only after participant
clearing and durable settlement.

Entry refusals project onto LLP 0238's closed public union — the facade
widens nothing. An entry call while the principal is `loading`, `refreshing`,
or `blocked` (including internal clearing/incompatibility phases, which
surface as `loading`/`blocked` plus a typed LLP 0238/0247 diagnostic) refuses
with remediation. An entry call while an **application-entered or restored
authenticated principal** is settled refuses with a typed diagnostic
directing explicit `signOut()` — there is no implicit user switch. The one
composed exception is a supervised-development principal: D5 defines explicit
application entry over it as an authorized displacement. No path assigns a
bearer directly or treats the response's user id as application authority.

Email-code and future LLP 0151 mechanisms join this facade only after their own
mechanism/target/client-surface acceptance. The bootstrap API is deliberately
mechanism-extensible without becoming provider-policy authority.

### D5. Application authority wins over ambient development adoption

Authority precedence is closed, and it governs the whole session — boot and
every later supervisor event — not startup alone:

1. a valid durable settled record for the owner key is restored and
   synchronized;
2. an explicit application entry operation may transition that settled
   predecessor under its normal rules;
3. a supervised-development session may bootstrap only a fresh or settled
   **anonymous** predecessor, and only when the `AppBinding` was admitted
   through LLP 0181's supervised-development channel (the binding source is
   the admission fact; there is no policy field for it — D1); and
4. advanced external adoption requires an explicit advanced constructor or
   shell and never competes with the ordinary owner.

**Explicit application entry displaces a supervised persona.** The
displacement predicate is the bootstrap owner's internal, process-local
record of the transitions it itself performed — not the projected
`authoritySource` (which stays diagnostic) and not the binding source (which
cannot distinguish two sessions under one supervised binding). When that
record shows the current session was adopted by supervised bootstrap in this
process, `signUpWithPassword`/`signInWithPassword` performs one composed,
owner-driven operation: barrier sign-out of the supervised session to the
server-witnessed anonymous predecessor, then ordinary anonymous issuance.
Each step is an unchanged LLP 0059 transition — participants recapture
normally on the intermediate anonymous successor; the composition is owned
by the bootstrap: the owner serializes entry operations, withholds
**public application and `currentPrincipal` publication** across the span
(the same public-release gating it uses during construction; 0238 projects
`loading`/`refreshing` meanwhile), and refuses or drops supervisor adoption
events while the entry is in flight, so the application observes a single
predecessor→successor exposure. That single-exposure guarantee is scoped to
the **initiating JavaScript context**: peer contexts hold their own LLP 0059
coordinators and observe the ordinary broadcast sequence of settled
authorities (supervised → anonymous → session) under unchanged 0059 rules.
If a peer context transitions the intermediate anonymous predecessor first,
the second step fails with the ordinary exact-predecessor refusal and the
initiating owner surfaces the typed entry diagnostic over whatever authority
0059 settled — no new durable or cross-context protocol exists. The owner's
process-local record binds to the exact authority capture it transitioned
and invalidates on any transition it did not perform, so a stale record can
never authorize displacing a later authority. If issuance fails after the
sign-out settled, the terminal state is the settled anonymous authority plus
the typed entry diagnostic — the sign-out is not rolled back, and supervised
re-admission is not the failure fallback: a remint that arrived mid-entry is
dropped (rebind facts only, no rule-3 adoption), and re-admission may occur
only on a subsequent supervisor event under rule 3. Because the record is process-local, it is
empty after process death: every restored authenticated principal —
including one originally supervised — is protected as application authority,
refuses entry, and requires explicit `signOut()` (D4). Ambient developer
convenience never outranks restored authority.

**Supervisor events after boot obey the same precedence.** A binding remint,
supervisor restart, or `refreshAuthority` cycle may replace session authority
only while the owner's process-local record shows a supervised-adopted
session, or while the predecessor is anonymous and rule 3 admits it. In
every other state — application-entered or restored authenticated authority
— those events update binding/transport facts only and surface
`SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` as a non-authoritative
diagnostic; on the ordinary path they never replace a bearer
(`replaceBearerToken`/`createExternalSessionClient` leave the ordinary
path entirely — supervised adoption handshakes into the coordinator like any
other session). No automatic “latest credential wins” rule exists at boot or
after it.

**The supervised conflict never wedges boot.** When durable custody holds an
authenticated user and the supervisor requests a different principal, the
bootstrap completes `ready` with the durable principal and carries the
conflict diagnostic as a `ready`-arm advisory (D7) with its remediations.
Every remediation is executable through the specified API: keep the current
principal (default — no call); explicitly `signOut()`, after which the next
supervisor event (`refreshAuthority` or the next remint) re-admits under
rule 3; or reconstruct with an explicit `storagePartition`. `blocked`
continues to own unsettleable custody states (corrupt, exhausted, LLP 0059
blocked/recovery); `authority-required` is reserved for states where no
authority can settle for a non-custody reason (for example, auth mode not
settled to Sessions) — never for this conflict.

A stale or incompatible durable record follows LLP 0059's blocked/recovery
path. The bootstrap cannot delete it merely to make development start. A
server-witnessed new anonymous incarnation may use the accepted unrecognized-
authority recovery operation, preserving its exact preconditions and visible
destructive effect.

### D6. React and Expo project the same owner

The ordinary Expo path remains:

```tsx
<SnapbackExpoProvider app={app}>
  <Routes />
</SnapbackExpoProvider>
```

When generated policy requests first-party bootstrap, the provider resolves
the platform and `AppBinding`, then delegates to the common application-client
constructor. It does not construct a private coordinator or keep a second
signed-in state. Applications do not pass `AuthCoordinator`, bearer, or
`adoptAuthority` on this path.

The ordinary web path constructs the same framework-neutral app client from
the generated app plus the admitted browser binding, then gives it to the
canonical React provider. The existing advanced `client`/coordinator injection
path remains available under an explicit advanced entry point; ordinary and
advanced ownership cannot be enabled for the same provider instance.

React/Expo expose:

- `useSnapbackCurrentPrincipal()` with LLP 0238's exact specified contract
  (0238 D6 is the vocabulary this RFC implements; it is not yet a shipped
  surface — D2);
- mechanism actions through a small `useSnapbackAuth()` projection over the
  app client's `auth` facade; and
- bootstrap diagnostics through provider boot state, not another user-state
  hook.

Familiar may re-export the ordinary hooks under its admitted profile brand.
Because LLP 0253 S6.1 closes Familiar's v1 export list, those re-exports are
an explicit 0253 amendment (Phase 0), not a side effect. The hooks consume
the same owner, state union, and generated mechanism table as Explicit.
Familiar aliases never construct a cache, coordinator, or client.

### D7. Bootstrap state is construction truth, not auth truth

The owner exposes a closed construction snapshot:

```ts
type AuthBootstrapSnapshot =
  | { status: "starting"; stage: "binding" | "custody" | "authority" | "client" }
  | {
      status: "ready"
      custody: PublicCustodyFacts
      authoritySource: AuthoritySource
      advisories: readonly {
        diagnostic: SnapbackDiagnostic
        remediations: readonly TypedRemediation[]
      }[]
    }
  | { status: "authority-required"; diagnostic: SnapbackDiagnostic; remediations: readonly TypedRemediation[] }
  | { status: "blocked" | "unsupported" | "error"; diagnostic: SnapbackDiagnostic; remediations: readonly TypedRemediation[] }
```

`ready` means binding admission, custody synchronization, coordinator/client
construction, and participant exposure completed. It does not mean the
principal is authenticated, the transport is online, or retained data is
current. Those remain `currentPrincipal`, connection, and query freshness
facts.

`advisories` carries non-blocking `ready`-arm diagnostics — the D5
supervised-principal conflict is the first — so a truthful `ready` and an
actionable warning can coexist without inventing a blocking state.

After this RFC, **the bootstrap snapshot union above is owned here**, and
LLP 0181's `ExpoBootState` is amended (Phase 0) to embed it as the
construction-status source of truth. Every existing 0181 public field is
dispositioned, not dropped: the amended `ready` arm keeps 0181's public
binding facts and its deployment/persisted-receipt preparation fact, and
replaces its authority projection with the LLP 0238 `currentPrincipal`
surface. That amendment is a real change to 0181's public boot surface (new
`custody` stage, `blocked` status, `ready` advisories, redefined `ready`
meaning, and an `adoptAuthority` success contract that no longer treats a
missing ordinary session as `authority-required`) and is declared as such,
not as a mere cross-reference.

Public custody facts include carrier kind, durable/volatile grade, storage
partition identity hash, format version, and recovery availability. They never
include bearer, email, raw app id where the projection does not already admit
it, storage key, or record bytes. Authority-source provenance is similarly
non-authoritative and non-secret.

Every failure names the owner and next action. Required diagnostic classes
include:

- unsupported/missing durable custody;
- duplicate ordinary/advanced authority owners;
- binding/app/profile mismatch;
- custody corruption or unrecognized incarnation;
- supervised-principal conflict;
- mechanism unavailable on the target;
- auth mode not settled to Sessions; and
- participant barrier or final confirmation failure.

### D8. Security boundaries remain explicit

The bootstrap owner narrows bearer handling but does not upgrade the security
of its carriers by composition. In particular:

- the bearer is accepted only from an existing credential-entry response,
  durable custody read, or admitted supervised/external session channel;
- it never appears in generated facts, `AppBinding`, React props, public
  state, logs, diagnostics, source maps, Metro environment, or receipts;
- one-time recovery credentials (LLP 0214/0151 lifecycle) cross exactly one
  deliberate boundary **class** — the `AuthRecoveryCredentialPublicProjectionV1`
  return values of signup, recovery consumption, and recovery rotation (D4)
  — and the owner never retains, logs, or re-exposes them; scans treat
  bearer material and one-time recovery material as distinct classes and
  enumerate all three admitted returns;
- provider and application callbacks run only after the LLP 0059 final exact
  durable confirmation;
- logout/user switch synchronously blanks every participant and destroys or
  strands predecessor private state according to its existing owner;
- a local supervised channel retains LLP 0181's exact threat/nonclaim posture;
  this RFC does not call a loopback label confidential or peer-authenticated;
- ordinary native bearer persistence is not sender-constrained native auth;
  targets requiring `auth/sender` continue to refuse native clients until the
  LLP 0096 follow-on exists; and
- storage recovery is explicit and typed. “Clear everything and retry” is not
  an automatic bootstrap strategy.

### D9. Generated completeness keeps mechanisms and clients aligned

The lifecycle manifest from LLP 0238 gains generated bootstrap rows for:

- bootstrap-policy field and semantic-identity disposition (including its
  derivation from the normalized `defineAuth`/schema auth program — D1);
- mechanism → client method/hook/target-capability mapping, with each
  method's exact result contract (including the one-time recovery-credential
  return boundary); mechanism rows deferred to a later phase (for example
  `email-code-v1` before its facade method exists) gate at their own phase,
  not Phase 1;
- recovery-lifecycle rows derived from LLP 0214's `recoveryPolicy` (not the
  mechanism set): consumption and rotation, their predecessor rules, target
  capabilities, facade methods, and exact return contracts;
- platform → admitted custody adapter and grade;
- bootstrap stage/state/diagnostic tables;
- ordinary versus advanced ownership exclusivity;
- supervised-adoption precedence; and
- guide/capability anchors.

Codegen, headless types, React/Expo types, Familiar re-exports, diagnostics,
templates, and guide reference tables are generated or gated from these rows.
Adding an LLP 0151 provider without a custody/client-surface disposition fails
the completeness gate rather than appearing on only one arm.

## Compatibility and migration

This RFC is additive at first. Existing applications may continue constructing
a client and `AuthCoordinator` through the advanced surface. They cannot also
enable ordinary first-party ownership for the same app/storage partition.

Migration has three stages:

1. inspection reports whether the existing composition matches the generated
   policy, storage partition, and target;
2. preview reports which application-owned coordinator/storage/provider glue
   becomes first-party and whether its custody record is format-compatible;
3. the application switches construction ownership without changing the
   underlying user/session authority or deleting a compatible custody record.

An incompatible custom record is never imported heuristically. The migration
either uses an explicit validated adapter/translation or requires sign-out and
fresh ordinary bootstrap with a visible loss-of-local-state warning.

The initial ordinary path is capability-gated. Existing `SnapbackExpoProvider`
behavior does not silently change until its generated descriptor opts into the
new bootstrap version and the matched package closure contains the required
client, contract, Expo, React, codegen, and CLI/runtime support.

## Rollout

### Phase 0 — Freeze composition and carrier choices

1. Validate the D3 native-custody-module design with implementation probes on
   iOS and Android, recording per-OS fencing evidence and the resulting
   grade/capability declarations (single-runtime where cross-process fencing
   is unproven).
2. Freeze `ApplicationAuthBootstrapV1`, bootstrap state, diagnostics, and the
   ordinary/advanced ownership boundary.
3. Land dated amendments: LLP 0181 (bootstrap-owned boot union with the D7
   field dispositions; supervised mint no longer auto-adopts over
   application authority at boot or refresh; `refreshAuthority` is not a
   bearer setter on the ordinary path; the `adoptAuthority` success contract
   no longer treats a missing ordinary session as failure; `ready` may be
   anonymous), LLP 0214 (`defineAuth` gains the authored custody grade and
   the explicit external-session seam — D1), and LLP 0253 S6.1 (auth hook
   re-exports). The LLP 0214 amendment lands with its LLP 0252 D1 field
   dispositions (Familiar defaults `durable-required` and can never author a
   weaker custody grade). These change the amended surfaces and say so.
   LLP 0059, LLP 0227, and LLP 0238 receive cross-references only — their
   protocols are unchanged (the D5 composed displacement is owner-level
   sequencing over unchanged 0059 transitions, and `AuthCustodyV2` gains no
   field).
4. Freeze clean app fixtures for browser Explicit, Expo Explicit, browser
   Familiar, and Expo Familiar.

### Phase 1 — Framework-neutral owner and browser custody

1. Implement the app-client/bootstrap owner and duplicate-owner gate.
2. Integrate the existing IndexedDB/Web Locks adapter and coordinator recovery.
3. Project canonical current-principal and password entry methods.
4. Prove reload, two-tab ownership, Fast Refresh/Strict Mode, logout, user
   switch, corruption, and blocked recovery in real browsers.

### Phase 2 — Expo/native durable custody

1. Ship the selected first-party native adapter from a public package.
2. Integrate it behind the common Expo provider without application adapter
   code.
3. Prove iOS process kill/relaunch and Android force-stop/relaunch with the
   same settled principal and no credential reissuance.
4. Prove unsupported/background/multi-process cases refuse at the promised
   capability boundary.

### Phase 3 — Supervised development and profile closure

1. Apply the closed durable-versus-supervised precedence rules to LLP 0181's
   provider.
2. Remove ordinary app calls to `adoptAuthority`; retain the method only on
   the advanced surface.
3. Generate the mechanism/custody/profile completeness table and Familiar
   re-exports.
4. Update Expo/web templates and the intent-indexed guide with one journey,
   while retaining advanced composition and threat-model pages.

### Phase 4 — External-package qualification

1. Publish one matched package closure containing every composition owner.
2. From clean external apps, complete signup, sign-in, protected read, reload
   or process death, sign-out, user switch, and recovery in both authoring
   profiles.
3. Rerun the relevant Clique M1 auth lanes with no package-source inspection,
   application `AuthCoordinator`, custom custody adapter, bearer prop, or
   ordinary `adoptAuthority` call.
4. Record wallclock/correction loops separately from server-authoring syntax
   and feed the evidence into LLP 0252's experiment.

Capabilities flip per platform only after their exact phase evidence passes.
Browser success does not wait for native, and native success does not imply
hosted or sender-constrained auth.

## Acceptance

- A clean browser app installs the published closure, renders the first-party
  provider, signs up/signs in with LLP 0227 password methods, observes the
  canonical authenticated principal, reloads the full page, and restores that
  principal without another issuance.
- Two browser tabs share one logical custody record; concurrent sign-in,
  refresh, logout, and user-switch races preserve LLP 0059's exact winner and
  blanking rules.
- Clean Expo apps on iOS and Android perform the same journey, terminate the
  process, restart, and restore the session through a shipped adapter with no
  application custody implementation.
- React Strict Mode, Fast Refresh, nested layout remounts, and repeated
  construction for one exact key create one bootstrap/coordinator owner and
  bounded projections; final disposal leaks no listeners or connections.
- A durable authenticated user is never overwritten by a supervised dev
  session — at boot, on supervisor restart, on binding remint, or on
  `refreshAuthority`. Conflict boots `ready` with the durable principal and
  produces the closed diagnostic; adoption requires an explicit transition or
  storage partition. Explicit password entry over a supervised-source
  principal completes as one composed displacement (D5).
- Signup/sign-in, password change, refresh, logout, and supervised adoption
  all project one `currentPrincipal` state machine and one participant barrier.
- The composed supervised displacement survives adversarial interleaving: a
  failed issuance terminates in settled anonymous with the typed diagnostic
  (never silent supervised re-adoption); a supervisor adoption event or
  remint arriving mid-entry is dropped at arrival (rebind facts only, no
  rule-3 adoption — never deferred behind the entry and then adopted); the
  initiating context's public application and `currentPrincipal` projection
  observe exactly one predecessor→successor exposure across the composed
  span, while participants and peer contexts follow LLP 0059's unchanged
  recapture and broadcast sequences.
- A password-only, guest-disabled application reaches sign-in from a cold
  start: bootstrap settles anonymous `ready` and the entry surface renders
  with no out-of-provider escape hatch.
- Logout and user switch expose zero predecessor protected rows, optimistic
  layers, queued intent, assets, or presence after successor release, according
  to each subsystem's existing disposition contract.
- A missing/corrupt/unsupported durable adapter refuses before protected
  request, credential entry, or public `ready`; memory fallback occurs only
  under explicit `volatile-explicit` policy.
- Bundle, source-map, log, Metro environment, generated artifact, `AppBinding`,
  public-state, and receipt scans find no bearer or credential payload; the
  one-time recovery projection appears nowhere but its admitted return
  boundary class (signup, recovery consumption, recovery rotation).
- Explicit and Familiar fixtures normalize equal bootstrap policy facts and
  use byte-identical runtime/client/custody paths; only generated source/profile
  identities differ as LLP 0252 requires.
- The capability index, guide, generated reference, and diagnostic registry
  state the exact carrier/target support and nonclaims.

## Alternatives considered

### Improve only the guide

Declined. The guide can teach the correct composition, but every application
would still own storage adaptation, singleton construction, precedence, and
barrier integration. The diary evidence already shows that a tested recipe is
not the same product as a first-party path.

### Put password auth directly in `SnapbackExpoProvider`

Declined. Password is one entry mechanism, Expo is one client surface, and the
provider must not become a second session or coordinator owner. The common
composition is framework-neutral; Expo projects it.

### Let each provider own its credential and cache

Declined. That recreates parallel auth state, makes linked mechanisms diverge,
and violates LLP 0059's single logical authority record.

### Store the development or release bearer in `AppBinding`

Declined by LLP 0181 and retained here. Binding is routing/capability identity;
authority has its own custody and lifecycle.

### Default native apps to memory until a secure adapter exists

Declined. It makes an ordinary successful sign-in silently disappear on
process death and teaches a false product contract. Durable-required refuses;
volatile demos opt in visibly.

### Replace explicit composition everywhere immediately

Declined. Advanced brokers, custom shells, protocol clients, and debugging
fixtures need the primitives. Ordinary and advanced paths are mutually
exclusive owners over the same protocols, with measured migration.

## Risks

- **A convenient owner can hide auth architecture.** Inspection exposes
  custody, stages, authority source, and remediations without bearer material;
  advanced composition remains documented.
- **A native adapter can overclaim concurrency or secrecy.** Acceptance is
  per OS and carrier. Secure persistence is not treated as transactional
  ownership or sender constraint without evidence.
- **Automatic supervised adoption can surprise a developer.** Durable custody
  wins and conflicts require an explicit transition.
- **Singleton registries can leak across tests or Fast Refresh.** Ownership is
  keyed, reference-counted, disposable, and acceptance includes remount and
  isolation stress.
- **The provider may become a mega-object.** It remains a projection over the
  framework-neutral app client; auth mechanisms, query stores, assets, and
  bindings retain their existing owners.
- **Familiar can appear better by hiding facts.** Its aliases project the same
  bootstrap/custody state and diagnostics; benchmark attribution counts the
  composition as shared product work.
- **Migration can strand custom custody.** Preview refuses unknown formats and
  never copies opaque bearer records optimistically.

## Open questions

1. Per-OS fencing evidence for the D3 native custody module: which platforms
   prove cross-process fencing, and which ship the declared single-runtime
   capability instead? The module design is decided (D3); the Phase 0 probes
   answer only the per-platform grade declarations, and `durable-required`
   stays refused on any platform that cannot meet even the single-runtime
   profile.
2. Should the framework-neutral constructor be the new primary
   `SnapbackClient` creation path in one compatibility epoch, or remain an
   application-level constructor beside the low-level client indefinitely?

Former open question 3 (anonymous-public readiness before durable custody)
is resolved normatively in D2: custody initializes first.

## Status

Accepted (2026-08-15 on the author's build directive following super-refine
convergence; ratified by the author 2026-08-16, who also dispositioned the
review-loop growth — the grown normative text stands and the revision
ledger below is the compact form, with full verbatim detail in the
`llp/reviews/0258-*` artifacts and run journal). The component
protocols are already owned and substantially
implemented. This RFC proposes the missing composition boundary, platform
custody obligation, precedence rules, and whole-journey proof. The native
carrier design is decided in D3 with fail-closed per-platform capability
gating, so acceptance does not wait on the Phase 0 probes; each platform's
`durable-required` capability flips only on its own probe evidence.
Implementation must not introduce a second auth protocol or weaken existing
custody/barrier semantics.

### Implementation record — 2026-08-15

- `d42dabce3` landed the generated `ApplicationAuthBootstrapV1` policy fact
  and the LLP 0214/0253 Phase 0 amendments.
- `450d150e6` landed the framework-neutral `createSnapbackAppClient` owner and
  `client.auth` projection with browser durable custody.
- `b186296fd` landed the capability-gated ordinary React/Expo projections,
  auth hooks and Familiar aliases, and LLP 0258 D5 supervised precedence.
- `0477fda40` independently threaded the full owner key through
  `AuthCoordinator` and custody adapters without adding a custody-record
  field; `75da1f28a` independently shipped the SecureStore adapter.
- Author ruling 2026-08-16: `@expo/snapback-expo-custody` joins the 0.1.24
  qualified publication closure as an Experimental, identity-preset-only
  package. This is package-byte availability, not an iOS or Android durable
  custody claim: adapters report their own grade, v1 declares only
  `single-runtime`, the config plugin must be listed in the application's Expo
  `plugins` array, and both per-OS flips remain gated by
  `issues/20260815-llp-0258-phase-2-native-custody-evidence.md`.
- Phase 2 evidence close-out (2026-08-16): the committed Android PASS bundle
  `demos/native-custody-probes/evidence/20260816T214639Z-0a6c91ed-phase2-android`
  admits the ordinary Expo path at `single-runtime`. The iOS bundle
  `demos/native-custody-probes/evidence/20260816T214117Z-dfaa64ff-phase2-ios`
  passes its exercised arms but marks P4 extension refusal INCOMPLETE, so iOS
  stays refused pending `issues/20260816-ios-extension-refusal-probe.md`.
- Remaining closure is tracked by
  `issues/20260815-llp-0258-phase-2-native-custody-evidence.md`,
  `issues/20260815-llp-0258-phase-3-remainders.md`,
  `issues/20260815-llp-0258-phase-4-external-qualification.md`, and
  `issues/20260815-llp-0258-rebind-0241-successor-proof.md` (today's binding
  carries no LLP 0241 activation proof; the shipped rebind enforces only the
  provable subset, so `b186296fd`'s D5/D2 claims are scoped by that ticket).
- Phase 3 closure (2026-08-16): `54bb1cd44` (D9 completeness rows +
  `recoveryPolicy` source field), `5f1e79bbc` (four clean fixtures,
  Explicit/Familiar parity proof, ordinary-path react/expo-chat templates,
  supervised same-origin Vite relay), and the guide-journey landing
  (`guide/auth/passwords.md` + routing + capability-GAP closure).
  `issues/20260815-llp-0258-phase-3-remainders.md` is closed; remaining
  closure is the Phase 2 and Phase 4 tickets plus the 0241 successor-proof
  ticket.
- A post-convergence r4 delta review (codex + grok, 2026-08-15) found the
  shipped mid-entry supervisor adoption deferred-then-adopted and an
  intermediate mid-entry `ready` publication; both were fixed with the r5
  alignment (arrival-time drop, no intermediate publication) in the same
  landing as this note.

## Revision history

Full per-revision detail (verdict-lined review artifacts, delta
enumerations, disposition ledgers) lives in
`llp/reviews/0258-first-party-application-auth-bootstrap.{run,claude,codex,grok}.md`.
Compact ledger:

- **r1** (2026-08-15, `fbea5491…`): initial Draft; entered super-refine
  review (Draft → Review, landed `4cc971ea4`).
- **r2** (2026-08-15, `840995cb…`): round-1 revision — owner key closed to
  LLP 0059 identity; construction order fixed; OQ3 resolved (custody
  initializes first); policy redefined as a derived projection; native
  carrier design selected; exact facade result contracts; precedence
  extended to first-run displacement and runtime remint; 0181/0253
  amendments declared as protocol changes.
- **r3** (2026-08-15, `2fb1bd9f…`): round-2 delta revision — owner-key
  naming disambiguated; per-field policy derivations pinned
  (`anonymousPublic` from operation access, `custody` via the LLP 0214
  amendment); unconditional anonymous boot; `storagePartition` constructor
  input; rebind/conflict split; shipped return contracts; process-local
  displacement predicate with composed-operation semantics; D7 ready
  advisories and 0181 field dispositions. **The loop converged on this
  revision** (delta rule: no MATERIAL concern in pre-existing text, any
  family).
- **r4** (2026-08-15, `dc6cb829…`): post-convergence fixes for the four
  round-3 in-delta MATERIALs — initiating-context exposure scoping,
  fresh-anonymous authority source, recoveryPolicy-derived completeness
  rows, policy-rotation rebind refusal.
- **r5** (2026-08-15, `9fb0555a…` at authoring): r4 delta-review alignment
  (codex + grok) — Acceptance matched to the drop-only mid-entry rule;
  authority-source union closed with `external-transition`; rotation
  predicate = any policy-semantic-identity change; companion code fix
  (arrival-time drop, no intermediate publication) landed `32f902a09`.
