---
title: React Expo Online clients
id: clients.react-expo
order: 3
audience: agent-first
capabilities: [clients.react-expo]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0017-admin-console-inspection-surface.rfc.md, llp/0041-packaged-dev-loop.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0181-zero-configuration-expo.rfc.md, llp/0258-first-party-application-auth-bootstrap.rfc.md, llp/0262-dev-identity-custody-capability.rfc.md, packages/snapback-cli/expo-dev.mjs, packages/snapback-cli/templates/expo-chat/App.tsx, packages/snapback-client/app-client.mjs, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-client/rqs-store-default.mjs, packages/snapback-client/rqs-store-expo.mjs, packages/snapback-expo/app-binding.mjs, packages/snapback-expo/asset-source.mjs, packages/snapback-expo/config-plugin.cjs, packages/snapback-expo/index.mjs, packages/snapback-expo/provider-auth-bootstrap.test.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-binding-cache.mjs, packages/snapback-expo/supervised-environment.mjs, packages/snapback-react/index.mjs, scripts/install-local-snapback-packages.mjs, demos/partiful-matrix/tests/acceptance/native-react-expo.mjs, demos/tandem-expo-bakeoff/snapback/scripts/dev-backend.mjs, demos/tandem-expo-bakeoff/snapback/src/backend.tsx, demos/_kit/eas-stage-build.mjs]
examples: [demos/expo-golden-path-fixture, demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md, demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md, demos/expo-golden-path-fixture/receipts/20260806-g4-external-summary.md, demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md, demos/partiful-matrix/native/react-expo, packages/snapback-cli/expo-device-forwarding.test.mjs, packages/snapback-cli/expo-bootstrap-exchange.test.mjs, packages/snapback-cli/expo-dev-loop.test.mjs, packages/snapback-expo/asset-source.test.mjs, packages/snapback-expo/supervised-offline-fallback.test.mjs, packages/snapback-client/webcrypto-fallback.test.mjs, packages/snapback-expo/provider.test.mjs, packages/snapback-react/webcrypto-fallback.test.mjs, packages/snapback-react/cold-boot-binding.test.mjs, packages/snapback-client/rqs-store-expo.test.mjs, packages/snapback-client/rqs-resume-expo.test.mjs, scripts/local-source-package-closure.test.mjs, demos/rn-durable-store-witness/probe-App.tsx, demos/tandem-expo-bakeoff/snapback/src/backend.tsx, demos/tandem-expo-bakeoff/scripts/build-ios-dev-client, demos/_kit/tests/repo-layout-unit.mjs, benchmarks/lanes/native-simulator.md]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:6fee42fc6e5faea23a84b4546d367b3b46bb8116ebf541698f4814695f7c2fc2
---

# React Expo Online clients

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

React Native/Expo uses `@expo/snapback-expo` as the environment facade over
the same `@expo/snapback-client` and `@expo/snapback-react` owners used by
React web. The facade consumes the generated `snapback.app.v1` descriptor,
admits a separate environment binding, projects boot state, and delegates the
provider and hooks documented on [the React client page](./react.md). It is an
**Online** surface: queries and mutations run against a reachable Snapback
backend. It does not execute handlers locally and therefore does not claim
local-first behavior or Parity.

Everything on the React page applies here — this page covers only what is
different on the RN carrier: the boot path, the crypto prerequisites, the
store consequence, the offline queue, and reconnect honesty. In particular,
optimistic mutations work unchanged: for a like/favorite button backed by a
live feed, use [the optimistic toggle recipe](../recipes/optimistic-toggle.md)
rather than component state plus a local counter delta.

<!-- since: 0.1.23 -->
## Add first-party application auth

