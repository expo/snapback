---
title: React Expo Online clients
id: clients.react-expo
order: 3
audience: agent-first
capabilities: [clients.react-expo]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0114-first-class-react-and-query-groups.spec.md, packages/snapback-client/index.mjs, packages/snapback-client/react-binding.mjs, packages/snapback-client/rqs-store-default.mjs, packages/snapback-react/index.mjs, demos/partiful-matrix/tests/acceptance/native-react-expo.mjs]
examples: [demos/partiful-matrix/native/react-expo, packages/snapback-client/webcrypto-fallback.test.mjs, packages/snapback-react/webcrypto-fallback.test.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-01
reviewed-commit: HEAD
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

## The store consequence: memory only, nothing durable on device

The default persistence ladder has no React Native arm: explicit option →
env kill switch → browser IndexedDB → node filesystem → **in-memory**. On
Expo every client resolves the memory store; the fact is honest and
inspectable as `client.rqsStoreInfo`
(`{ implementation: 'memory', durable: false }`). Consequences:

- **No cold-boot retained render.** Relaunching offline renders nothing —
  even for queries that declared `rqsEligible` retention (see
  [offline retention](../sync/offline-and-retention.md)); retained rows
  require a durable store, and this carrier has none.
- **The offline queue is not restart-durable.** Queued mutations survive
  the process, not a relaunch.

An on-device durable adapter (expo-file-system/SQLite backing for the
persisted-entry contract) is tracked in
`issues/20260725-rqs-native-ondevice-adapter.md` (LLP 0129's on-device
adapter); until it lands, do not claim mobile cold-boot retention.

## The offline queue works on this carrier

With a store injected (or the default memory store) the LLP 0043 M2 queue
engages on Expo: connectivity is classified by transport provenance — the
fetch dispatch itself rejected, with no HTTP status, diagnostic, or receipt
— independent of the rejection's constructor, so Expo's plain-`Error` fetch
rejections queue exactly like undici's `TypeError` shape. Server-answered
refusals and caller aborts never queue. See
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
- **Do not claim cold-boot retention on this carrier.** The store is
  in-memory; `client.rqsStoreInfo` is the honest fact to render.
- **Do not transfer evidence between operating systems.** Native evidence is
  per immutable surface/OS profile.
- **Do not call Online local-first or Parity.** No local handler execution is
  claimed.
- **Do not bundle the Snapback server into the carrier.** Native packages
  contain public generated client artifacts only.
- **Do not ship emulator port bridging as endpoint security.** It is local
  acceptance infrastructure only.
