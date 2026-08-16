# LLP 0258: First-party application auth bootstrap

**Type:** RFC
**Status:** Review
**Systems:** Auth, Client integration, Sessions, React, React/Expo, Native
clients, Custody, Password auth, Code generation, Packaging, Diagnostics,
Guide, Testing, Developer experience
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-15
**Revised:** 2026-08-15 (entered super-refine review; Draft → Review at loop
start. Initial Draft: proposes one first-party application bootstrap owner
over the existing session, `AuthCoordinator`, client, platform-custody, and
Expo provider contracts)
**Related:** LLP 0039, LLP 0043, LLP 0053, LLP 0057, LLP 0058, LLP 0059,
LLP 0060, LLP 0061, LLP 0064, LLP 0096, LLP 0114, LLP 0151, LLP 0176,
LLP 0181, LLP 0218, LLP 0227, LLP 0236, LLP 0238, LLP 0241, LLP 0247,
LLP 0252, LLP 0253, Diary 0079, Diary 0083

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

**Bootstrap owner** is the one process-local object that resolves platform
custody, returns the canonical `AuthCoordinator`, constructs the canonical
client, registers provider/store participants, and projects public auth state.
It is not the durable authority; the LLP 0059 custody record is.

**Custody adapter** implements LLP 0059's durable ownership/read/compare-and-
replace contract for one platform and storage partition. It is not a generic
key-value adapter.

**Entry mechanism** proves control and yields an ordinary Snapback session,
such as LLP 0227 password sign-in, LLP 0057 email-code exchange, or LLP 0096's
explicit external-session seam. Entry does not define downstream custody.

**Authority source** records how the current ordinary session entered the
coordinator: restored custody, explicit application sign-in, supervised
development bootstrap, or advanced external adoption. It is diagnostic
provenance, never authorization.

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
  path and exact predecessor rules. No bearer setter exists on the ordinary
  API.
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

`entryMechanisms` is an allowlist of application entry surfaces, not a claim
that the target can serve them. Binding admission intersects it with target
capabilities. Selecting `password-v1` against a target without `auth.passwords`
refuses with the missing capability before sign-in UI calls can issue network
work.

`durable-required` is the ordinary Sessions default for web and native.
`volatile-explicit` exists for tests, disposable demos, and advanced shells;
it must be written explicitly and appears in bootstrap/current-principal
inspection. Codegen never infers it merely because a durable adapter is
missing.

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
})
```

Names remain subject to API review, but the ownership shape is normative.
Construction:

1. validates the generated application, bootstrap policy, and binding before
   opening stores;
2. resolves one admitted custody adapter for the platform/profile;
3. obtains the process-local bootstrap owner keyed by canonical app id,
   storage partition, and binding target;
4. obtains or constructs the single logical `AuthCoordinator` for that key;
5. registers the client store, connection owner, live resources, outbox, and
   provider as LLP 0059 participants;
6. synchronizes durable custody or establishes the server-witnessed anonymous
   predecessor through the existing handshake;
7. constructs the ordinary Snapback client with that coordinator; and
8. releases public application work only after exact settled confirmation.

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

`auth` delegates to the existing `client.auth` namespace. `dispose` removes
process-local resources and subscriptions; it does not log out or delete
durable custody. Explicit `auth.signOut()` owns that authority transition.

Within one JavaScript context, repeat construction for the exact key returns a
reference-counted projection of the same bootstrap owner. React Strict Mode,
Fast Refresh, and nested providers cannot create a second coordinator. A
different binding target or storage partition is a different explicit key and
cannot silently share authority.

### D3. Custody is selected by capability, never convenience fallback

The first-party platform matrix begins as:

| Platform | Ordinary durable carrier | Minimum evidence |
| --- | --- | --- |
| Browser | existing IndexedDB + Web Locks adapter | two-tab ownership, reload restoration, corruption/recovery, logout replacement |
| Expo iOS | first-party native durable adapter | process kill/relaunch, exact revision/epoch preservation, protected keychain/storage behavior, no overlapping-owner write |
| Expo Android | first-party native durable adapter | force-stop/relaunch, exact revision/epoch preservation, Keystore/storage behavior, no overlapping-owner write |
| Node/headless | explicit file/transactional adapter where admitted | crash/reopen, owner fencing, mode/permission checks |
| Memory | volatile only | explicit policy and visible nonclaim |

The native carrier must implement LLP 0059's ownership and compare-and-replace
semantics, not merely expose `getItem`/`setItem`. `expo-secure-store` may be a
secret/persistence component, but packaging the guide's process-local queue as
if it were a transactional cross-process adapter is insufficient. The rollout
must select and prove one of:

- a first-party native module or OS primitive that supplies the required
  fenced ownership around secure credential storage; or
- a narrowly declared single-runtime carrier whose platform/process exclusion
  is independently demonstrated and whose capability refuses background or
  multi-process use.

This carrier choice is the principal open design item before this RFC can move
to Accepted. Whatever wins ships from a first-party package, owns its storage
format/migrations, validates every read and write, and reports its exact
durability/security grade. Application copies of the guide adapter do not
qualify the first-party path.

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
  signUpWithPassword(input: PasswordSignupInput): Promise<void>
  signInWithPassword(input: PasswordSigninInput): Promise<void>
  signOut(): Promise<void>
}
```