Pass the generated `app` to `SnapbackExpoProvider`. When its generated
`authBootstrap` requires `auth.application-bootstrap.v1`, the provider opts
into the common application client and exposes `useSnapbackAuth()` plus
`useSnapbackCurrentPrincipal()` over that one owner. Follow the complete
[password application-auth journey](../auth/passwords.md#sign-up-then-sign-in)
for anonymous `ready`, signup and its one-time recovery projection, sign-in,
restoration, sign-out, and user switch.

Expo web has the shipped browser durable-custody evidence. Expo native does
not: `durable-required` remains refused there until Phase-2 iOS/Android
evidence lands, while a disposable native app may declare
`volatile-explicit` without claiming process-death restoration. Keep the
[native threat-model page](../auth/native-apps.md) and
[target-honesty page](../auth/targets.md) in view before changing that policy.

## Install the published Expo path

<!-- since: 0.1.11 -->

For a **new** Expo app, start from the Expo-native `expo-chat` template
instead of assembling packages by hand. In an empty directory nothing is
installed yet, so use a command that carries its own package identity:

```sh
npm create snapback-app my-app
# equivalently: npx --yes create-snapback-app my-app
#               bun create snapback-app my-app
#               pnpm create snapback-app my-app
# scoped CLI spelling, same scaffolder:
#   npx --yes @expo/snapback-cli@0.1.23 new my-app --template expo-chat
```

`expo-chat` is `create-snapback-app`'s default template, so `--template` is
optional here; it ships the conventional `snapback/` backend and the root
file-store/crypto registration described below already wired.

Do **not** reach for the bare `npx snapback new …` spelling before the CLI is
installed. `npx` resolves the unscoped registry name `snapback`, which belongs
to an unrelated third-party package with no `bin`, and the failure is
`npm error could not determine executable to run` — an error that names
neither Snapback nor the package it actually downloaded. The bare `snapback`
bin is correct only once `@expo/snapback-cli` is a dependency of the project
you are standing in, as it is in the existing-app flow below.

When adding Snapback to an **existing** standalone Expo 57 app, install the
package roots that the app imports plus the native file, random, and picker
modules used by the durable image path. Install the five Snapback roots
together so the lock holds one coherent version vector — the newest
published closure is the checked-in record in
[`published-closure.json`](../published-closure.json):

```sh
npx expo install \
  @expo/snapback-cli@0.1.23 \
  @expo/snapback-client@0.1.23 \
  @expo/snapback-codegen@0.1.23 \
  @expo/snapback-expo@0.1.23 \
  @expo/snapback-react@0.1.23 \
  expo-file-system expo-crypto expo-image-picker
```

Use `npx expo install` for the Expo modules; never hand-write or copy an
`expo-file-system` constraint. Expo module versions follow the app's SDK, and
a plausible mismatched version can resolve cleanly while exposing a different
file API. In plain JavaScript that mismatch may appear only when the durable
store tries to publish a rename, leaving the app apparently healthy but on no
working file-backed persistence path. The Expo installer selects the
SDK-compatible versions.

Do not add `@expo/snapback-contract` directly; the client/codegen packages
own their exact Contract edge. Keep one coherent version vector in the lock,
with no `file:`, `link:`, workspace, override, or checkout path. If the app
will register for push notifications, the client's
`@expo/snapback-client/push-installation-expo` subpath is the Expo carrier
for installation storage — see
[Expo push notifications](../backend/expo-push.md).

The CLI has no backend-only initializer — `snapback new` creates a whole
project — so when adding Snapback to an existing blank Expo app, create the
packaged React scaffold in a clean sibling directory and copy its
conventional `snapback/` child into the Expo root before authoring and
generating:

```sh
npx snapback new ../snapback-backend-scaffold --template react
cp -R ../snapback-backend-scaffold/snapback ./snapback
npx snapback generate snapback --json
```

This is the published workflow proved by the external G4 repository; the
extra sibling ceremony is a known scaffold limitation rather than a hidden
`snapback init` command.

A blank Expo TypeScript scaffold includes the whole tree. Snapback's generated
directory also carries provider-neutral Contract source projections that are
not Expo runtime inputs — a broad `include` pulls them into the app typecheck,
where their `@exact/contract/exports` imports fail as an unresolvable module
(that specifier is a generated-projection edge, not a package to install) —
so keep the app check on entrypoints plus generated declarations:

```json fragment reason="external Expo typecheck boundary proved by the G4 receipt"
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true },
  "include": ["App.tsx", "index.ts", "snapback/generated/*.d.ts"]
}
```

This is a typecheck boundary, not permission to hide errors in the imported
descriptor declarations; `npx tsc --noEmit` must still pass.

## Install the Expo facade from this source checkout

For an Expo app nested anywhere under this checkout, run one command from the
Snapback repository root:

```sh
node scripts/install-local-snapback-packages.mjs <expo-app-directory>
```

The command discovers the complete internal runtime closure from the checkout
manifests, packs those exact source packages into the app's generated
`.snapback/local-source-packages/` directory, points the Expo, client, and React
roots plus every top-level override at those local tarballs, and runs the Bun
version pinned by this repository. Commit the app's resulting `package.json`
and `bun.lock`; rerun the same command with `--frozen-lockfile` in CI or after
deleting `node_modules`. The command regenerates the local tarballs before each
install, so do not edit them by hand; treat that directory as generated (and
ignore it in the app's source-control rules). Keep it present when invoking the
out-of-checkout EAS staging helper below so the staged app can cold-install
without reaching back into the repository.

The tarball filenames are content-addressed. On a clean clone, the tracked
manifest and lock may name predecessor archives that are correctly absent from
the ignored directory; rerunning the helper rotates only its own local paths
and integrity records while retaining every unrelated locked package. Do not
work around a missing predecessor archive by deleting `bun.lock` or allowing
Bun to regenerate the registry graph.

Do not add `@expo/snapback-contract` as a direct app dependency and do not
hand-maintain one-off overrides. A local client keeps its own exact Contract
edge, and a nested app is outside the repository workspace, so Bun otherwise
falls through to the registry and can either fail or mix checkout code with a
different published generation. Direct directory links also leave runtime
resolution dependent on symlink behavior; the app-local tarballs install as
ordinary materialized packages and travel with the existing EAS staging copy.
The helper keeps the entire Snapback runtime closure local. Registry installs
remain a separate workflow: use only the published package versions and no
source paths or local overrides there.

For image messages, use the authenticated
[Expo ImagePicker command recipe](../backend/assets.md#send-one-expo-imagepicker-image-with-an-ordinary-session).
It passes the picker asset directly to the typed command and keeps the native
source adapter, upload task, asset id, and attachment sequence behind the
provider-owned client. A client with no real session cannot finish the
multi-request upload under any intent auth mode.

To render the uploaded image, hand `useSnapbackAssetImage`'s `src` straight
to a plain `<Image>` — see
[Render the uploaded image in a plain `<Image>`](../backend/assets.md#render-the-uploaded-image-in-a-plain-image).
Do not build delivery URLs by hand: that section states the URL-selection
rule (most-permissive delivery the asset's policy grants), how the hook
holds the rendition-publication race, and the sessions-mode strict-delivery
diagnostic for images that would otherwise render empty.

## Debug the backend before writing another probe

The generated [admin console](../operating/admin-console.md) is the shipped
browser debugger for an Expo/React backend. Open it while `snapback dev` is
running to browse Data, run and inspect Functions, see Realtime delivery,
and read Errors, Logs, Capabilities, and the build-matched Guide:

```sh
snapback admin --ready-file .snapback/dev.ready.json
```

Use the actual ready-file path printed by your dev process. The console is an
operator surface, not part of the Expo bundle; the command derives a browser
credential without exposing the master admin token. Check it before falling
back to `curl`, raw host operations, or a one-off verification script.

## Run the supervised Expo development loop

<!-- since: 0.1.10 -->

> **Closure-version boundaries.** State these by closure version, not by
> "current" — the newest published closure is the checked-in record in
> [`published-closure.json`](../published-closure.json). The dated 0.1.10
> [external-consumer G4 proof](repo:demos/expo-golden-path-fixture/receipts/20260806-g4-external-summary.md)
> found a runtime-capability and ImagePicker-closure mismatch; 0.1.11
> repairs both. Two further boundaries hold at exactly 0.1.11: current adb
> may label selected reverse rules with a transport token such as
> `host-16`, which the 0.1.11 supervisor rejects, and EAS CLI cannot
> resolve the package-root config-plugin entry. Closures 0.1.12 and newer
> carry both repairs (verified against the published registry bytes).
> Release exports up to and including 0.1.12 retain the supervised
> bootstrap path, origin-symbol vocabulary, and development host literals;
> 0.1.13 and newer gate that vocabulary behind Metro's production
> transform. The LLP 0176 G4 distribution gate itself stays open until a
> successor-closure ceremony rerun lands its receipts
> ([the G4 ticket](repo:issues/closed/20260806-guide-gap-g4-live-0110-external-vector.md)).
> Do not patch `node_modules` or mix source and registry packages to hide a
> boundary on an older closure.

The north-star boot has three application-visible pieces: the config-plugin
entry, the generated `app`, and `SnapbackExpoProvider`. There is no backend URL
prop and no second application model ([LLP 0181 §Config plugin](repo:llp/0181-zero-configuration-expo.rfc.md#config-plugin),
[LLP 0181 §Provider](repo:llp/0181-zero-configuration-expo.rfc.md#provider)).
The working fixture's plugin entry is:

```json source=demos/expo-golden-path-fixture/app.json
    "plugins": ["@expo/snapback-expo"],
```

On 0.1.12 and newer that same root spelling is also what EAS CLI wants: the
package root publishes a CommonJS conditional export resolving to the config
plugin, so `eas init` and EAS project linking accept `"@expo/snapback-expo"`
with no workaround. Only on 0.1.11 exactly does EAS's resolver find no root
target — `expo config` still accepts it there — and only there do you need the
always-exported subpath instead:

```json fragment reason="0.1.11-only EAS compatibility spelling proved by the G4 receipt"
    "plugins": ["@expo/snapback-expo/app.plugin"]
```

The subpath is retained on every newer closure, so it stays valid; it is no
longer required.

Its application root mounts the provider with the generated descriptor and an
optional boot-state fallback, still with no URL or binding prop:

```tsx source=demos/expo-golden-path-fixture/App.tsx
export default function App() {
  return (
    <SnapbackExpoProvider app={app} fallback={(state: ExpoBootState) => <BootFallback state={state} />}>
      <G2DemoProvider><G2Screens /></G2DemoProvider>
    </SnapbackExpoProvider>
  );
}
```

The packaged provider owns one custody identity and intentionally exposes no
per-call `userId`. That means a **dev-auth, multi-persona switcher does not
compose with `SnapbackExpoProvider`**: dev auth is client-asserted, but the
provider has nowhere safe to put a different acting user for each call. Use
sessions mode and adopt a separate ordinary session for each test persona when
the app needs product-shaped multi-persona behavior. The checkpoint-era
`useSnapbackQuery({ provider, query, userId })` bridge in an older demo is a
test-era workaround, not the packaged path.

From an Expo app whose backend is the conventional `snapback/` child, select
the supervised carrier explicitly (iOS remains the default when the platform
flag is omitted):

```sh
snapback dev snapback --expo --expo-platform ios
snapback dev snapback --expo --expo-platform android
snapback dev snapback --expo --expo-platform web
```

Ignore both local-state forms before copying, staging, or archiving the app;
the sibling restore lock records an absolute target-instance reservation and
is not portable between hosts:

```gitignore
.snapback/
*.snapback.restore.lock
```

Every scaffold template ships both rules, so an app started from
`npm create snapback-app` already has them; add them by hand only when
retrofitting an existing Expo app.

Use `--expo-dir`, a positional backend directory, `--email`, or
`--android-serial` only when the project layout or selected emulator requires
it; the fixture README gives the full source-checkout commands
([runnable fixture](repo:demos/expo-golden-path-fixture/README.md)).

### Know what the supervisor owns

One supervisor starts or adopts the exact backend generation, starts Metro,
issues an expiring `source: "supervised-dev"` binding, mints an ordinary
session, and verifies the backend, Metro, and bootstrap listeners before
reporting readiness. It also owns signal forwarding and reclaims the backend,
Metro, bootstrap exchange, binding material, and port forwards on exit
([LLP 0181 §Supervised development baseline](repo:llp/0181-zero-configuration-expo.rfc.md#supervised-development-baseline),
[`runExpoDev`](repo:packages/snapback-cli/expo-dev.mjs)).

When a watched backend edit reaches `generated-and-loaded`, the supervisor
reads the successor `app.descriptor.json` and remints the binding for that exact
descriptor identity while keeping the same supervisor generation and route.
The next bootstrap exchange therefore admits the new generated client without
restarting `snapback dev --expo`; the dev-loop test changes `functions.mjs`,
boots that successor digest, and calls it against the still-running backend.

`--expo` and `--client-command` are different lifecycle arms. The generic arm
runs the command in the caller's environment; it does not install
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` or publish the supervised bootstrap
exchange. Therefore this plausible command is not equivalent to the web
selection above:

```sh shell-check=skip class="anti-pattern" reason="deliberately unsupported generic-arm example contains nested Expo flags"
snapback dev snapback --client . --client-command "expo start --web"
```

A recognizable `expo start` routed this way emits
`SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED` with the exact supported alternative.
Use the generic arm for independently configured clients; use `--expo` whenever
`SnapbackExpoProvider` should discover the supervisor without an app-authored
origin.

When Metro's file watching is inert — `CI` truthy in the effective Metro environment, or the project under a watcher-blind root such as `/private/tmp` — the supervised readiness stream carries one advisory `SNAPBACK_EXPO_METRO_WATCH_INERT` event naming the condition and the fix, so a stale bundle is not misread as an application bug. The same code is also printed as an advisory, not a refusal, on every `snapback dev` invocation when the CLI process itself has a truthy `CI`, including unsupervised `--client-command` launches: if you start Metro or Expo yourself, do not inherit `CI=1`; unset `CI` or pass `CI=0`.

Metro receives only the credential-free rendezvous origin. At runtime the Expo
facade performs a `GET /_snapback/expo/v1/bootstrap` with `cache: "no-store"`;
the loopback-only response pairs the expiring binding with either an ordinary
session or a structured authority refusal. The exchange has the supervisor's
lifetime and is reclaimed with the other children
([LLP 0181 §Delivery E1, "E1 carrier disposition"](repo:llp/0181-zero-configuration-expo.rfc.md#e1--simulatoremulator-loop),
[supervised environment](repo:packages/snapback-expo/supervised-environment.mjs)).
LLP 0181's E1 acceptance requires the bearer to remain absent from the named
static/public surfaces; the retained receipt JSONL scans additionally establish
its absence from the readiness stream. Neither fact proves confidentiality or
peer authentication against another local process.

Dev-mode client assertion has a second, separate per-boot `sbdev_` capability.
For supervised iOS simulators and Android emulator/USB targets, the supervisor
reads `devIdentityCapabilityFile`, issues a one-shot startup-nonce-bound
checkout nonce through the native-only launch channel, and the Expo facade
redeems it into private client custody. The nonce and bearer are removed from
Metro and Expo web environments; Expo web receives no capability through the
browser bootstrap and needs a relay-stamping front for dev identity, while its
ordinary supervised sessions path is unaffected. LLP 0262 stage 1 still
accepts an absent capability with the server's once-per-boot warning; a
presented invalid capability is refused now, and enforcement waits for the
acceptance suite to witness every supported carrier.

### Settle the backend into Sessions mode first

The automatic mint inherits the native `auth.mintSession` precondition: the
app must already be settled and available in Sessions mode. The fixture does
this in its [schema](repo:demos/expo-golden-path-fixture/snapback/schema.mjs).
If that precondition is absent, the mint refuses and the provider reports
`authority-required` with the native diagnostic; it never hangs or silently
continues as anonymous. See [Sessions and principals](../auth/sessions-and-principals.md)
for the mode transition, and [LLP 0181 §Provider](repo:llp/0181-zero-configuration-expo.rfc.md#provider)
for the provider state contract.

### Diagnose a binding identity mismatch

`SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` means the imported
`AppDescriptor` and the delivered `AppBinding` name different descriptor
identities. Stop any older supervisor, regenerate the conventional
`snapback/generated/` app from the backend you intend to run, and let the
active supervisor observe its `generated-and-loaded` event. Restart only when
the mismatch came from a different or stale supervisor rather than a watched
edit. Do not overwrite the identity, construct a second
descriptor in application code, or weaken admission: the refusal prevents a
client generated for one backend shape from being bound to another.

### Choose simulator, emulator, or USB routing

| Carrier | Route selected by the supervised baseline | What stays loopback-only |
| --- | --- | --- |
| Expo web | Same-host loopback; `--expo-platform web` starts Expo with `--web` and injects the bootstrap origin before bundling. | Backend, Metro/web, and bootstrap exchange. |
| iOS simulator | Same-host loopback; the binding and Expo origin use `127.0.0.1`. | Backend, Metro, and bootstrap exchange. |
| Android emulator | Preferred: one verified `adb reverse` rule for each of the backend, Metro, and bootstrap ports, so the app still addresses `127.0.0.1`. Fallback: the emulator-only `10.0.2.2` host alias under `routing: "port-forward"`. | Every host listener. The fallback is routing posture, not permission to bind on LAN. |
| Android USB device | Select the exact USB serial with `--android-serial`. The supervisor classifies the `adb devices -l` row, rejects TCP/IP/mDNS adb, and installs/verifies/removes the same three `adb -s <serial> reverse` rules under `routing: "port-forward"`. | Every host listener. The USB mechanism is headless-proven; its live LLP 0064 Online receipt is pending. |
| iOS USB device | `--ios-udid` enumerates physical devices with `xcrun devicectl` and rejects network transports. The current command then refuses with `SNAPBACK_EXPO_IOS_USB_REVERSE_FORWARD_UNAVAILABLE`: `devicectl` 518.33 has no TCP forward, while `iproxy` forwards Mac-to-device, the wrong direction for device loopback-to-Mac. | No listener or forward is created. A device-side bridge or a new author-approved posture is still required. |
| Tunnelled Metro plus tunnelled backend (**not a carrier**) | No supervised route is selected. A tunnel adds reachability; it does not admit the Metro asset path, the backend target, or their composition. | Nothing is newly guaranteed loopback-only: a front can make a loopback listener remotely reachable while the server still sees its loopback bind. Treat this as an unsupported workaround, per [Targets — a public tunnel does not make the loopback server production-ready](../auth/targets.md#a-public-tunnel-does-not-make-the-loopback-server-production-ready). |

The separate `source: "hosted-development"` binding arm represents only a
development bundle pointing at an already-admitted hosted HTTPS backend. It
does not admit, create, or supervise the Metro/development-asset carrier, so a
tunnel does not become a carrier by being paired with that arm. Admission
refuses `localhost`/`.localhost` names, IPv4 `127/8`, IPv6 `::1`, RFC 1918 and
link-local IP literals, IPv6 link-local/ULA literals, and unspecified addresses
such as `0.0.0.0`, `[::]`, and IPv4-mapped `[::ffff:0:0]`, plus the deprecated
IPv4-compatible IPv6 `::/96` block. This is deliberately not a DNS
private-network classifier: DNS-named origins that resolve privately remain
outside the client arm's guarantees while carrier ruling 6 is open.

Declare each already-admitted hosted development origin and its public receipt
identity in the closed `hostedDevelopmentTargets` array in
`snapback/codegen.policy.json`, then regenerate. Codegen derives the app,
schema, functions, and HTTPS routing fields and installs the frozen target set
and target-bound receipt predicate non-enumerably on the generated `app`.
Omitting the array emits an empty set that admits no hosted target; stale
generated modules with no admission record fail integrity validation. The
receipt is provenance, not an application bearer or other secret.

The raw `createSnapbackAppClient` constructor does not accept a receipt string
as proof. Import `app` from the codegen-emitted binding module, call
`admitAppBindingV1(candidate, app)`, then pass the exact returned binding object
to the constructor. Admission takes the hosted-target set and receipt predicate
only from that generated `app` export; loading the descriptor JSON or passing
caller-chosen replacements refuses. No raw parameterized admission helper is
exported from the client package; the Expo handshake is package-private.
The handshake takes one plain frozen snapshot before its receipt predicate can
await; target matching, verification, marking, and transport all use that
snapshot, so a live getter cannot swap the origin after verification. Cloning,
serializing, reconstructing, or hand-building the returned binding drops its
in-process admission and refuses before any request is made.
`SnapbackExpoProvider` performs this handshake for its resolved environment
binding.

This is a process-local client contract, not an unforgeable JavaScript security
boundary. It binds callers that use the application's generated artifact path;
same-process code that manufactures its own module record or bypasses the
generated client path is outside this arm's threat model.

These routes and their cleanup are the closed iOS/Android branches in the
[supervisor](repo:packages/snapback-cli/expo-dev.mjs),
[LLP 0181 §iOS simulator](repo:llp/0181-zero-configuration-expo.rfc.md#ios-simulator),
and
[LLP 0181 §Android emulator](repo:llp/0181-zero-configuration-expo.rfc.md#android-emulator).
The final readiness event reports `device.serial` and `device.class` alongside
the unchanged binding `source: "supervised-dev"`; Android USB remains
`bindingRouting: "port-forward"`. Device selection is exact and ambiguity
refuses rather than allowing adb to choose whichever target happens to be
first.

Closure 0.1.11 exactly has one current-adb compatibility boundary: a
selected-device `adb reverse --list` row may begin with a transport token
such as `host-16` instead of echoing `emulator-5554`. The 0.1.11 supervisor
mistakes that token for the selected serial and refuses after installing its
rules, so an unmodified 0.1.11 Android supervised run on an affected adb
fails with `SNAPBACK_EXPO_ADB_REVERSE_FAILED`. Closures 0.1.12 and newer
treat the already `adb -s <serial>`-scoped listing as belonging to the
selected device and verify its device/host port pairs independently of the
transport label.

Supervised binding admission tolerates at most 60 seconds of the host issuer's
clock running ahead of the simulator/emulator clock. Expiry remains strict; a
larger skew refuses with `SNAPBACK_APP_BINDING_NOT_YET_VALID`, in which case
fix the clocks and restart the supervisor.

### Run the supervised loop on Expo web

Run `snapback dev snapback --expo --expo-platform web` to serve the Expo
**web** carrier without app-authored proxies or shims. The selection launches
Expo with `--web`; unlike pressing `w` in an independently started Metro
process, it establishes the supervised bootstrap first. Three
package-level paves make this work; each keeps its existing security or
custody boundary:

- **The bootstrap exchange serves CORS to loopback browser origins only.**
  A page served from `http://localhost:<port>` (Metro web) can complete the
  `GET /_snapback/expo/v1/bootstrap` cross-origin: the exchange echoes
  admitted `Origin` values with `Vary: Origin` and answers `OPTIONS`
  preflight, scoped exactly like the local dev CORS lane in
  [`src/server.rs`](repo:src/server.rs). Origin admission stays the
  boundary — non-loopback origins are never echoed, and the listener itself
  stays loopback-bound
  ([`startBootstrapExchange`](repo:packages/snapback-cli/expo-dev.mjs),
  [CORS coverage](repo:packages/snapback-cli/expo-bootstrap-exchange.test.mjs)).
- **AppState resolution is web-safe by default.** The provider resolves its
  lifecycle source through the conditional `#app-state` module: real React
  Native keeps the deep `react-native/Libraries/AppState` import, web
  resolves `AppState` from `react-native-web`, and hosts with neither refuse
  with `SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED`. The
  `createSupervisedExpoEnvironment({ appState })` / `resolveAppState`
  injection remains the override for advanced shells.
- **The picker asset adapter accepts browser sources.** A web
  `expo-image-picker` selection — a `blob:` URI, an asset carrying a `File`,
  or a direct `File`/`Blob` — reaches the same structural-Blob upload source
  as the native `content://`/`ph://`/`file://` branches
  ([adapter tests](repo:packages/snapback-expo/asset-source.test.mjs)).

On web the client store resolves the browser IndexedDB arm (see
[the React client page](./react.md)); `registerExpoFileSystemRqsFiles` is a
native-only registration. Calling it at module scope on web throws before
React mounts and leaves a white screen, so the platform guard below is
required. These paves are proven at
package level (CORS, resolution, and adapter tests named above), and the
diary 0068 web lanes collected the end-to-end Expo-web supervised receipt
from the published packages
([`issues/closed/20260807-supervised-expo-web-carrier-unpaved.md`](repo:issues/closed/20260807-supervised-expo-web-carrier-unpaved.md)).

### Keep the proof boundary visible

The runnable example is
[`demos/expo-golden-path-fixture`](repo:demos/expo-golden-path-fixture/README.md).
Its independent
[iOS simulator receipt](repo:demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md)
and
[Android emulator receipt](repo:demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md)
prove provider readiness, ordinary Sessions authority, a seeded live query,
an ordinary mutation returning through that query, loopback listener
enumeration, and complete supervisor cleanup. Together they complete the LLP
0176 G1 simulator/emulator exit.

This supervised loop still makes **no LLP 0064 physical-device claim**. The
Android USB mechanism has shipped with fake-inventory, exact forward,
verification, rollback/removal, and readiness-shape tests, but no live device
receipt exists. The iOS USB mechanism is not shipped: the tooling probe ruled
out `devicectl` and `iproxy` for the required reverse direction. The
[manual Online receipt checklist](repo:demos/expo-golden-path-fixture/receipts/physical-device-online-checklist.md)
keeps both facts explicit and must not be cited as a receipt. LAN/tunnel edges
remain separately gated; release bindings and per-OS release acceptance use
the separate path later on this page
([LLP 0181 §Real devices in the baseline](repo:llp/0181-zero-configuration-expo.rfc.md#real-devices-in-the-baseline),
[LLP 0181 §Release binding](repo:llp/0181-zero-configuration-expo.rfc.md#release-binding)).
Tests and advanced multi-target shells may inject a
`SnapbackExpoEnvironmentV1`, but its binding still passes the same
source-specific admission.

## Use the low-level provider when you own environment wiring

A native app carries an adopted external bearer (see
[auth/native-apps](../auth/native-apps.md) for how a trusted broker mints it —
never embed admin authority in the app). A shell that bypasses
`SnapbackExpoProvider` owns origin propagation too. The selected target's
ready descriptor or a stack-owned broker/configuration carrier must supply the
origin; never retain an incidental fixed fallback. Tandem's tested local
broker returns the selected public origin with the ordinary bearer:

```tsx source=demos/tandem-expo-bakeoff/snapback/src/backend.tsx
      const brokerPayload = await brokerResponse.json() as { bearerToken?: string; serverOrigin?: string; error?: string };
      if (!brokerResponse.ok || !brokerPayload.bearerToken || !brokerPayload.serverOrigin) {
        throw new Error(brokerPayload.error ?? 'The local Tandem identity broker refused session entry.');
      }
      activeServerOrigin = brokerPayload.serverOrigin;
      const client = createExternalSessionClient(brokerPayload.serverOrigin, { bearerToken: brokerPayload.bearerToken });
      const binding = await client.prepareReactBinding({
        generatedManifest: { schema, functions, capabilityManifest },
      });
```

The broker source derives `serverOrigin` from the same selected runtime target
that minted the session. A ready-file-driven harness uses
`readyDescriptor.serverUrl` for the same reason. The generated
`snapback.app.v1` descriptor is the preferred binding input [the React
page](./react.md) teaches; the older
`{ schema, functions, capabilityManifest }` manifest carrier remains
admitted for compatibility.

If the selected origin is unreachable and no persisted binding receipt can be
admitted, `prepareReactBinding` rejects with
`SNAPBACK_REACT_BINDING_ORIGIN_UNREACHABLE`. Its diagnostic details carry
`phase: "application-binding-preparation"` plus `attemptedOrigin`, so a UI can
separate backend reachability from credential rejection without parsing
`Failed to fetch`. Server-answered auth refusals keep their original code and
are never wrapped as connectivity.

The first preparation needs the server reachable (deployment verification).
After one successful online preparation over a registered durable store, an
offline relaunch re-admits against the persisted binding receipt
(`binding.source: 'persisted-receipt'`) — see the per-carrier matrix on
[the React client page](./react.md). Over the default in-memory fallback
nothing survives the process, so a cold offline boot cannot prepare — see
the store consequence below.

Components then use the ordinary generated-reference hook — reference plus
exact arguments (or `skip`), never a string name, a `userId`, or an
`authority` field. Identity comes from the client's custody, not from hook
arguments:

```ts source=packages/snapback-react/exact-result-types.fixture.ts
const query = useSnapbackQuery(todos, { owner: 'ada' });
if (query.status === 'ready' || query.status === 'refreshing') {
  query.data[0]?.title.toUpperCase();
}
```

`useSnapbackConnection()`, `useSnapbackMutation`, `useSnapbackQueries`, and
`useSnapbackOutbox` work as on web. The provider declares the exact
`snapback.external-store.v1` compatibility token; a different token refuses
before application data is published.

## Crypto prerequisites (React Native ships no WebCrypto)

Hermes provides no `globalThis.crypto`. The packaged client's boot path is
carrier-safe without polyfills:

- **Binding digests** (`prepareReactBinding` manifest/contract hashes) fall
  back to the parity-tested pure-JS SHA-256 when `crypto.subtle` is absent.
- **Process-local labels** (provider ids, optimistic-layer ids, mutation ids,
  and storeless active-query bookkeeping) fall back to time+sequence
  uniqueness.

So a fresh Expo app on this path reaches a ready provider and a live query
with zero consumer polyfills.

**Security-bearing random identity is never synthesized.** Surfaces that
mint unpredictable identity — seed operation ids, bundle-boot/register-mode
idempotency keys, sender-constrained proof ids, and the local store's handle
key and cross-context registration ids — require a native RNG. The optional
default store reports `reason: "secure-random-unavailable"` and stays disabled
when none is available; this does not prevent the Online client from
connecting. Explicit security-bearing operations refuse with one named,
actionable code:

```js source=packages/snapback-client/webcrypto-fallback.test.mjs
  assert.throws(
    () => newSeedOperationIdV1(),
    (error) => error?.code === 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING'
      && /expo-crypto/u.test(error.message),
    'seed operation identity names the missing RNG and the polyfill path',
  );
```

To use those surfaces on RN, provide native secure randomness before
constructing the client. Expo apps can hand `expo-crypto` directly to the
store registration as shown below, without mutating `globalThis`; a global
polyfill also works. Bare RN can use `react-native-get-random-values`.

## The store: relaunch-durable on-device once the app registers its filesystem

The client package never imports `expo-file-system` (Metro statically
resolves every literal specifier reachable from the root, so a platform
import would break non-Expo consumers). Instead the app hands the module in
**once, at the root, before constructing any client**:

Import `Platform` from `react-native`, then use the same guarded registration
the shipped `expo-chat` template carries:

```tsx source=packages/snapback-cli/templates/expo-chat/App.tsx
if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}
```

The `expo-chat` scaffold (`snapback new --template expo-chat`) ships this root
registration with the `expo-crypto` and `expo-file-system` dependencies wired.

After that root registration, the default persistence ladder (explicit option → env
kill switch → browser IndexedDB → **React Native registered files** → node
filesystem → in-memory) resolves the on-device file arm for every client on
this carrier: `client.rqsStoreInfo` reports
`{ source: 'default', implementation: 'file', durable: false, reason:
'native-files-no-power-loss-cut' }`, blobs live
under the app's document container (`Paths.document/snapback-rqs/`, one
blob per server origin), and at-rest protection is the OS container plus
platform disk encryption (LLP 0090 Q4 posture — no client-side encryption
is claimed). `durable: false` is the honest LLP 0043 publication-boundary
fact, not "nothing persists": Expo's synchronous File/Directory API exposes
no fsync-style cut, so the adapter declares `powerLossDurable: false` while
the store still survives ordinary relaunch (the Node filesystem arm, which
has that cut, reports `durable: true`). Without the registration the ladder
stays in-memory when secure randomness is available, with the actionable fact
`{ implementation: 'memory', durable: false, reason:
'no-native-files-registered' }`. Without secure randomness it disables the
optional store with `{ implementation: null, durable: false, reason:
'secure-random-unavailable' }`. Neither degradation blocks Online queries;
do not claim retention over either one.

What the registered file arm enables (proven on the iOS simulator against a
release Hermes build — `demos/rn-durable-store-witness/`):

- **Cold-boot retained render** for queries that declared `rqsEligible`
  retention (see [offline retention](../sync/offline-and-retention.md)):
  relaunching offline renders the persisted rows with
  `freshness: 'retained'` under an honest non-live connection fact.
  Protected (authority-scoped) queries are never cold-retained on this arm
  and their `handle.retention` names the refusal.
- **A restart-durable offline queue:** queued mutations survive relaunch,
  not just the process.

Offline cold boot of the hook path follows the binding-receipt fallback on
this carrier: a prior successful online preparation over the registered file
store persists the digest-bound receipt, and an offline relaunch prepares
from it (`binding.source: 'persisted-receipt'`) and renders the retained
rows through the hooks. The fresh-client witness is
`demos/relay-room-bakeoff/snapback-expo/tests/offline-acceptance.mjs`; a
physical-device process-kill witness is still open
(`issues/20260806-expo-file-carrier-process-kill-witness.md`).

The **supervised** provider takes the same fallback on a cold boot with the
supervisor unreachable. A successful supervised adoption caches the
non-secret binding and public authority facts (never the bearer) in a
development-only cache
([supervised binding cache](repo:packages/snapback-expo/supervised-binding-cache.mjs)
— `localStorage` on web, an `expo-file-system` document file on device).
When the bootstrap exchange then fails at cold boot
(`SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`), the environment re-presents that
cached binding through the unchanged full admission — an expired binding
still refuses with `SNAPBACK_APP_BINDING_EXPIRED` and its
restart-the-supervisor remediation — and a tokenless client then prepares
from the digest-bound receipt exactly as above. The boot's ready state names
the provenance honestly: `state.preparation.source` is
`'persisted-receipt'` on this lane (`'deployment'` when live), authority
facts are the retained last-known public facts, and protected reads still
refuse offline. No matching cache or receipt keeps the original
bootstrap-unavailable refusal. Witness:
[supervised offline fallback test](repo:packages/snapback-expo/supervised-offline-fallback.test.mjs).

### Reproduce a supervised cold boot with bare Metro

The supervisor normally puts its credential-free bootstrap origin into the
Metro process before Metro builds the application bundle:

```js source=packages/snapback-cli/expo-dev.mjs fragment="supervisor origin injected into Metro's environment"
    EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN: bootstrapOrigin,
```

That environment value is the switch that makes the provider attempt the
supervised exchange and, when that exact exchange is unreachable, consider
the cached-binding fallback. It is public loopback routing, not a bearer. To
exercise the cold-offline path outside the supervisor:

1. Start `snapback dev ./snapback --expo`, launch the app, and wait for both a
   ready provider and the retained query you intend to witness. That warm run
   persists the public supervised binding cache and the separate digest-bound
   client receipt.
2. While the supervisor is still running, capture `exchangeOrigin` from
   `.snapback/expo-supervisor.json` in a second terminal:

   ```sh
   export SNAPBACK_OFFLINE_ORIGIN="$(node -e \
     "process.stdout.write(JSON.parse(require('node:fs').readFileSync('.snapback/expo-supervisor.json')).exchangeOrigin)")"
   ```

3. Stop the supervisor. Its close path removes
   `.snapback/expo-supervisor.json` and reclaims the managed backend, Metro,
   bootstrap exchange, transient binding/session material, and any Android
   port forwards. The development-only public binding cache and client receipt
   deliberately remain in the app's store.
4. Start a new bare Metro process with the captured, now-unreachable origin in
   its environment, then cold-launch the app:

   ```sh
   EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN="$SNAPBACK_OFFLINE_ORIGIN" \
     npx --no-install expo start --localhost --clear
   ```

The variable must be present **when Metro creates the bundle**. Adding it after
Metro starts, or only to the shell that launches the simulator, does not change
an already-built JavaScript bundle; stop and restart Metro with the variable.
Do not substitute an arbitrary dead URL: the provider admits only the captured
device-local HTTP origin shape.

On success, boot is ready with `state.preparation.source ===
'persisted-receipt'` and retained public rows remain non-live. An absent cache
or receipt still returns `SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`; an expired
cached binding still returns `SNAPBACK_APP_BINDING_EXPIRED`; and protected
reads never become available merely because public retained rows did.

Flush on background (the LLP 0091 step-5 lifecycle wiring): persistence is
debounced, so have the shell flush pending resume state when the app leaves
the foreground:

```ts fragment reason="app lifecycle composition varies by shell; flushResumeState itself is exercised by the on-device witness and the resume suites"
AppState.addEventListener('change', (state) => {
  if (state !== 'active') void liveHandle.flushResumeState();
});
```

Two sharp edges, stated plainly:

- **Construct one client for the app, not one per operation.** The on-device
  store is single-writer per origin. If a shell deliberately replaces the
  client, `await client.closeAuth()` performs final cleanup and releases a
  store resolved by the default ladder before the successor is constructed.
  A store passed through `rqsStore` remains caller-owned and must be closed by
  that caller.
- For bare React Native (no expo-file-system), implement the ten-method
  files adapter (including `syncDirectory` and the `powerLossDurable`
  declaration) against `createFileRqsResumeStore` yourself, or inject a
  store per client via the `rqsStore` option
  (`createExpoRqsResumeStore({ fileSystem })` is the packaged convenience
  for Expo modules).

## The offline queue works on this carrier

With a store injected (or the default memory store) the LLP 0043 M2 queue
engages on Expo: connectivity is classified by transport provenance — the
fetch dispatch itself rejected, with no HTTP status, diagnostic, or receipt
— independent of the rejection's constructor, so Expo's plain-`Error` fetch
rejections queue exactly like undici's `TypeError` shape. Server-answered
refusals and caller aborts never queue. With the registered file store
above, the queue is also restart-durable. See
[offline and retention](../sync/offline-and-retention.md) for the mechanics
and `useSnapbackOutbox()` for rendering the queued state.

## Prove one operating-system tuple at a time

Run the profile gate with an explicit OS and receipt:

```sh
node demos/partiful-matrix/tests/acceptance/native-react-expo.mjs \
  --platform ios \
  --receipt demos/partiful-matrix/acceptance/results/step2-react-expo-ios.json
```

The OS-specific receipt must prove all seven LLP 0064 facts:

1. release carrier build and emulator/device launch;
2. generated-function initial authoritative data;
3. optimistic pending followed by authoritative settlement;
4. authority rotation followed by a fresh query;
5. background and foreground lifecycle events;
6. retained prior rows while offline, then authoritative reconnect; and
7. release-artifact exclusion of Snapback server code.

Android acceptance uses `adb reverse`; iOS acceptance launches the release app
in the selected simulator and backgrounds it by launching Settings through
`simctl`. Both bridge to a loopback development server and witness collector.
That is test infrastructure, not a production endpoint design and not
permission to expose development auth on a non-loopback listener. Each OS must
run its own build, lifecycle, reconnect, and artifact-exclusion checks; neither
receipt can substitute for the other.

## Run a headless iOS simulator proof

Use a dedicated simulator and `xcrun simctl` throughout; opening
Simulator.app is unnecessary. Record the UDID, runtime version, app bundle
digest, and every command in the receipt so the screenshot is evidence for one
exact LLP 0064 tuple rather than a generic iOS claim.

### Pre-approve the deep-link scheme with `plistlib`

The first custom-scheme open raises the iOS `Open in "<app>"?` confirmation.
A real user answers it once, but no headless `simctl` command can. The URL
never reaches the app, so an unattended witness otherwise times out without a
useful diagnostic.

Pre-approve only the dedicated test simulator, while it is **shut down**.
`plutil -replace` is the wrong tool here: it interprets the dots in
`com.apple.CoreSimulator.CoreSimulatorBridge-->{scheme}` as a key path instead
of one literal dictionary key. Python's `plistlib` assigns the literal key:

```sh
export UDID="<simulator-udid>"
export APP_SCHEME="myapp"
export APP_BUNDLE_ID="com.example.myapp"
export APPROVAL_PLIST="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist"

xcrun simctl shutdown "$UDID" 2>/dev/null || true
python3 - <<'PY'
import os
import plistlib
from pathlib import Path

path = Path(os.environ['APPROVAL_PLIST'])
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists():
    with path.open('rb') as source:
        preferences = plistlib.load(source)
else:
    preferences = {}
key = f"com.apple.CoreSimulator.CoreSimulatorBridge-->{os.environ['APP_SCHEME']}"
preferences[key] = os.environ['APP_BUNDLE_ID']
temporary = path.with_suffix(path.suffix + '.tmp')
with temporary.open('wb') as destination:
    plistlib.dump(preferences, destination, fmt=plistlib.FMT_BINARY)
temporary.replace(path)
PY
```

Keep the scheme registration in app config (`expo.scheme`). For Expo Go, the
corresponding pair is scheme `exp` and bundle id `host.exp.Exponent`; for a
development or release build, use that app's own scheme and bundle id. This
pre-approval is test infrastructure, not an application entitlement or a
production bypass.

### Boot, install, dismiss Expo Go onboarding, launch, and capture

Booting, installing, launching, and taking screenshots can all remain
headless:

```sh
export APP_PATH="/absolute/path/to/MyApp.app"
export EVIDENCE_DIR="/absolute/path/to/evidence"

mkdir -p "$EVIDENCE_DIR"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch --terminate-running-process "$UDID" "$APP_BUNDLE_ID"
xcrun simctl io "$UDID" screenshot "$EVIDENCE_DIR/boot.png"
```

When the carrier is Expo Go, install it first and dismiss its first-run sheet
before launch; otherwise the sheet can cover the app and consume the first
interaction:

```sh
xcrun simctl spawn "$UDID" defaults write host.exp.Exponent \
  EXDevMenuIsOnboardingFinished -bool YES
```

Run that command after Expo Go is installed and before its first launch. It is
not needed for a standalone development or release app.

### Use deep links as a tap-less drive channel

`simctl openurl` is reliable once the scheme is approved:

```sh
xcrun simctl openurl "$UDID" \
  "myapp://proof/send-message?fixture=hello-1"
xcrun simctl io "$UDID" screenshot "$EVIDENCE_DIR/message-sent.png"
```

For an unattended proof build, route a small closed set of `proof/*` URLs from
the ordinary React Native `Linking` listener to the same actions the UI invokes
(send, navigate, background-test setup), then emit the normal in-app/server
witness. A record id arriving in any deep-link or route URL is untyped: admit
it into the generated branded id type with `admitSnapbackId(table, value)`
from `@expo/snapback-client` (wire-grammar admission only — it deliberately
does not claim the row exists) instead of casting. Do not let the drive channel call private backend seams, skip
authority, or declare success by receiving the URL alone. Keep secrets out of
URLs, gate the channel to the proof build, and pair every drive command with an
independent observation or screenshot. Invitation/share URLs remain real
product flows; the `proof/*` convention is only a tap-less test director.

Finally, prefer the newest admitted runtime and record it. The iOS 26.3
simulator has a CoreText defect that can render astral emoji as tofu even when
the semantic string is correct; iOS 26.5 renders the same emoji correctly.
Treat a 26.3-only glyph difference as environment evidence, not a Snapback
data corruption claim.

## Handle native reconnect honestly

React Native WebSockets may emit `error` without the browser-style follow-up
`close`. The shared stream manager treats that error as connection loss,
refreshes the connection grant, and re-enters through a fresh
snapshot-with-subscribe. During the gap, keep the prior rows visible under a
`stale` or disconnected connection fact; never relabel them live.

`bindSnapbackAppLifecycle(AppState, handle)` from `@expo/snapback-client`
(re-exported by `@expo/snapback-react`) serializes AppState changes onto
anything with `pause()`/`resume()` methods — a **headless**
`client.liveQuery` handle you opened yourself, or the React provider itself,
which exposes exactly that app-lifecycle seam at provider granularity
(`provider.pause()` / `provider.resume()`;
[the React client page](./react.md)). `SnapbackExpoProvider` already binds
AppState to those provider methods internally, so on the supervised path do
not add a second AppState binding — leave the provider attached and let the
stream manager's reconnect own transport recovery. A custom shell that owns
its environment wiring binds host lifecycle once at the provider boundary
([framework bindings](./framework-bindings.md)).

A token-resume re-establishment can complete **rowlessly**: the HTTP
acknowledgement names the new subscription while the authoritative
`current_as_of` or replay frame travels on the durable socket. Either transport
may arrive first. The client buffers the bounded pre-ack durable window,
installs the response's subscription ID, and replays only matching frames in
arrival order. During that window, persisted rows remain `retained` and the
held server-minted token continues to prove `retention.retainable`; the durable
completion advances them to `current` and refreshes both the token and the
retention fact. If the bound overflows, the client discards the unproved prefix
and performs one tokenless fresh-snapshot resubscribe instead of claiming
current state.

This ordering rule is carrier-independent, but RN reconnect timing exposed the
original defect. The shared memory/Expo resume suite covers WebSocket
completion overtaking the HTTP response and overflow recovery. The earlier
~2s Expo reconnect-loop investigation is resolved under
`issues/closed/20260801-0137-a1expo-f7-rn-connection-cycles.md`; it is no longer
a current limitation.

## Build an EAS dev client for an app nested inside this repository

`eas build` resolves its project root at the nearest **Git root**, not the
nearest Expo app. Run it from an app nested inside this monorepo (a
`demos/<bakeoff>/<arm>`, an internal prototype) and it archives and uploads
the entire Snapback checkout — the Rust runtime, `vendor/ibex`, every other
demo, and all workspace `node_modules` — a multi-minute upload for a
kilobyte-scale app. `.easignore` and `EAS_NO_VCS=1` do **not** change that
root resolution; this reproduced independently in two bakeoffs
(`demos/tandem-expo-bakeoff`, `demos/relay-room-bakeoff`), and no first-party
nested-root configuration is documented for it. The supported pattern is to
**stage the app outside the checkout and build from the staged copy**, which
both bakeoffs converged on and the kit now paves:

```sh
# Stage <app-dir> into an out-of-checkout temp directory, bun install there,
# and run `eas build` from the staged copy (paid EAS service).
node demos/_kit/eas-stage-build.mjs demos/tandem-expo-bakeoff/snapback/native-shell \
  --platform ios --profile development

# Free preflight: stage and report only (file count, size, staged path kept
# for inspection); never installs dependencies or contacts EAS.
node demos/_kit/eas-stage-build.mjs <app-dir> --stage-only
```

The helper excludes `node_modules`, `.expo`, `.git`, `dist`/`dist-*`,
`.snapback`, and the sibling restore lock at every depth, refuses any staging
directory that is still inside a Git checkout, and keeps the small native
"shell" pattern workable: the shell carries only
native dependencies and EAS config while loading the product bundle from the
parent Metro server (see
[repo:demos/tandem-expo-bakeoff/scripts/build-ios-dev-client](repo:demos/tandem-expo-bakeoff/scripts/build-ios-dev-client)
for an arm-selection wrapper). Staging behavior is unit-verified by
[repo:demos/_kit/tests/repo-layout-unit.mjs](repo:demos/_kit/tests/repo-layout-unit.mjs);
the EAS build itself is an external paid service and is not CI-verified.

## Anti-patterns

- **Do not pass `userId`/`authority` to hooks or use the string-name object
  form.** The checkpoint-era `useSnapbackQuery({ provider, query, userId })`
  bridge teaches dev-mode client-asserted identity; the packaged surface is
  the generated-reference hook under a provider whose client owns custody.
- **Do not build a dev-auth multi-persona app on the packaged provider.** Use
  sessions and one adopted session per persona; the legacy per-call-user bridge
  is not the supported composition.
- **Do not route `expo start` through `--client-command` when the app expects
  supervised boot.** Select `--expo --expo-platform web`; the generic arm does
  not inject or publish the bootstrap exchange.
- **Do not give `createExternalSessionClient` a fixed dev-port fallback.** A
  custom broker/client shell owns origin propagation and must use its selected
  ready descriptor or stack-owned configuration carrier.
- **Do not polyfill RNG with `Math.random`.** When
  `SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING` names a missing primitive, install
  a real RNG polyfill (`expo-crypto`).
- **Do not claim cold-boot retention without the registered file
  store.** Unregistered, the store is in-memory; either way
  `client.rqsStoreInfo` is the honest fact to render — including its
  `durable: false` power-loss caveat on this carrier.
- **Do not transfer evidence between operating systems.** Native evidence is
  per immutable surface/OS profile.
- **Do not call Online local-first or Parity.** No local handler execution is
  claimed.
- **Do not bundle the Snapback server into the carrier.** Native packages
  contain public generated client artifacts only.
- **Do not ship emulator port bridging as endpoint security.** It is local
  acceptance infrastructure only.
- **Do not run `eas build` directly from an app nested in this checkout, and
  do not try to fix it with `.easignore`.** EAS archives the whole monorepo
  from the Git root either way; stage outside the checkout with
  `demos/_kit/eas-stage-build.mjs` (see the nested-build section above).
