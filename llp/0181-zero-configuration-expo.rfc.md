# LLP 0181: Zero-configuration Expo integration

**Type:** RFC
**Status:** Review
**Systems:** React/Expo, Client integration, Packaging, Local server lifecycle,
Auth, Assets, Offline, Testing, Hosted environments, Code generation
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-05
**Revised:** 2026-08-21 (v) — Replaces the reusable `public/` attestation
asset with a supervisor-owned loopback front: browsers navigate through that
front to Metro and consume one in-memory, run-bound attestation exactly once.
The director then repeats descriptor, PID/start-time, process-tree, front
listener, and upstream Metro-listener validation after navigation. A detached
reaper is established before the CLI starts; atomically registered PGID leases
gate Metro and Chrome exec, exact-path leases cover readiness and the browser
profile, and carrier/supervisor death triggers independent reclamation. The
real CLI owns signals before `runExpoDev` begins and retains them until cleanup
settles.
**Revised:** 2026-08-21 (t) — Hardens the supervised browser carrier at its;
**Revised:** 2026-08-21 (u) — Hardens the supervised browser carrier at its
last-use boundary: the readiness descriptor binds supervisor, Metro child,
and admitted listener to PID/start-time identities; the carrier re-enumerates
that ownership immediately before Chrome starts and verifies a run-specific
nonce through the exact Metro origin after navigation. The supervisor installs
its carrier parent lease before starting any child, latches startup-critical
child exits through atomic readiness publication, and reclaims process groups
even after their leaders exit. Repeated termination signals remain owned until
cleanup completes.;
**Revised:** 2026-08-21 (t) — Native auth storage-partition identity now uses a
provider-owned, SHA-256-only `expo-crypto` adapter over the common application
client's canonical UTF-8 bytes. The adapter exposes no randomness capability;
missing/unlinked native digest support, digest execution failure, and missing
secure randomness remain distinct refusals. The Expo provider no longer passes
or requires a consumer-installed `globalThis.crypto` for this path.
**Revised:** 2026-08-16 (s) — Fix round 4 makes the ruled generated-artifact
trust root usable: codegen derives exact app/schema/functions/HTTPS target
tuples from closed `codegen.policy.json` hosted-development declarations and
emits a frozen, non-enumerable target-set/receipt-predicate record on `app`.
Undeclared targets, negative receipts, descriptor-only inputs, and legacy
modules without the record still refuse. Hosted-origin classification also
refuses the complete deprecated IPv4-compatible IPv6 `::/96` block in both
admission and framework-neutral client validation.
**Revised:** 2026-08-16 (r) — Grok delta fix round 3 closes the live-candidate
TOCTOU seam: hosted-development admission snapshots the complete candidate into
a plain frozen record before its first verifier await, then matches, verifies,
and derives the marked transport binding only from that snapshot. Unspecified-
address coverage explicitly includes IPv4-mapped unspecified `[::ffff:0:0]`
alongside `0.0.0.0` and `[::]` in both admission and client validation.
**Revised:** 2026-08-16 (q) — Adjudicated fix round 2 makes the generated
application artifact set the hosted-development trust root: the admission path
reads the target set and receipt predicate only from the exact `app` export
hydrated by the generated binding module, accepts no caller-supplied hosted
facts, and refuses when that generated-module record is absent. The enforcement
claim is process-local and explicitly excludes same-process code that bypasses
the generated path. Hosted-origin classification also refuses unspecified IPv4
and IPv6 addresses, including `0.0.0.0` and `[::]`.
**Revised:** 2026-08-16 (p) — Fail-closed review correction: hosted-development
origin admission now refuses loopback names and private IP literals, and the
framework-neutral application client accepts only the exact binding object
returned by generated-target-and-receipt admission. This revision deliberately
does not classify DNS names: DNS-named private origins remain outside the
client arm's guarantees while packet ruling 6 stays open.
**Revised:** 2026-08-15 (o) — Executes Charlie Cheever's accepted iOS
physical-device carrier ruling recorded in
`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`: topology
(c) is adopted and `source: "hosted-development"` makes a development bundle
against an already-admitted hosted HTTPS backend representable without adding
a listener, relay, tunnel, or E5 carrier. The LLP 0168 successor-RFC gate stays
closed on A3 grounds; a client using the admitted hosted target is outside that
edge gate. Rulings 4–6 remain open.
**Revised:** 2026-08-15 (n) — Reconciles ordinary-session custody ownership
**Revised:** 2026-08-16 (o) — Records the supervised-browser compatibility
projection: LLP 0030 may put its same-origin relative Vite relay base in the
legacy-named `target.origin` field without exposing the backend loopback URL;
native supervision and every release binding retain resolved absolute origins;
2026-08-15 (n) — Reconciles ordinary-session custody ownership
with Accepted LLP 0258: E1/E2 adopt and rotate a bearer only for the life of
the supervised client, and restart-persistent ordinary custody is owned by
LLP 0258 — its D3 first-party native custody module with whole-record atomic
compare-and-replace, integrated through the common bootstrap owner (0258
D6) — not by an 0181-pinned injected `expo-secure-store` adapter; 0258 D3
explicitly rules a process-local `getItemAsync`/`setItemAsync` shim
insufficient as the transactional first-party carrier. E2C is re-scoped to
this RFC's integration slice of that program. This revision also lands the
LLP 0258 Phase 0 amendments to this RFC's public surfaces: `ExpoBootState`
embeds 0258 D7's bootstrap snapshot as the construction-status source of
truth (new `custody` stage, `blocked` status, `ready` advisories, and
`ready` may be anonymous); a supervised mint no longer auto-adopts over
application authority at boot or on refresh; `refreshAuthority` is not a
bearer setter on the ordinary path; and the `adoptAuthority` success
contract no longer treats a missing ordinary session as
`authority-required`. Sender-constrained hardware-key custody remains owned
by Draft LLP 0260.
**Revised:** 2026-08-15 (m) — Generated descriptors' required
`authoringProfile` field is part of Expo's closed admission schema and is
contract-tested against fresh explicit and Familiar codegen output. Supervised
development now remints the binding at each `generated-and-loaded` descriptor
rotation, so a function edit becomes callable without restarting the
supervisor; the Expo 57 Metro/Hermes parser gates every emitted client module.
**Revised:** 2026-08-10 (l) — The already-paved supervised web carrier is now
a first-class `--expo-platform web` selection: the supervisor starts Expo with
`--web` and injects the bootstrap origin before bundling. A recognizable
`expo start` routed through LLP 0041's generic client arm warns that no
supervised bootstrap was installed. Custom external-session shells own origin
propagation, and a final binding-preparation transport failure carries the
attempted origin and phase after persisted-receipt fallback declines it.
**Revised:** 2026-08-07 (k) — The supervised carrier's endpoint vocabulary is
now confined to literal development-only branches so production Metro/Hermes
exports prune it, making the carrier inert under the release build condition
and repairing LLP 0176 G4's release-shape finding.
**Revised:** 2026-08-06 (j) — OQ4 USB implementation probe: Android physical
devices now use the E1 supervisor's exact per-serial `adb reverse` ownership,
with emulator/USB/TCP-IP inventory classes, TCP/IP refusal, exact verification,
rollback/removal, readiness device facts, and a manual-but-not-yet-executed
Online receipt checklist. The iOS half did not survive tool-direction
verification: installed `devicectl` 518.33 exposes no TCP forward, and
`iproxy` forwards host loopback to a device service rather than iOS device
loopback to host loopback. `--ios-udid` therefore enumerates/refuses network
devices and fails with a typed reverse-forward-unavailable diagnostic before
starting children. No live-device or LLP 0064 claim follows; iOS still needs a
device-side bridge or a new author ruling.
**Revised:** 2026-08-06 (i) — E2 complete: the provider registers the
picker/content-URI structural-source adapter, Expo binary transport, client
checksum support, and ordinary-session custody; one real system-picked image
committed and rendered on iOS simulator and Android emulator. No background,
restart, offline, attempt-grant, release, physical-device, or LAN-carrier claim
follows. Earlier same day (h) — Provider boot-state clarification from the G2
surface checkpoint: with ordinary authority already available, an exact
AppDescriptor may reach `ready` from LLP 0114's persisted binding receipt
while its query/connection projections truthfully remain retained/stale. The
provider does not require live transport to call retained state ready, and it
does not turn missing authority into that state (the missing-authority half
of this claim is superseded by revision (n)/LLP 0258 Phase 0: bootstrap now
settles anonymous `ready` once Sessions mode is settled). Earlier same day (g) — The real Android-emulator G1 receipt exposed
ordinary host/device clock lag at immediate cold launch. Supervised
`local-supervised-ipc` admission now tolerates at most 60 seconds on the
`issuedAt` lower bound only; expiry stays strict, release admission is
unchanged, and the coded refusal/test remain beyond the exact boundary.
Earlier 2026-08-05 (f) — E1 selected the supervised development
carriers: Metro receives only a credential-free rendezvous origin through
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`; the provider fetches the expiring
binding and ordinary session at runtime from a supervisor-owned, loopback-only,
`no-store` HTTP exchange. The supervisor invokes the G0 native mint with its
database-bound operator token and the ready-file process capability, but only
the ordinary session crosses the exchange. E1 also makes OS listener
enumeration (backend, Metro, and exchange), verified Android `adb reverse`
rules with an explicit `10.0.2.2` fallback posture, provider-owned authority
replacement, the bearer-leak matrix, and strict reclamation executable.
2026-08-05 (e) — Super-refine round 2 (delta): fixed a physical-
device sentence orphaned by round 1's `AppBindingV1` discriminated-union fix
(it referenced a "secure development binding" arm the union no longer, and
never actually did, represent); swept remaining unqualified "dev persona"
language in §Provider/§Risks/§What remains explicit/OQ2 to match the
routed-ask framing already stated in §Supervised development baseline;
widened E1's bearer-leak grep to the complete location set §Provider's
requirement names (persistent public configuration was missing) and
separated the readiness-stream check as an additional, not restated, bar;
bound E5 to LLP 0168's actual spike fence (named owner, time-box,
`SNAPBACK_PROFILE=prod` when reachable off-loopback) instead of describing
its own; and added a namespace note reconciling `@expo/snapback-*` against
LLP 0041's still-open general `@snapback/*` namespace decision. 2026-08-05
(d) — Super-refine round 1: downgraded the bootstrap
exchange's "no bearer anywhere" claim from an asserted design outcome to a
stated requirement on a mechanism this RFC's own open question 2 admits is
undesigned, and added a bundle/log/source-map grep to E1's acceptance so the
claim is checked, not only stated; gave the advanced `binding` override an
explicit admission rule so it cannot become the arbitrary-URL-override path
§AppBinding v1 forbids elsewhere in the same document; made `AppBindingV1` a
discriminated union so its `source` and `provenance` fields cannot disagree;
added binding-integrity/authenticated-delivery requirements answering how a
development or release binding is protected from substitution; corrected the
LLP 0168 citation to the actual current document (it had cited an abandoned,
superseded RFC by a stale filename) and aligned this RFC's posture with its
real current recommendation ("do not build on the present record," not a
ready-to-implement requirements list); and required every listener a
supervised session forwards through — Metro included, not only the backend —
to be verified loopback-bound in the G1-G4 baseline, closing a gap where the
stated acceptance criterion and this RFC's own routing text disagreed.
2026-08-05 (c) — Made the supervised dev-session bootstrap an explicit
integration of LLP 0176 G0's standalone `snapback session mint --email`
primitive rather than a second, independently designed mechanism; and had
`snapback dev --expo` print the admin console's launch command in its
readiness stream, closing the discoverability gap the same program's
evidence found (LLP 0176 §Beyond the golden path, "already shipped but
undiscovered"). 2026-08-05 (b) — Standardized on the
`@expo/snapback-expo` package namespace; replaced overlapping development
descriptor/release target objects with one environment-specific
`AppBinding`; made LLP 0179's `AppDescriptor` the sole stable app source;
and moved LAN relay, physical-device pairing, and attempt grants out of the
baseline until their security boundaries are independently accepted.
**Related:** LLP 0017, LLP 0030, LLP 0041, LLP 0044, LLP 0055, LLP 0057, LLP
0058, LLP 0059, LLP 0064, LLP 0103, LLP 0105, LLP 0114, LLP 0146, LLP 0168,
LLP 0171, LLP 0176, LLP 0179, LLP 0180, LLP 0258, LLP 0260

## Summary

An Expo application should not need to understand Snapback URLs, Metro package
closure, native picker/file adapters, lifecycle plumbing, target selection, or
backend supervision before rendering a live query and sending one image.

This RFC proposes:

- one first-party `@expo/snapback-expo` package;
- one environment-specific, versioned `AppBinding` schema;
- one provider whose common-path prop is only LLP 0179's stable
  `AppDescriptor`; and
- one packaged `snapback dev --expo` supervision profile.

The user-facing contract is:

```json
{
  "expo": {
    "plugins": ["@expo/snapback-expo"]
  }
}
```

```tsx
import { SnapbackExpoProvider } from "@expo/snapback-expo"
import { app } from "./snapback/generated/app"

export default function Root() {
  return (
    <SnapbackExpoProvider app={app}>
      <Routes />
    </SnapbackExpoProvider>
  )
}
```

```sh
snapback dev --expo
```

There is no URL prop, committed environment variable, Metro alias table,
picker bridge, lifecycle effect, or child-process script on the common path.

“Zero configuration” means the integration derives mechanically knowable
environment facts and leaves an inspectable receipt. It does not mean zero
policy, hidden mutation, public development exposure, or invented authority.

## Authority and scope

This RFC owns:

- the `@expo/snapback-expo` public package and config plugin;
- the versioned, environment-specific `AppBinding`;
- provider binding resolution/admission and Expo lifecycle projection;
- simulator/emulator development routing;
- Expo-native asset/query-storage/crypto/lifecycle adapters (auth
  custody excluded — LLP 0258);
- Metro and EAS dependency/archive closure;
- the `snapback dev --expo` supervisor profile; and
- Expo-specific boot diagnostics and qualification.

It does not own:

- the stable app model or application surface grammar (LLP 0179);
- query stores, mutation attempts, presence rooms, or cleanup (LLP 0114);
- asset policy/tasks or command semantics (LLP 0044/0180);
- session/principal policy;
- restart-persistent ordinary auth custody and the bootstrap snapshot
  (LLP 0258), or sender-constrained key custody (LLP 0260);
- public or LAN-reachable development edges (LLP 0168);
- hosted target semantics or OTA compatibility (LLP 0103/0105); or
- per-OS capability standards (LLP 0064).

The package is a projection over those owners. It creates no Expo-only cache,
protocol, auth model, mutation ledger, asset state machine, or stable app
descriptor.

## Two objects, two lifetimes

The integrated design has exactly two descriptor-shaped objects:

| Object | Owner | Lifetime | Contains |
| --- | --- | --- | --- |
| `AppDescriptor` | LLP 0179 | Stable for generated application artifacts | API refs, commands, surfaces, required capabilities, artifact identities |
| `AppBinding` | LLP 0181 | Specific supervised run, hosted development target, or release target | Endpoint/routing, offered capabilities, source, provenance, compatibility/expiry facts |

A session, pairing secret, persona, or bearer is neither object. Authority is
adopted through the existing auth owner and stored/transmitted according to
its own rules.

## AppBinding v1

The logical portable shape is a **discriminated union on `source`**, not a
struct whose `source` and `provenance` fields could independently disagree —
a reviewer correctly found the earlier struct shape let a value claim one
source while carrying another source's provenance, with nothing in the type
preventing it:

```ts
type AppBindingV1 =
  | {
      readonly format: "snapback.app-binding.v1"
      readonly source: "supervised-dev"
      readonly descriptorIdentity: string
      readonly target: {
        readonly app: string; readonly schema: string
        readonly functions: string; readonly origin: string
        readonly routing: "loopback" | "port-forward"
      }
      readonly capabilities: { readonly offered: readonly CapabilityOffer[] }
      readonly provenance: {
        readonly supervisorGeneration: string
        readonly issuedAt: string
        readonly expiresAt: string
      }
      readonly integrity: { readonly channel: "local-supervised-ipc" }
    }
  | {
      readonly format: "snapback.app-binding.v1"
      readonly source: "hosted-development"
      readonly descriptorIdentity: string
      readonly target: {
        readonly app: string; readonly schema: string
        readonly functions: string; readonly origin: string
        readonly routing: "https"
      }
      readonly capabilities: { readonly offered: readonly CapabilityOffer[] }
      readonly provenance: { readonly hostedTargetReceipt: string }
      readonly integrity: { readonly channel: "hosted-target-admission" }
    }
  | {
      readonly format: "snapback.app-binding.v1"
      readonly source: "release"
      readonly descriptorIdentity: string
      readonly target: {
        readonly app: string; readonly schema: string
        readonly functions: string; readonly origin: string
        readonly routing: "https"
      }
      readonly capabilities: { readonly offered: readonly CapabilityOffer[] }
      readonly provenance: {
        readonly environment: string
        readonly releaseChannel: string
        readonly buildReceipt: string
      }
      readonly integrity:
        | { readonly channel: "signed-artifact"; readonly signature: string }
        | { readonly channel: "embedded-at-build" }
    }
```

A round-2 delta review correctly found the first fix's release `integrity`
shape self-contradicting: it typed `signature: string | null` while
§Acceptance separately requires an unsigned release binding to refuse, which
a type admitting `null` cannot enforce. `integrity` is now itself a
discriminated union: the `signed-artifact` arm requires a non-null
`signature`, full stop — there is no representable "signed channel, no
signature" value to refuse against, because the type does not admit one.
The `embedded-at-build` arm carries no separate signature field; its trust
basis is `provenance.buildReceipt` (already present, already a required
field) verified through whatever existing build-receipt verification
mechanism admits that receipt — this RFC does not mint a second, competing
attestation format for the same fact.

The exact identity tuple and capability vocabulary reuse existing owners. The
load-bearing properties are:

- the schema is the same for supervised development, hosted development, and
  release;
- `source` and `provenance` cannot disagree, because the type itself couples
  them;
- `routing: "https"` is reachable only through the `hosted-development` and
  `release` arms — a supervised-dev binding cannot claim the hosted routing
  mode, closing the ambiguity a struct shape left open;
- supervised-development bindings expire and are tied to one supervisor
  generation;
- supervised-development admission tolerates at most 60 seconds of the
  binding issuer's clock running ahead of the simulator/emulator clock. This
  bounded allowance applies only to the `issuedAt` lower bound over
  `local-supervised-ipc`; expiry remains strict and the window grants no
  release-binding or network authority;
- hosted-development bindings are tied to an exact target tuple in the app's
  generated binding artifact and a receipt accepted by that artifact's
  admission predicate; the arm has
  no supervisor generation, local delivery channel, port-forward routing, or
  release build receipt. Runtime admission also refuses loopback names
  (`localhost`, subdomains of `.localhost`, IPv4 `127/8`, and IPv6 `::1`) and
  private IP literals (RFC 1918, IPv4 link-local `169.254/16`, IPv6 link-local
  `fe80::/10`, and ULA `fc00::/7`), plus unspecified IPv4/IPv6 addresses
  including `0.0.0.0`, `[::]`, IPv4-mapped `[::ffff:0:0]`, and equivalent
  literal forms, and the complete deprecated IPv4-compatible IPv6 `::/96`
  block from RFC 5156 §2.3. It does not
  resolve or classify DNS names,
  so a DNS-named origin that resolves privately is outside this arm's client-
  detectable guarantees pending packet ruling 6;
- release bindings are tied to an admitted build/deployment receipt;
- `descriptorIdentity` must match the imported `app`;
- an offered capability does not upgrade the descriptor's requirement or LLP
  0064's evidence;
- no secret or application authority appears in the binding;
- **binding integrity.** A supervised-development binding travels only over
  the local supervised IPC channel between `snapback dev --expo` and the provider —
- **supervised browser relay compatibility.** LLP 0030's managed Vite arm may
  carry its same-origin relative relay base (for example `/__snapback`) in the
  legacy-named `target.origin` field. Admission treats that value as a path
  only for a `source: "supervised-dev"`, `routing: "loopback"`,
  `local-supervised-ipc` binding created by the local Vite supervisor; it may
  not contain a host, query, fragment, root path, or trailing slash. Native
  supervision continues to carry its resolved absolute loopback origin, and
  release bindings continue to require an exact absolute HTTPS origin. This
  projection exposes no backend URL and creates no application override;
- **binding integrity.** A development binding travels only over the local
  supervised IPC channel between `snapback dev --expo` and the provider —
  never a network hop, so there is no remote party to authenticate against.
  A hosted-development binding must match an exact target tuple in the exact
  generated `app` artifact and its generated-module predicate must accept
  `provenance.hostedTargetReceipt` before the client adopts `target.origin`;
  local supervised delivery cannot substitute for that generated path. A
  release binding
  must verify through one of `integrity`'s two arms so a substituted binding
  cannot silently redirect a shipped app to an attacker-controlled origin:
  the provider refuses a `signed-artifact` binding whose `signature` does not
  verify against the admitted release trust root, and refuses an
  `embedded-at-build` binding whose `provenance.buildReceipt` does not verify
  — in both cases before adopting `target.origin` for anything, and with no
  third, unverified path; and
- v1 admits no arbitrary hostname or runtime URL override from application
  data or remote configuration. The one exception is the explicit test/
  advanced-multi-target `binding` override prop (§Provider), and its
  admission rule is **not one rule but three, split by `source`** — a round-3
  delta review correctly found the round-2 fix's single rule
  self-defeating: "generated target facts" is, everywhere else in this RFC,
  a build-time set of declared **release** targets (§Release binding); a
  `supervised-dev` binding's `target.origin` is resolved at supervisor
  *runtime* (§iOS simulator: "the binding names the **resolved** loopback
  origin") and can never be a member of that build-time set. Requiring every
  override to match generated target facts therefore closed the
  arbitrary-origin hole but made every `supervised-dev` override
  unsatisfiable too — including the legitimate test/advanced-multi-target
  use this prop exists for. The three arms need different admission proofs
  because they have different trust roots:
  - **`source: "release"` override:** must match the complete `target`
    tuple (`app`, `schema`, `functions`, `origin`, `routing` together)
    against one entry in generated target facts — the same admitted set a
    resolved release binding is drawn from. This is the round-2 fix,
    correct for this arm.
  - **`source: "supervised-dev"` override:** cannot be checked against
    generated target facts at all — the wrong universe, as above. Instead
    it is admitted only if the provider confirms, over the same
    `local-supervised-ipc` channel every ordinary supervised-dev binding
    arrives through, that a currently live `snapback dev --expo` supervisor
    whose `descriptorIdentity` and `provenance.supervisorGeneration` match
    the override actually issued that exact binding. An override therefore
    lets a test *select among* a live supervisor's own issued bindings (the
    legitimate multi-target case — for example, more than one supervisor
    instance running against different simulators) but cannot fabricate an
    origin no running supervisor actually resolved, which is what closes
    the arbitrary-origin path for this arm without disabling it — merely
    matching an app name, the round-1 rule, did neither.
  - **`source: "hosted-development"` override:** must match the complete target
    tuple against the hosted-target set carried by the exact generated `app`
    export, and that module's admission predicate must accept the
    `hostedTargetReceipt`. `admitAppBindingV1` exposes no option for supplying
    either fact. A descriptor JSON without the generated-module record, a
    `local-supervised-ipc` delivery claim, supervisor issuance callback,
    loopback name, unspecified address, private IP literal, or port-forward
    route cannot admit it. DNS-named private origins are not client-detectable
    and remain outside this arm's guarantees pending packet ruling 6.
    This is the representability seam for a development bundle pointing at an
    already-admitted hosted target, not authority to create that target or the
    development-asset carrier that delivered the bundle.

  The provider also refuses a `source: "supervised-dev"` or
  `source: "hosted-development"` override inside a release build's production
  condition, regardless of which admission arm it would otherwise satisfy.

The provider admits the binding — including its source-specific `integrity`
contract — before it
prepares any application stores.

## Package contract

`@expo/snapback-expo` contains:

- the Expo config plugin;
- `SnapbackExpoProvider` and Expo-safe React re-exports;
- binding resolution and admission;
- Expo picker/content-URI adaptation for the existing asset client;
- Expo filesystem, crypto, network, and AppState adapters, each with its
  honest capability grade; and, once LLP 0258 Phase 2 lands, the first-party
  durable custody integration with its own separate grade;
- package/Metro/EAS closure verification; and
- structured boot/diagnostic projections.

It depends only on public client packages. The production graph excludes the
Snapback server, local handler executor, admin/host-ops clients, development
impersonation material, and contributor-source paths.

**Release-export vocabulary — 2026-08-07.** The supervised carrier's endpoint
vocabulary — its exchange path constant, supervisor-origin runtime lookup,
and device-local host literals in both the environment and the `AppBinding`
supervised-development host checks — is gated behind literal
`process.env.NODE_ENV !== 'production'` branches. Production Metro/Hermes
exports therefore prune that vocabulary and leave the supervised environment
inert, matching the provider's refusal of supervised-development bindings
under the production condition. This is verified by
`packages/snapback-expo/release-export-vocabulary.test.mjs`.

Web-only React consumers continue using `@expo/snapback-react`; they do not
acquire Expo peer dependencies.

**Namespace note.** LLP 0041 designates `@snapback/*` as the general
published-package namespace (`@snapback/cli`, `@snapback/runtime-*`), itself
still provisional pending a public-registry collision LLP 0041 records
(`@snapback/cli` is occupied by an unrelated package; a fallback
`@ccheever/snapback-*` mapping is the current staged workaround). This RFC's
`@expo/snapback-expo`/`@expo/snapback-react` names are a distinct
Expo-ecosystem sub-namespace, matching the convention of other
Expo-community-scoped packages, not a claim that they resolve LLP 0041's
still-open general namespace question.

A round-3 review correctly found this note's earlier claim — that these
names "remain a proposal… not an assertion that they already exist on the
registry" — factually wrong: LLP 0171 independently reports an external
Chessfield build already consuming "the published `@expo/snapback-*` 0.1.8
closure." Corrected: **some slice of the `@expo/snapback-*` namespace is
already published** (LLP 0171's 0.1.8 evidence), though this document does
not independently confirm that `@expo/snapback-expo` and
`@expo/snapback-react` specifically, by those exact names, are already
among the published packages versus being this RFC's own proposed additions
to an already-real namespace — that distinction matters for anyone
depending on this RFC's exact names today and is left as an explicit gap
rather than asserted either way.

## Config plugin

The plugin performs deterministic, idempotent configuration:

- registers the generated `AppDescriptor` input;
- installs only native permissions/capabilities demanded by generated app
  requirements;
- registers the package's native adapters and lifecycle integration;
- adds descriptor/plugin/package inputs to build invalidation;
- verifies supported Expo SDK/React Native/package tuples; and
- writes a value-free integration receipt naming every derived change.

It never writes sessions, pairing secrets, admin credentials, or private
target material into `app.json`, `Info.plist`, Android resources,
JavaScript bundles, source maps, receipts, or public EAS configuration.

If Expo's plugin API cannot own a required deterministic change, the packaged
CLI verifies or generates a bounded shim and records that provenance. The user
does not maintain a hand-written alias table, but every change remains
inspectable.

## Provider

`SnapbackExpoProvider` accepts the stable app descriptor:

```tsx
<SnapbackExpoProvider app={app}>
  {children}
</SnapbackExpoProvider>
```

An explicit `binding` override may exist for tests and advanced multi-target
applications, but the common path resolves it from the supervised development
runtime or release artifact.

The provider:

1. obtains one `AppBinding`;
2. verifies its schema, source, expiry/provenance, descriptor identity, target
   identities, protocol, and capability offer;
3. delegates to the common LLP 0258 bootstrap owner, which resolves the
   admitted custody adapter, synchronizes custody or establishes the
   server-witnessed anonymous authority, and adopts a supervised session
   only under 0258 D5's precedence (amended 2026-08-15; formerly
   "separately adopts an ordinary application session");
4. prepares the existing headless/React binding;
5. installs native adapters and lifecycle signals; and
6. exposes a structured boot state.

```ts
type ExpoBootState =
  | { status: "starting";
      stage: "binding" | "custody" | "authority" | "client" }
  | { status: "ready"; binding: PublicBindingFacts;
      preparation: { source: "deployment" | "persisted-receipt" };
      custody: PublicCustodyFacts; authoritySource: AuthoritySource;
      advisories: readonly BootAdvisory[] }
  | { status: "authority-required"; diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[] }
  | { status: "blocked" | "unsupported" | "error";
      diagnostic: SnapbackDiagnostic;
      remediations: readonly TypedRemediation[] }
```

Amended 2026-08-15 (LLP 0258 Phase 0): the construction-status union above is
owned by LLP 0258 D7 (`AuthBootstrapSnapshot`), and `ExpoBootState` embeds it.
Every previous public field is dispositioned, not dropped: the `ready` arm
keeps this RFC's public binding facts and its deployment/persisted-receipt
preparation fact, and its former `authority: PublicAuthorityFacts` projection
is replaced by the LLP 0238 `currentPrincipal` surface — authority is a
principal fact, not a boot-state field. `custody`, `authoritySource`,
`advisories` (`BootAdvisory` is 0258 D7's diagnostic-plus-remediations row),
the `custody` stage, and the `blocked` status take their exact meaning from
0258 D7.

`ready` means descriptor/binding admission, admitted custody
synchronization (durable ordinarily; explicitly volatile only under a
`volatile-explicit` policy, reported as such in custody facts),
coordinator/client construction, and participant exposure have completed
(LLP 0258 D2/D7); it does not assert that the principal is
authenticated, that the transport is currently live, or that retained rows
are current. Whether the principal is anonymous or signed in is the LLP 0238
`currentPrincipal` surface's fact — `ready` may be anonymous. If live
inspection is unreachable but LLP 0114 admits the exact persisted binding
receipt, the provider may be `ready` while `useSurface` reports
`freshness: 'retained'`, `status: 'refreshing'`, and a stale/offline
connection fact.

Amended authority semantics (2026-08-15, LLP 0258 Phase 0). The provider no
longer reports a missing supervised session as failure: for a program whose
auth mode has settled to Sessions, bootstrap always settles the
server-witnessed anonymous state and reaches `ready`, so credential-entry
surfaces are reachable from a cold start. `authority-required` is reserved
for states where no authority can settle for a non-custody reason — the
mint-precondition refusal below (auth mode not settled to Sessions) remains
its canonical case — while `blocked` owns unsettleable custody states
(corrupt, exhausted, LLP 0059 blocked/recovery). Supervised adoption obeys
LLP 0258 D5's closed precedence at boot and on every later supervisor
event: a supervised mint may bootstrap only a fresh or settled anonymous
predecessor admitted through the supervised binding channel; a restored or
application-entered authenticated principal is never displaced by a
supervisor event, which then updates binding/transport facts only and
surfaces `SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` as a `ready`-arm
advisory with executable remediations. `refreshAuthority` is not a bearer
setter on the ordinary path, and `adoptAuthority`'s success contract no
longer treats a missing ordinary session as `authority-required`; ordinary
applications stop calling `adoptAuthority` once 0258 Phase 3 lands (the
method remains on the advanced surface).

For the development golden path, the supervisor supplies an ordinary bounded session
— by email today, by declared dev persona once that layer is accepted (see
LLP 0176 G0) — through a transient local bootstrap exchange over the same
`local-supervised-ipc` channel `AppBindingV1`'s `integrity` field names for
binding delivery. A round-3 review correctly noted this is one label
covering two distinct transports (the binding itself, and separately the
session bearer) that happen to share a channel in the common case but are
not the same delivery guarantee — a future implementation may split them
without that being a breaking rename of one shared concept.

**This channel's actual security design remains genuinely open, not merely
a stated requirement.** §Provider's negative greps (bearer absent from
named artifacts) prove only that a bearer does not land somewhere static;
they say nothing about the live channel's confidentiality, peer
authentication, or resistance to another local process on the same machine
observing or substituting on it. Naming the channel `local-supervised-ipc`
is a label, not a mechanism. This RFC does not claim the channel is secure
— OQ1/OQ2 (below) are the real, unresolved design questions, and E1's
acceptance checks what it can (absence from static artifacts) without
claiming to have checked the channel itself.

This exchange is the automatic, integrated form of LLP 0176 G0's standalone
`snapback session mint --email <address>` primitive (its own eventual
`--dev-persona` layer is a routed, not-yet-accepted ask — see 0176 G0), not a
second mechanism: both wrap the same already-gated `auth.mintSession`
host-op, invoked by a local process that already holds the operator/
impersonation capability, and both return only the minted ordinary session
to the application, never that capability itself. G0 ships the primitive as
an explicit command an author can run by hand before this RFC's supervisor
exists to call it automatically; this section defines only the automation,
not a new issuance authority.

**Precondition this automation inherits, stated here explicitly.** A round-3
review correctly found that `auth.mintSession`'s hard refusal — it requires
the app to already be in settled, available Sessions auth mode, refusing
with `SNAPBACK_AUTH_POLICY_UNAVAILABLE` otherwise — was recorded in 0176's
prose but nowhere in this RFC, even though this section's automatic call is
where the refusal would actually surface. `snapback dev --expo` therefore
does not reach a `ready` boot state for a fixture that has not settled into
Sessions mode: the bootstrap exchange's mint call refuses, and the provider
reports `authority-required` (§Provider's `ExpoBootState`) rather than
silently falling back to anonymous or hanging. E1's acceptance (below) now
tests this explicitly rather than leaving it an unstated precondition a
clean external fixture (E4/G4's own bar) could fail against with no named
cause.

**What is a requirement here, not yet an established property.** A reviewer
correctly found the previous text asserted the exchange "leaves no bearer in
generated artifacts or logs" as a settled design outcome while open question
2 (below) admits the exchange's exact delivery channel is still undesigned —
those two statements cannot both be true. This section states the property
as a **requirement the exchange design must satisfy**, not a fact already
established: the delivery channel must not place the session bearer in
`AppBinding`, bundle source, source maps, Metro logs, or persistent public
configuration. E1's acceptance (below) now includes a check for this
specifically, so the requirement is verified once a design exists rather
than assumed.

## Supervised development baseline

`snapback dev --expo` is an LLP 0041/0171 packaged supervisor profile. It:

- starts or adopts the exact Snapback backend generation;
- starts Expo/Metro in a routing mode compatible with the selected device;
- issues one expiring `source: "supervised-dev"` binding and, after each
  successor graph reaches the backend's `generated-and-loaded` compatible-cut
  event, atomically remints it for the new descriptor identity while retaining
  the supervisor generation and resolved route;
- makes an ordinary session available through the local bootstrap seam —
  today by email, per LLP 0176 G0's primitive; a declared-dev-persona layer
  once the routed ask to the auth owner is accepted;
- waits for backend, Metro, binding, and client readiness;
- emits one correlated readiness/diagnostic stream, printing the LLP 0017
  admin console's launch command alongside it — the three bakeoffs behind
  this program independently spent real time hand-debugging with `curl` and
  host-operations calls because none of them discovered that a browsable
  Data/Functions/Realtime console already existed (LLP 0176 §Beyond the
  golden path); printing it once here is the cheapest fix available in the
  whole program;
- forwards signals and joins child shutdown; and
- removes ports, bindings, bootstrap material, and child processes on every
  exit path.

It does not parse terminal prose, guess a LAN address, commit `.env` files,
or bind the Snapback backend publicly.

### iOS simulator

The preferred route is same-host loopback with Metro restricted to local
development where Expo permits it. The binding names the resolved loopback
origin; application code does not.

### Android emulator

The preferred route is explicit port forwarding such as `adb reverse`, with
a loopback origin from the app's perspective. The supervisor installs,
verifies, and removes the forwarding rule. The Android emulator's reserved
`10.0.2.2` host alias is the fallback posture: it is admitted only with
`routing: "port-forward"`, never as a general private/LAN origin, and it does
not cause the supervisor to create a non-loopback listener.

### Web browser

The web carrier uses the same-host loopback route and the same
`local-supervised-ipc` bootstrap exchange. `--expo-platform web` starts the
default Expo command with `--web` and installs the credential-free supervisor
origin in Metro's environment before the browser bundle is built. LLP 0041's
generic `--client-command` arm remains environment-transparent: routing an
independent `expo start --web` through it does not create or publish the
supervised exchange, and the CLI emits a coded advisory for that recognizable
mistake. The browser CORS, AppState, asset-source, and binding-admission
boundaries remain the package contract; this selection adds no LAN/public
listener or alternate binding format.

The browser director treats readiness as a last-use capability, not a durable
claim about a port. The supervisor descriptor records PID/start-time identities
for the supervisor, Metro child, supervisor front, and upstream Metro listener.
Immediately before Chrome launch, the director re-enumerates the live process
tree and both listener owners and requires those identities to remain
unchanged. The browser-visible origin is the supervisor-owned loopback front
over Metro. That front holds an unguessable run-specific attestation only in
memory and serves it exactly once; no reusable asset or app `public/` mutation
exists. After navigation the director fetches that capability from the
launched page's exact origin over the DevTools channel, then repeats the
descriptor, PID/start-time, process-tree, front-listener, and
upstream-Metro-listener checks. A same-project Metro that takes the upstream
port after the pre-launch check can serve the same application bytes but
cannot survive the post-navigation ownership validation.

Before the CLI starts, the carrier publishes an owner-only durable cleanup
lease and launches an independent detached reaper bound to the carrier's
PID/start-time identity. Each detached workload reserves a resource record;
its launcher atomically records the future PGID and validates its still-live
reservation owner before `exec`, so Metro and Chrome cannot begin in an
unrecorded group. Exact-path records cover the transient readiness descriptor
and browser profile. The reaper reclaims all records on carrier death and
reclaims supervisor-owned groups and paths on supervisor death, independently
of either process's `finally` blocks. The supervisor's parent lease remains the
cooperative fast path. Shutdown owns recorded process groups even after a
leader exits, escalates stubborn descendants, treats failed SIGKILL
reclamation as failure, and the real CLI consumes repeated termination signals
from before `runExpoDev` starts until cleanup has completed.

### Real devices in the baseline

A round-2 delta review correctly found this section orphaned by the
`AppBindingV1` discriminated union fix (§AppBinding v1): the `supervised-dev`
arm admits only `routing: "loopback" | "port-forward"` and
`integrity.channel: "local-supervised-ipc"`, so it cannot represent an iOS
physical-device path to the local backend. Charlie Cheever's 2026-08-15 ruling
adds one different, deliberately narrow backend path: `source:
"hosted-development"` represents a development bundle pointing at an
already-admitted hosted HTTPS target. It does not make the bundle's Metro/asset
delivery a Snapback carrier, and it creates no listener or route composition.

A physical device therefore has two representable hosted-backend paths:
`release` for a release build and `hosted-development` for a development
bundle whose asset carrier is separately admitted. There is still no iOS
development-binding path to the local backend. E5 remains the owner only for a
future accepted physical-device carrier that creates Snapback reachability;
this RFC does not pre-declare that carrier's shape. A LAN Metro relay is not
safe merely because the Snapback backend behind it remains loopback-bound.

The G1/E1 baseline is complete with iOS simulator and Android emulator. This
keeps zero-URL development moving while the harder physical-device network
boundary receives a real design.

**2026-08-06 OQ4 USB follow-on.** Android USB is now a representable extension
of the existing `supervised-dev` `routing: "port-forward"` arm: selection is
fixed to one local USB serial, every rule is installed/verified/removed through
`adb -s`, TCP/IP/mDNS adb serials refuse as network reachability, and readiness
names `device.serial` plus `device.class`. This creates no new host listener and
does not change the binding source.

The equivalent iOS extension remains unbuilt after a concrete tooling probe.
Xcode `devicectl` 518.33 has device discovery/install/process commands but no
TCP forward. libimobiledevice's `iproxy` binds a host-local port and forwards
host-initiated connections to an iOS service; the required direction is the
inverse, from the app's device-local `127.0.0.1` to the host's loopback-only
backend/Metro/bootstrap listeners. Treating those as equivalent would make the
first live receipt fail by construction. The supervisor accepts `--ios-udid`
only far enough to distinguish USB from `localNetwork`, then emits
`SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE` without starting owned
children. A bounded device-side bridge or a separately authorized posture must
precede iOS physical-device evidence.

## Hosted development binding

The `source: "hosted-development"` arm represents exactly one composition:
a development bundle, delivered by a separately admitted asset carrier,
pointing at an already-admitted hosted Snapback HTTPS target. Resolution is
closed over the application's generated artifact set: the complete target tuple
must match the hosted-target facts carried by the exact generated `app` export,
and that binding module's admission predicate must accept
`provenance.hostedTargetReceipt`. A missing generated-module record, a target
miss, or a negative predicate result refuses.

Codegen obtains that immutable record from the closed
`hostedDevelopmentTargets` rows in `codegen.policy.json`. Each row declares
only a canonical hosted HTTPS `origin` and its already-admitted
`hostedTargetReceipt`; codegen derives `app`, `schema`, `functions`, and
`routing: "https"` from the generated descriptor, binds the receipt predicate
to that complete tuple, freezes the target set and verifier, and installs the
record non-enumerably before freezing `app`. The receipt is public provenance,
not application authority or a secret. Omission emits an empty set whose
predicate admits nothing; a module with no record remains an integrity refusal.

The framework-neutral `createSnapbackAppClient` path does not treat a receipt
string or channel label as proof. A legitimate hosted-development raw-client
flow imports `app` from the codegen-emitted binding module, calls
`admitAppBindingV1(candidate, app)` with no hosted-evidence options, then passes
the **exact returned binding object** into `createSnapbackAppClient`. The
admission owner reads the module's non-enumerable generated record; loading only
`app.descriptor.json` or passing caller-chosen `generatedHostedTargets` and a
verifier cannot substitute for it. The raw parameterized helper is absent from
the client package's exported subpaths; Expo owns a relative, package-private
handshake module omitted from its `exports` map. Before the receipt predicate
can await, admission snapshots the complete candidate into a plain frozen
record. Generated-target matching, predicate verification, the ephemeral mark,
and the transport origin all derive from that snapshot; a live getter cannot
change the adopted origin after verification. Serialization, cloning, or
reconstruction drops the mark and refuses before transport I/O. Expo follows
this same handshake after environment resolution.

This is a process-local protocol boundary, in the same register as the client
custody limits: it binds hosted-development clients that follow the app's
generated artifact path. It is not protection against JavaScript already
running in the same process constructing its own module record, mutating
pre-freeze objects, importing lower-level clients, or bypassing the generated
path entirely. Such same-process bypass is outside this arm's threat model,
just as LLP 0055's agent-custody protocol does not claim protection against a
malicious process already operating inside its OS-user boundary. The word
"admission" here means generated-set membership plus the generated predicate;
it does not claim an unforgeable JavaScript identity.

This arm does not start or adopt a local backend, Metro, bootstrap exchange,
listener, tunnel, relay, or port forward. It does not use
`local-supervised-ipc`, invoke supervised session adoption, accept loopback
names, unspecified addresses, or private IP literals, or become valid in a
production release condition. The client classifier performs no DNS lookup: a
DNS-named origin that resolves to private-network addresses is outside this
arm's guarantees pending packet ruling 6. Application authority comes from the
ordinary auth owner at the already-hosted target. The arm says nothing about
whether the separate development asset carrier is supported; that carrier
keeps its own admission and evidence.

## Release binding

For EAS/release builds, generation selects a declared Snapback target for the
chosen build environment/channel and embeds or packages a
`source: "release"` binding.

Selection is closed:

1. an explicit build-time target name that exists in generated target facts;
2. the descriptor-associated default for the current admitted EAS
   environment/channel; or
3. refusal.

There is no fallback to localhost, a remembered supervised binding, or an
arbitrary `EXPO_PUBLIC_SNAPBACK_URL`. Advanced runtime target switching is a
separate feature and must preserve descriptor/target identity and authority
partitioning.

The selected binding and descriptor digests enter the release receipt. An OTA
update with incompatible binding, descriptor, native adapter, or capability
requirements is refused under LLP 0105 rather than failing on device.

## Metro and package closure

Before local Metro starts and before EAS submission, the verifier checks:

- exactly one compatible copy of each Snapback public client package;
- React Native/export-condition resolution;
- descriptor, binding, plugin, and package version compatibility;
- fresh same-version descriptors from both authoring profiles pass the Expo
  closed-schema admission (including required `authoringProfile`);
- every generated client `.mjs` passes the shipped Expo tuple's actual
  Metro/Hermes transformer, so unsupported ESM alias grammar cannot hide behind
  Node-only parsing;
- absence of server/admin/contributor-only imports from the app graph;
- inclusion of every local package and generated artifact in the EAS archive;
  and
- the monorepo/nested-app root selected by the build.

A failure names the package, selected resolution path/version, expected fact,
and an LLP 0146-compatible remediation. A clean consumer should never need an
undocumented Contract override, Metro alias, or staging copy.

The verifier must work for public registry packages and intentional local
development packages. It must not silently replace one with the other.

## Native adapters

The package registers the strongest available adapters once, but each adapter
is independently discoverable and graded. The list below is the target package
contract, not a claim that every row already ships:

- picker/content-URI to the existing structural asset source;
- secure ordinary-session custody — integrated through LLP 0258's
  bootstrap owner, never registered as an independent package custody
  path (E2C below);
- cryptographic digest/checksum support;
- AppState and network lifecycle;
- retained query storage; and
- any later durable source/settlement adapters.

Capability claims remain independent. Retaining query state does not prove
durable mutation settlement, source-byte custody, background upload, or offline
asset command. The provider reports each grade and LLP 0180 refuses claims it
cannot support.

The native auth storage-partition digest is one of those independent adapter
facts. The Expo provider resolves `expo-crypto` and projects only a
`snapback.sha256-digest.v1` adapter into LLP 0258's common application-client
owner. That owner retains the canonical transcript and UTF-8 encoding, so
WebCrypto, iOS, and Android hash byte-identical inputs. The adapter never
projects `getRandomValues`, random UUIDs, or another CSPRNG fact. An absent or
unlinked native module refuses as
`SNAPBACK_AUTH_BOOTSTRAP_DIGEST_MODULE_UNAVAILABLE`; a resolved module whose
digest call fails or returns a non-32-byte result refuses as
`SNAPBACK_AUTH_BOOTSTRAP_DIGEST_FAILED`; existing secure-randomness operations
continue to refuse independently as `SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING`.
None of these paths creates an Expo-only custody or session store.

LLP 0180 v1 uses an ordinary session for asset transfer. This package does not
depend on an attempt grant. A later background adapter may consume one only
after LLP 0044 defines it.

### E2C — restart-persistent ordinary-session custody (owned by LLP 0258)

E1/E2 currently adopt the supervisor-issued bearer into the live
`SnapbackClient`; provider replacement follows the normal authority barrier,
but the bearer is not restored after the JavaScript process dies. That is
ordinary in-process session custody, not secure restart-persistent custody.
The package MUST NOT describe the current memory fallback as SecureStore or as
surviving process restart.

Restart-persistent ordinary custody for Expo/native is owned by Accepted
LLP 0258, and this RFC defers to it rather than pinning its own adapter:

1. The durable carrier is LLP 0258 D3's first-party native custody module —
   the entire LLP 0059 custody record (`AuthCustodyV2`, bearer included)
   persisted as one serialized unit in one OS-secure-storage domain, with
   native atomic compare-and-replace conditioned on the exact expected
   revision/epoch and fail-closed per-platform capability declarations
   (single-runtime where cross-process fencing is unproven). An injected
   `expo-secure-store` `getItemAsync`/`setItemAsync` adapter — including the
   shipped process-local
   `@expo/snapback-contract/auth-custody-secure-store` adapter — is a
   secret-persistence component that 0258 D3 explicitly rules insufficient
   as the transactional first-party carrier; it neither satisfies nor
   pre-implements this slice.
2. Selection, refusal, and grading follow 0258 D3: `durable-required` never
   falls back to memory; a platform that cannot prove even the
   single-runtime profile keeps `durable-required` refused; capability
   reporting states carrier kind, durable/volatile grade, and exact
   concurrency scope per LLP 0064.
3. The Expo integration point is 0258 D6 and its Phase 2: the provider
   delegates to the common bootstrap owner, which resolves the platform
   custody adapter. This package registers no independent custody path, and
   no second bearer copy is written to the binding cache, RQS file store,
   `AsyncStorage`, logs, diagnostics, receipts, or generated configuration.
4. E2C in this RFC's delivery plan is therefore the 0181-side integration
   slice: adopting the 0258 bootstrap owner in `SnapbackExpoProvider`
   (0258 Phases 2–3) together with the boot-state and supervised-precedence
   amendments in §Provider. Its acceptance evidence — iOS process-kill and
   Android force-stop restoration receipts, corruption/logout/user-switch
   behavior, and package-closure/leakage scans — is recorded under 0258's
   phases and is not duplicated here.

Where the 0258 module uses SecureStore/Keychain/Keystore-class protection,
that means platform-protected ordinary bearer bytes at rest. It does not
mean hardware-bound proof, non-extractability, attestation, resistance to
code executing as the app, or sender constraint. Draft LLP 0260 owns those
stronger claims.

## Diagnostics

The provider and supervisor join facts by a correlation id and expose:

- backend/Metro readiness and generation;
- descriptor/binding/target compatibility;
- selected route (`loopback | port-forward | https`);
- public authority state without bearer material;
- capability and per-OS gaps;
- package/archive closure;
- the LLP 0017 admin console's launch command, so "what is my backend
  actually doing" has a one-line answer instead of a hand-rolled `curl`
  session;
- lifecycle and child-state summaries from their canonical owners; and
- LLP 0146 typed remediations with preconditions and risk classes.

An external-session shell that constructs its own client also supplies the
selected origin from a ready descriptor or stack-owned carrier. After LLP
0114's persisted binding-receipt fallback declines a transport failure,
binding preparation wraps the browser's opaque fetch error with a stable code,
the attempted origin, and the `application-binding-preparation` phase. A
server-answered credential or policy refusal is not connectivity and keeps its
original diagnostic.

The Expo overlay is a projection of shared diagnostic codes/details. It does
not rewrite them into an Expo-only taxonomy or automatically apply
authority-widening, principal-changing, destructive, or stale repairs.

## Physical-device LAN relay: separately gated

A Metro listener reachable on a local network is a network front. Forwarding
application routes through it makes those routes reachable even if the
Snapback backend itself listens only on loopback — and LLP 0168's own
established finding sharpens why: a server whose profile is derived from its
own bind (loopback → `dev`) has no way to see an undeclared front sitting in
front of it, so "the backend is loopback-bound" proves nothing about what a
LAN-reachable Metro is actually exposing behind it. Ordinary session checks
protect application authorization, but they do not by themselves protect
session confidentiality over plaintext or prevent route/origin/proxy defects.

Therefore a LAN relay is not part of E0–E4 acceptance, and this section's
requirements are corrected against the actual current governing document.
**Citation correction:** an earlier revision of this RFC cited
`0168-single-origin-dev-edge.rfc.md`; that RFC never landed — three
super-refine rounds found a new bypass in its dev-auth model each round, and
it was superseded by the current `llp/0168-browser-carrier-dev-edge.research.md`,
which states "no edge decisions from that draft survive" except one narrow
policy-sharing boundary. The current LLP 0168's own recommendation, as
written, is **do not build a LAN/tunnel dev edge on the present record**.
LLP 0168's A1 is now explicitly scoped to the browser carrier that Research
studied. A native Metro/Expo physical-device carrier is a different carrier
whose demand precondition must be stated by its own future owner, using the
native alternative set; it cannot satisfy or fail the browser-shaped A1 by
implication. The 2026-08-15 ruling nevertheless keeps the successor-RFC gate
closed on A3 grounds for the route-composing iOS carrier. Any future owner must
state its own A1 and still supply reviewable A2/A3 answers before opening the
successor RFC; the running-code B1–B5 proof still precedes acceptance. This
RFC's E5 starts only after that eventual successor reaches Accepted. The
`hosted-development` arm above is outside this gate because it creates no
Snapback listener, front, or route composition. The bullet list below is this
document's own best current restatement of the future edge bar, not authority
to implement it:

- secure transport or an equivalently reviewed confidentiality/integrity
  channel for session-bearing traffic;
- one generated route-admission artifact shared with every development front,
  never a hand-copied allowlist;
- exclusion of admin, host-ops, provisioning, reset, manifest load,
  impersonation, and arbitrary upstream paths/hosts;
- exact method, WebSocket upgrade, Host, Origin, redirect, and app/generation
  admission;
- single-use pairing bootstrap, revocation, rotation, replay, and device
  binding;
- value redaction from Metro logs, errors, source maps, and QR/deep links; and
- hostile-LAN tests for route smuggling, cross-app use, replay, downgrade, and
  credential observation.

A QR code is discovery/bootstrap UX, not transport security. An attempt grant
is asset-attempt authority, not a general relay session, and cannot satisfy
this boundary.

**This is not only a future-relay concern.** A reviewer correctly found that
this section's rigor implicitly excluded the *baseline* routing modes: §iOS
simulator and §Android emulator above describe Metro's own reachability only
loosely ("restricted to local development where Expo permits it"), not as a
hard requirement, even though a LAN-listening Metro in the G1-G4 baseline
would expose bundles, source maps, and the bootstrap exchange itself to
every peer on that network — the identical failure mode this section exists
to gate, reached through the baseline instead of a hypothetical future
relay. E1's acceptance below closes this: every listener the supervisor
owns, Metro included, must be verified loopback-bound in the default
baseline, not only asserted as "restricted where Expo permits."

## What remains explicit

The application owner still chooses:

- schema, functions, visibility, auth, and business refusals;
- asset media, privacy, delivery, processing, retention, and byte bounds;
- named hosted/release targets and EAS environment/channel mapping;
- which email-identified dev sessions may be minted today, and which
  declared dev personas may be issued once LLP 0176 G0's routed persona ask
  is accepted;
- offline/background capability requirements; and
- whether to opt into any future reviewed physical-device carrier.

The integration carries those decisions. It does not infer them from Expo
project metadata.

## Non-goals

- A second stable application descriptor.
- A general public development edge, implicit LAN backend bind, or tunnel.
- Serving admin/host-ops/impersonation routes through Metro.
- Bundling the Snapback server or handler runtime into the Expo app.
- Inferring a production endpoint from development state.
- Storing authority inside `AppBinding`.
- Claiming React Native parity from one simulator or Expo Go smoke test.
- Claiming offline/background commands from retained-query storage.
- Automatic EAS account/project provisioning or app-store submission.
- Requiring Expo dependencies in web-only React packages.

## Delivery

### E0 — package and binding

- Publish `@expo/snapback-expo` with config plugin, provider, binding
  admission, boot state, lifecycle shell, and integration receipt.
- Consume LLP 0179's `AppDescriptor`; define no alternative app model.
- Prove a packed clean-room fixture installs only public dependencies and
  excludes server/admin code.

### E1 — simulator/emulator loop

- Land `snapback dev --expo`, expiring supervised bindings, transient local
  ordinary-session bootstrap, and strict shutdown.
- Prove iOS simulator loopback and Android emulator port forwarding without a
  LAN/public backend front. This proof enumerates every listener the
  supervisor owns (backend and Metro alike) and asserts each binds loopback
  only — not merely that the backend does, per §Physical-device LAN relay.
- Grep the JS bundle, source maps, Metro logs, `AppBinding`, and any
  persistent public configuration (`app.json`, EAS config, committed `.env`)
  for the bootstrap exchange's issued session bearer and assert it appears
  in none of them — the complete set §Provider's requirement names, not a
  narrower subset — checking that requirement rather than only stating it.
  The readiness stream is a separate, additional check: it is not covered
  by §Provider's requirement (which only forbids the bearer appearing in
  the five locations above) but should not leak it either, so assert that
  too even though its absence there is this test's own added bar, not a
  restatement of §Provider's.
- Prove the Sessions-mode precondition explicitly (§Provider): a fixture
  not yet settled into Sessions auth mode boots to `authority-required`
  with a diagnostic naming the cause, never a hang or a silent anonymous
  fallback; a fixture that is settled reaches `ready` and completes a real
  mint whose session is adopted under LLP 0258 D5 (amended 2026-08-15: a
  settled fixture whose supervisor supplies no session still boots
  anonymous `ready`; the supervised principal is asserted after adoption,
  not as a precondition of `ready`).
- Exercise live query, ordinary mutation, scoped presence, HMR/reconnect, and
  authority replacement.

**E1 carrier disposition.** The non-secret value Metro exposes is only the
credential-free loopback rendezvous origin
(`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`). The provider performs a runtime
`GET /_snapback/expo/v1/bootstrap` with `cache: "no-store"`; its response pairs
the admitted expiring `AppBinding` with the native mint's ordinary
session, a binding-only arm carrying no session (the provider then boots
anonymous `ready`; a supervised session may arrive on a later supervisor
event), or a structured `authority-required` refusal for the
unsettled-Sessions precondition (amended 2026-08-15, LLP 0258 Phase 0). A
returned session is adopted only under LLP 0258 D5's precedence: over an
application-entered or restored authenticated principal the exchange
updates binding/transport facts only and surfaces
`SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` as a `ready`-arm advisory.
The exchange exists
only for the supervisor lifetime, listens on loopback, emits no access log,
and is reclaimed with Metro and the managed backend. This answers OQ1/OQ2 for
the E1 simulator/emulator baseline without strengthening the security claim:
as §Provider says, the negative greps do not establish confidentiality or peer
authentication against another local process.

E0/E1 complete LLP 0176 G1.

**2026-08-06 E1 USB follow-on delivery note — PARTIAL.** Android USB mechanics
ship with headless fake inventories, emulator/USB/TCP-IP classification,
network refusal, exact per-serial three-rule verification, failure rollback,
idempotent removal, readiness shape, and the existing full simulator cleanup
regression. No Android physical device was attached for this landing, so its
dated LLP 0064 Online receipt remains pending. The iOS half is a typed
non-capability for the tool-direction reason recorded in §Real devices in the
baseline; neither a forward nor a receipt is claimed. The manual checklist is
`demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md`.

### E2 — online asset command

- Register the picker/content-URI adapter and required crypto/session support.
- Prove LLP 0180's one-image command with the same ordinary session on each
  claimed simulator/emulator OS.
- Do not claim background, restart, offline, or attempt-grant behavior.

E2 completes the Expo arm of LLP 0176 G3.

**2026-08-06 E2 delivery note — PASS.** The shipped package registers the
adapter at provider construction, not in application screens: `content://`,
`ph://`, and `file://` picker records become immutable, slice-readable
structural sources for the existing LLP 0044 task. `expo/fetch` owns native
URI conversion and binary HTTP/TUS transport; the narrow Expo 57 Android
picker-cache 404 uses `expo-file-system` `File.bytes()` so its literal error
body cannot be mistaken for the selected image. Integrity stays on the
existing client SHA-256/checksum path, and the already adopted ordinary
session owns reservation, transfer, and mutation custody. Recorded fixtures
test every named URI shape without a device.

The final iOS simulator run selected a task-added image through the system
Photos picker; the final Android emulator run installed an image with `adb
push` plus MediaStore scan and selected it through Android's Photo Picker.
Both used `chat.commands.send({ body, image: picked })`, rendered the resulting
delivery URL, truthfully showed a cancelled negative, and reclaimed all
supervised resources. Evidence:
[`20260806-g3-ios-simulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g3-ios-simulator.md)
and
[`20260806-g3-android-emulator.md`](../demos/expo-golden-path-fixture/receipts/20260806-g3-android-emulator.md).
This proves only the live-process supervised online slice named above.

### E3 — EAS release

- Resolve a closed release binding and verify the EAS archive/package graph.
- Produce independent iOS and Android receipts under LLP 0064.
- Prove OTA incompatibility refusal and absence of development binding,
  bootstrap material, server code, and contributor paths.

### E4 — external-consumer qualification

- Build the LLP 0176 messaging fixture in a clean external Expo repository
  using only published packages, plugin entry, generated app descriptor, and
  the supervised/release binding path.
- Measure setup, first query, first image send, and diagnosis time against the
  bakeoff baseline.

E3/E4 are LLP 0176 G4.

### E5 — optional secure physical-device carrier

A round-3 delta review correctly found the previous text reversed LLP
0168's own sequencing: the time-boxed, named-owner, delete-on-expiry spike
(run under `SNAPBACK_PROFILE=prod` whenever reachable off-loopback, and
subject to LLP 0168's distribution fence — not enabled by default, not
published as a supported path, not documented in the guide, not merged to
the default branch or merged only behind a flag defaulting off) is how LLP
0168's own successor RFC produces its B1-B5 *acceptance* evidence — it runs
*before* that RFC is accepted, not after, and it is that RFC's process, not
E5's. E5 only starts once that successor RFC reaches `Accepted` (which
itself required the spike, under both fences, to have already happened, on
that document's own timeline, to supply the evidence its acceptance
required):

- implement the now-accepted carrier and route-policy artifact as ordinary,
  mainline (non-spike) work — E5 does not itself run a spike; it consumes
  one RFC's finished result;
- prove a real iOS and Android device;
- run the hostile-network and lifecycle matrix; and
- keep hosted HTTPS/USB paths usable independently.

E5 is LLP 0176 G5 and does not block E0–E4.

## Acceptance

- A clean Expo fixture needs no URL prop, manual Metro alias, package override,
  picker bridge, lifecycle effect, TUS header, or backend child-process script
  for the admitted baseline.
- One `AppDescriptor` plus one `AppBinding` is the complete non-secret boot
  input; the provider refuses mismatch before preparing stores.
- Supervised development, hosted development, and release use the same binding
  schema with distinct explicit source/provenance facts.
- Simulator/emulator development does not bind Snapback publicly or depend on
  a LAN relay, and every owned listener — Metro included, not only the
  backend — is verified loopback-bound in the default baseline.
- The dev asset path has an ordinary bounded session; absent authority refuses
  clearly instead of becoming anonymous upload.
- The bootstrap-issued session bearer does not appear in `AppBinding`, the
  bundle, source maps, Metro logs, or persistent public configuration — the
  complete location set §Provider names, matching E1's check — and
  separately does not appear in the readiness stream.
- A release binding's `integrity` is verified before the provider adopts its
  `target.origin`, per its arm: a `signed-artifact` binding refuses unless
  `integrity.signature` verifies against the admitted release trust root; an
  `embedded-at-build` binding — which carries no `signature` field by
  construction — refuses unless `provenance.buildReceipt` verifies through
  the existing build-receipt mechanism. Neither arm falls back to a
  supervised or arbitrary origin on a verification failure.
- A hosted-development binding adopts only an exact HTTPS target in the app's
  generated binding artifact whose module-owned predicate accepts the
  hosted-target receipt. The public admission surface accepts no replacement
  target set or predicate. Missing generated-module evidence,
  local-supervised delivery, a loopback name, unspecified address, private IP
  literal, port-forward target, fabricated raw-client receipt, or production
  release condition refuses. DNS-named private origins remain outside the
  client classifier's guarantees pending ruling 6.
- `snapback dev --expo` reaches one readiness state, survives HMR, remints its
  binding when a function edit rotates the loaded descriptor, proves the new
  digest callable without a supervisor restart, and cleans up every owned
  resource on success, failure, and signal.
- The release graph contains only public client code and the intended release
  binding; no dev secret or endpoint leaks.
- iOS and Android claims have separate LLP 0064 receipts.
- A LAN/physical-device relay is not claimed until E5's accepted security
  proof exists.

## Risks

### Zero configuration could hide configuration

Receipts record every derived input and plugin change. Unknown or ambiguous
target selection refuses instead of guessing.

### AppBinding could duplicate AppDescriptor

Binding stores only environment/target offer and provenance plus the descriptor
identity it admits. It does not repeat surfaces, commands, API declarations, or
app requirements.

### Development convenience could weaken authority

The bootstrap issues an ordinary bounded session (by email today; by
declared persona once that layer is accepted) and is separate from the
public binding. No path treats localhost, Metro, Expo, or debug mode as
authorization.

### A relay could become an accidental public edge

The baseline has none. A future relay is gated by an explicit LLP 0168 design
and hostile-network proof, not bundled into routine Expo work.

### Native adapters could overstate offline support

Capabilities are reported independently. The provider cannot aggregate a few
partial adapters into an unearned “offline” claim.

## Open questions and E1 dispositions

1. **Answered for E1:** Metro carries only the credential-free rendezvous
   origin; the binding itself is fetched at runtime from the transient local
   exchange described in §Delivery E1.
2. **Answered for E1:** the supervisor-owned loopback `no-store` exchange
   delivers the ordinary session alongside the binding. The E1 negative grep
   proves absence from the named static surfaces, not live-channel security.
3. Should release binding be embedded as generated source, an Expo Updates
   asset, or a signed public artifact, and which owner verifies its receipt?
4. **Partially answered 2026-08-06 after the LLP 0176 OQ4 ruling:** Android can
   use the existing supported USB `adb reverse` path and its mechanism ships,
   live receipt pending. Current `devicectl` and `iproxy` cannot provide the
   inverse direction required by iOS device loopback, so iOS remains blocked
   on a device-side bridge or a new author ruling; hosted HTTPS is not silently
   substituted into the LLP 0064 local-device claim.
5. Which initial Expo SDK/React Native matrix is small enough to prove and
   useful enough to publish?

## Status

Review. E0/E1 are implemented as the first slice: the correctly named package, one
`AppBinding`, no-URL provider boot, direct simulator/emulator routing, and the
headless-proven Android USB extension. Its live receipt is pending; iOS USB is
a typed non-capability after the concrete tool-direction probe above.
The 2026-08-15 amendment makes a development bundle against an already-admitted
hosted HTTPS target representable as `hosted-development`; it does not claim or
implement an iOS local-development carrier, Metro/tunnel carrier, or E5 edge.
E2 adds the ordinary-session image command and in-process bearer adoption; it
does not ship restart-persistent custody. Ordinary durable custody is owned
by Accepted LLP 0258 — E2C above is this RFC's integration slice of that
program — and remains unimplemented. Release/external proof follows.
LAN relay, physical-device pairing over that relay, background attempt grants,
and offline custody are explicitly outside the baseline. A super-refine
round-1 review found and fixed: an unestablished "no bearer anywhere"
security claim, an unconstrained binding-override loophole, a struct
`AppBindingV1` shape that let `source` and `provenance` disagree, no
binding-integrity/authenticated-delivery requirement, a stale LLP 0168
citation whose actual current document states a materially different
posture than assumed, and a Metro-loopback gap between this RFC's own
baseline routing text and its stated acceptance criterion.

## Amendment — 2026-08-15 (LLP 0258 Phase 0.3)

Accepted LLP 0258 changes this RFC's owned provider surface on the opted-in
first-party application-auth path. `SnapbackExpoProvider` delegates that path
to the framework-neutral application client instead of constructing a second
auth owner. `ExpoBootState` embeds LLP 0258 D7's `AuthBootstrapSnapshot` as its
construction-status source of truth while retaining this RFC's public binding
facts and deployment/persisted-receipt preparation fact. Principal truth stays
on LLP 0238's current-principal projection; `ready` may therefore be anonymous.

Supervised adoption on this path handshakes into the coordinator through the
ordinary `/auth/session` path under LLP 0258 D5. A supervised mint no longer
auto-adopts over application authority at boot, on a binding remint, or during
`refreshAuthority`: valid durable restored authority wins, a different
supervised principal surfaces as the non-blocking `ready` advisory, and a
same-principal supervised remint rotates only the bearer through the
coordinator. `refreshAuthority` is not a bearer setter on the ordinary path.
The `adoptAuthority` success contract likewise no longer treats an absent
ordinary supervised session as `authority-required`; the anonymous settled
authority remains a successful `ready` outcome.

This amendment is gated by both generated facts: the descriptor carries an
`authBootstrap` fact whose format is
`snapback.application-auth-bootstrap.v1`, and its required capabilities include
`auth.application-bootstrap.v1`. If either opt-in fact is absent, the legacy
non-opted-in provider path retains its prior contract unchanged.

## Amendment — 2026-08-15 (iOS physical-device carrier ruling)

Charlie Cheever accepted the NOT-YET recommendation and topology (c) in
`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`. Packet
ruling 1 is implemented by the `hosted-development` arm specified above:
development bundle, separately admitted development asset carrier, and an
already-admitted hosted HTTPS backend. The arm's generated-target match and
generated-module receipt predicate fail closed, and raw application-client use
requires the exact ephemeral result admitted through the generated `app`
export. The public path accepts neither hosted fact as a free parameter. The
arm refuses loopback names, unspecified addresses, and private IP literals; it
makes no stronger claim for DNS-named private origins pending ruling 6. This
process-local enforcement does not claim protection from same-process code
that bypasses the generated path. It authorizes no listener, tunnel, relay,
port forward, supervisor exchange, or local backend.

Packet ruling 2 places a client pointing at that already-admitted hosted target
outside LLP 0168's front-edge gate. Packet ruling 3 scopes LLP 0168 A1 to its
browser carrier and leaves a native carrier's own A1 to its future owner. The
NOT-YET local iOS nonclaim and A3-closed successor-RFC gate remain in force.
Packet rulings 4–6 — F-A2-4 blast-radius measurement, the Android USB live
receipt, and private-overlay posture — remain visibly open and are not changed
by this amendment.
