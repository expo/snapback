---
title: React Expo Online clients
id: clients.react-expo
order: 3
audience: agent-first
capabilities: [clients.react-expo]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0017-admin-console-inspection-surface.rfc.md, llp/0041-packaged-dev-loop.rfc.md, llp/0064-native-client-surfaces.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, llp/0176-expo-messaging-golden-path.plan.md, llp/0181-zero-configuration-expo.rfc.md, packages/snapback-cli/expo-dev.mjs, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-client/rqs-store-default.mjs, packages/snapback-client/rqs-store-expo.mjs, packages/snapback-expo/app-binding.mjs, packages/snapback-expo/config-plugin.cjs, packages/snapback-expo/index.mjs, packages/snapback-expo/provider.mjs, packages/snapback-expo/supervised-environment.mjs, packages/snapback-react/index.mjs, scripts/install-local-snapback-packages.mjs, demos/partiful-matrix/tests/acceptance/native-react-expo.mjs, demos/_kit/eas-stage-build.mjs]
examples: [demos/expo-golden-path-fixture, demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md, demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md, demos/partiful-matrix/native/react-expo, packages/snapback-client/webcrypto-fallback.test.mjs, packages/snapback-expo/provider.test.mjs, packages/snapback-react/webcrypto-fallback.test.mjs, packages/snapback-client/rqs-store-expo.test.mjs, packages/snapback-client/rqs-resume-expo.test.mjs, scripts/local-source-package-closure.test.mjs, demos/rn-durable-store-witness/probe-App.tsx, demos/tandem-expo-bakeoff/scripts/build-ios-dev-client, demos/_kit/tests/repo-layout-unit.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-06
reviewed-commit: 4ac8387f080a2659484fc09916ff22a076dc4ca8
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
[Expo ImagePicker asset recipe](../backend/assets.md#upload-from-expo-imagepicker-with-an-ordinary-session).
It covers the native URI-to-Blob bridge, `useSnapbackAssetUpload`, the
completed task receipt, and typed attachment; a client with no real session
cannot finish the multi-request upload under any intent auth mode.

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

<!-- since: 0.1.10 unreleased -->

> **Unreleased.** `@expo/snapback-expo` is in the source tree but not in the
> newest published closure (`0.1.9`): a packaged consumer on
> `@expo/snapback-*@0.1.8` cannot install the config plugin or provider this
> section configures from npm. Use the source-checkout install above until
> the package joins a published closure
> (`issues/20260806-snapback-expo-package-not-in-publishable-closure.md`).

The north-star boot has three application-visible pieces: the config-plugin
entry, the generated `app`, and `SnapbackExpoProvider`. There is no backend URL
prop and no second application model ([LLP 0181 §Config plugin](repo:llp/0181-zero-configuration-expo.rfc.md#config-plugin),
[LLP 0181 §Provider](repo:llp/0181-zero-configuration-expo.rfc.md#provider)).
The working fixture's plugin entry is:

```json source=demos/expo-golden-path-fixture/app.json
    "plugins": ["@expo/snapback-expo"],
```

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

From an Expo app whose backend is the conventional `snapback/` child, start
the iOS default or select Android explicitly:

```sh
snapback dev --expo
snapback dev --expo --expo-platform android
```

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

### Settle the backend into Sessions mode first

The automatic mint inherits the native `auth.mintSession` precondition: the
app must already be settled and available in Sessions mode. The fixture does
this in its [schema](repo:demos/expo-golden-path-fixture/snapback/schema.mjs).
If that precondition is absent, the mint refuses and the provider reports
`authority-required` with the native diagnostic; it never hangs or silently
continues as anonymous. See [Sessions and principals](../auth/sessions-and-principals.md)
for the mode transition, and [LLP 0181 §Provider](repo:llp/0181-zero-configuration-expo.rfc.md#provider)
for the provider state contract.

### Choose simulator or emulator routing

| Carrier | Route selected by the supervised baseline | What stays loopback-only |
| --- | --- | --- |
| iOS simulator | Same-host loopback; the binding and Expo origin use `127.0.0.1`. | Backend, Metro, and bootstrap exchange. |
| Android emulator | Preferred: one verified `adb reverse` rule for each of the backend, Metro, and bootstrap ports, so the app still addresses `127.0.0.1`. Fallback: the emulator-only `10.0.2.2` host alias under `routing: "port-forward"`. | Every host listener. The fallback is routing posture, not permission to bind on LAN. |

These routes and their cleanup are the closed iOS/Android branches in the
[supervisor](repo:packages/snapback-cli/expo-dev.mjs),
[LLP 0181 §iOS simulator](repo:llp/0181-zero-configuration-expo.rfc.md#ios-simulator),
and
[LLP 0181 §Android emulator](repo:llp/0181-zero-configuration-expo.rfc.md#android-emulator).
Supervised binding admission tolerates at most 60 seconds of the host issuer's
clock running ahead of the simulator/emulator clock. Expiry remains strict; a
larger skew refuses with `SNAPBACK_APP_BINDING_NOT_YET_VALID`, in which case
fix the clocks and restart the supervisor.

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

This supervised loop does **not** claim physical-device development, a LAN or
tunnel edge, or a release build. Physical-device and LAN carriers remain
separately gated; release bindings and per-OS release acceptance use the
separate path later on this page
([LLP 0181 §Real devices in the baseline](repo:llp/0181-zero-configuration-expo.rfc.md#real-devices-in-the-baseline),
[LLP 0181 §Release binding](repo:llp/0181-zero-configuration-expo.rfc.md#release-binding)).
Tests and advanced multi-target shells may inject a
`SnapbackExpoEnvironmentV1`, but its binding still passes the same
source-specific admission.

## Use the low-level provider when you own environment wiring

A native app carries an adopted external bearer (see
[auth/native-apps](../auth/native-apps.md) for how a trusted broker mints it —
never embed admin authority in the app). The boot sequence is the standard
prepared-binding path over that client:

```ts fragment reason="application composition varies by app shell; mirrors the CI-run provider boot in packages/snapback-react tests"
import { createExternalSessionClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';
import api from './generated/api.mjs';
import schema from './generated/schema.manifest.json';
import functions from './generated/functions.manifest.json';
import capabilityManifest from './generated/capability.manifest.json';

const client = createExternalSessionClient(serverUrl, { bearerToken });
const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);
// <SnapbackProvider provider={provider}> ... </SnapbackProvider>
```

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

```ts fragment reason="app-root composition; the registration + ladder behavior is CI-proven in packages/snapback-client/rqs-store-expo.test.mjs and the on-device witness in demos/rn-durable-store-witness/"
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';

registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
```

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
(`issues/shelved/20260806-expo-file-carrier-process-kill-witness.md`).

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

## Witness a deep link on the simulator

An invitation or share flow returns to the app through a custom scheme, and
the acceptance loop above has no deep-link leg by default. Two facts save a
silent timeout:

1. **The first open of a custom scheme raises an OS confirmation dialog**
   (`Open in "<app>"?`). That is an iOS product fact — a real user answers it
   once per scheme — and no headless `simctl` surface can answer it. The URL
   event never reaches the app, and a director/witness run simply times out
   with no diagnostic.
2. **Pre-approve the scheme for headless runs.** With the device *shut down*,
   write the scheme approval into the simulator's launch-services preferences:

```sh
# device shut down; key is CoreSimulatorBridge-->{scheme}, value is the bundle id
plutil -replace "com.apple.CoreSimulator.CoreSimulatorBridge-->myapp" \
  -string com.example.myapp \
  ~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist
```

Then boot, install, and `xcrun simctl openurl <UDID> "myapp://invite/<token>"`;
the React Native `Linking` listener fires and the in-app redemption is
witnessable like any other step. Keep the scheme registration itself in the
app config (`expo.scheme`) — the pre-approval only substitutes for the human
tap, and only on a simulator you control.

## Handle native reconnect honestly

React Native WebSockets may emit `error` without the browser-style follow-up
`close`. The shared stream manager treats that error as connection loss,
refreshes the connection grant, and re-enters through a fresh
snapshot-with-subscribe. During the gap, keep the prior rows visible under a
`stale` or disconnected connection fact; never relabel them live.

`bindSnapbackAppLifecycle(AppState, handle)` from `@expo/snapback-client`
(re-exported by `@expo/snapback-react`) serializes AppState changes onto a
**headless** `client.liveQuery` handle's `pause()`/`resume()` methods. It
applies to handles you opened yourself; the React provider path does not
expose its internal handles, and the provider currently has no app-lifecycle
seam of its own — on that path leave the provider attached and let the
stream manager's reconnect own recovery.

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

The helper excludes `node_modules`, `.expo`, `.git`, and `dist` at every
depth, refuses any staging directory that is still inside a Git checkout, and
keeps the small native "shell" pattern workable: the shell carries only
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
