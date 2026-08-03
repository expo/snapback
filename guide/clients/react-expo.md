---
title: React Expo Online clients
id: clients.react-expo
order: 3
audience: agent-first
capabilities: [clients.react-expo]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-client/rqs-store-default.mjs, packages/snapback-client/rqs-store-expo.mjs, packages/snapback-react/index.mjs, demos/partiful-matrix/tests/acceptance/native-react-expo.mjs]
examples: [demos/partiful-matrix/native/react-expo, packages/snapback-client/webcrypto-fallback.test.mjs, packages/snapback-react/webcrypto-fallback.test.mjs, packages/snapback-client/rqs-store-expo.test.mjs, demos/rn-durable-store-witness/probe-App.tsx]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: c442237dedd412d1fe66a85c7a0ed463eba1e013
---

# React Expo Online clients

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

React Native/Expo uses the same packaged surface as React web:
`@expo/snapback-client`, generated function references, and the
`@expo/snapback-react` provider and hooks documented on
[the React client page](./react.md). It is an **Online** surface: queries and
mutations run against a reachable Snapback backend. It does not execute
handlers locally and therefore does not claim local-first behavior or Parity.

Everything on the React page applies here — this page covers only what is
different on the RN carrier: the boot path, the crypto prerequisites, the
store consequence, the offline queue, and reconnect honesty.

## Boot: external bearer, prepared binding, provider

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

Preparation needs the server reachable (deployment verification); a cold boot
with the backend unreachable cannot prepare — see the store consequence
below for why nothing renders from disk either.

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
- **Local instance labels** (provider ids, optimistic-layer ids, client
  store ids, mutation ids) fall back to time+sequence uniqueness.

So a fresh Expo app on this path reaches a ready provider and a live query
with zero consumer polyfills.

**Security-bearing random identity is never synthesized.** Surfaces that
mint unpredictable identity — seed operation ids, bundle-boot/register-mode
idempotency keys, sender-constrained proof ids — refuse with one named,
actionable code when no RNG exists:

```js source=packages/snapback-client/webcrypto-fallback.test.mjs
  assert.throws(
    () => newSeedOperationIdV1(),
    (error) => error?.code === 'SNAPBACK_CLIENT_WEBCRYPTO_RNG_MISSING'
      && /expo-crypto/u.test(error.message),
    'seed operation identity names the missing RNG and the polyfill path',
  );
```

To use those surfaces on RN, install an RNG polyfill before constructing the
client — Expo: `expo-crypto` (its `getRandomValues` polyfill), bare RN:
`react-native-get-random-values`.

## The store: relaunch-durable on-device once the app registers its filesystem

The client package never imports `expo-file-system` (Metro statically
resolves every literal specifier reachable from the root, so a platform
import would break non-Expo consumers). Instead the app hands the module in
**once, at the root, before constructing any client**:

```ts fragment reason="app-root composition; the registration + ladder behavior is CI-proven in packages/snapback-client/rqs-store-expo.test.mjs and the on-device witness in demos/rn-durable-store-witness/"
import * as FileSystem from 'expo-file-system';
import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';

registerExpoFileSystemRqsFiles(FileSystem);
```

After that one line, the default persistence ladder (explicit option → env
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
stays in-memory with the actionable fact
`{ implementation: 'memory', durable: false, reason:
'no-native-files-registered' }` — do not claim retention over it.

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

The React-provider boot caveat above still applies: `prepareReactBinding`
needs the server reachable, so hook-path rendering cannot start offline —
the retained render is the headless `client.liveQuery` path.

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

**Known limitation (under investigation):** on the Expo simulator the
provider connection has been observed cycling `live → stale` on a ~2s
reconnect loop while idle, with a retainable public query blanking after the
first cycle — see
`issues/20260801-0137-a1expo-f7-rn-connection-cycles.md`. Until that closes,
treat sustained `live` on RN as unproven and render the connection fact
honestly rather than assuming the cycle away.

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