The methods are conveniences over existing client methods, not new routes or
result contracts. Password signup/sign-in receive the ordinary composed
credential response and adopt it through LLP 0227's anonymous-issuance path on
the same coordinator. Credential change uses same-authority rotation. Sign-out
uses the existing server logout plus coordinator barrier and exposes anonymous
state only after participant clearing and durable settlement.

An entry call while the predecessor state is loading, refreshing, clearing,
blocked, or incompatible refuses with LLP 0238/0247's public diagnostic and
remediation. It never assigns a bearer directly or treats the response's user
id as application authority.

Email-code and future LLP 0151 mechanisms join this facade only after their own
mechanism/target/client-surface acceptance. The bootstrap API is deliberately
mechanism-extensible without becoming provider-policy authority.

### D5. Durable restoration wins over ambient development adoption

Startup authority precedence is closed:

1. a valid durable settled record for the exact app/partition/target is
   restored and synchronized;
2. an explicit application entry operation may transition that settled
   predecessor under its normal rules;
3. a supervised-development session may bootstrap only a fresh or settled
   anonymous predecessor when the generated policy admits the development
   entry; and
4. advanced external adoption requires an explicit advanced constructor or
   shell and never competes with the ordinary owner.

A supervised session never overwrites a durable authenticated user merely
because Metro or a supervisor restarted. If the supervisor requests a
different principal while durable custody is authenticated, boot reports
`authority-required`/`SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` with choices
to keep the current principal, explicitly sign out and adopt the supervised
principal, or select a separate storage partition. No automatic “latest
credential wins” rule exists.

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

- LLP 0238's `useSnapbackCurrentPrincipal()` unchanged;
- mechanism actions through a small `useSnapbackAuth()` projection over the
  app client's `auth` facade; and
- bootstrap diagnostics through provider boot state, not another user-state
  hook.

Familiar may re-export the ordinary hooks under its admitted profile brand.
The hooks consume the same owner, state union, and generated mechanism table as
Explicit. Familiar aliases never construct a cache, coordinator, or client.

### D7. Bootstrap state is construction truth, not auth truth

The owner exposes a closed construction snapshot:

```ts
type AuthBootstrapSnapshot =
  | { status: "starting"; stage: "binding" | "custody" | "authority" | "client" }
  | { status: "ready"; custody: PublicCustodyFacts; authoritySource: AuthoritySource }
  | { status: "authority-required"; diagnostic: SnapbackDiagnostic; remediations: readonly TypedRemediation[] }
  | { status: "blocked" | "unsupported" | "error"; diagnostic: SnapbackDiagnostic; remediations: readonly TypedRemediation[] }
```

`ready` means binding admission, custody synchronization, coordinator/client
construction, and participant exposure completed. It does not mean the
principal is authenticated, the transport is online, or retained data is
current. Those remain `currentPrincipal`, connection, and query freshness
facts.

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

- bootstrap-policy field and semantic-identity disposition;
- mechanism → client method/hook/target-capability mapping;
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

1. Resolve the native durable-carrier open question with an implementation
   probe on iOS and Android.
2. Freeze `ApplicationAuthBootstrapV1`, bootstrap state, diagnostics, and the
   ordinary/advanced ownership boundary.
3. Add dated cross-reference amendments to LLP 0059, LLP 0181, LLP 0227,
   LLP 0238, LLP 0252, and LLP 0253 without changing their underlying
   protocols.
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
  session. Conflict produces the closed diagnostic and requires an explicit
  transition or storage partition.
- Signup/sign-in, password change, refresh, logout, and supervised adoption
  all project one `currentPrincipal` state machine and one participant barrier.
- Logout and user switch expose zero predecessor protected rows, optimistic
  layers, queued intent, assets, or presence after successor release, according
  to each subsystem's existing disposition contract.
- A missing/corrupt/unsupported durable adapter refuses before protected
  request, credential entry, or public `ready`; memory fallback occurs only
  under explicit `volatile-explicit` policy.
- Bundle, source-map, log, Metro environment, generated artifact, `AppBinding`,
  public-state, and receipt scans find no bearer or credential payload.
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

1. Which native carrier can satisfy LLP 0059 ownership while preserving an
   ordinary Expo installation: a first-party native module/OS primitive, or a
   proven single-runtime profile over secure persistence? This must be resolved
   before acceptance, not deferred to implementation.
2. Should the framework-neutral constructor be the new primary
   `SnapbackClient` creation path in one compatibility epoch, or remain an
   application-level constructor beside the low-level client indefinitely?
3. Should a release application with `anonymousPublic: "allowed"` construct a
   ready anonymous client before durable custody is available, or does
   `durable-required` make custody a prerequisite even for its public routes?
   The conservative recommendation is that the owner and durable anonymous
   partition still initialize first, so later protected adoption cannot switch
   storage owners.

## Status

Review. The component protocols are already owned and substantially
implemented. This RFC proposes the missing composition boundary, platform
custody obligation, precedence rules, and whole-journey proof. It requires
review of the native carrier choice and the cross-document ownership boundary
before acceptance; implementation must not introduce a second auth protocol or
weaken existing custody/barrier semantics.
