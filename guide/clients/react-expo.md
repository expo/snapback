---
title: React Expo Online clients
id: clients.react-expo
order: 3
audience: agent-first
capabilities: [clients.react-expo]
authorities: [llp/0012-headless-integration-contract.spec.md, llp/0064-native-client-surfaces.rfc.md, llp/0074-convex-competitive-strategy.rfc.md, packages/snapback-client/index.mjs, packages/snapback-client/external-store.mjs, packages/snapback-react/index.mjs, demos/partiful-matrix/tests/acceptance/native-react-expo.mjs]
examples: [demos/partiful-matrix/native/react-expo, demos/competitive-checkpoint/surfaces/react-expo]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-22
reviewed-commit: HEAD
---

# React Expo Online clients

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

React Native/Expo uses the same `@expo/snapback-client`, generated function
references, framework-neutral external store, and `@expo/snapback-react` hook as
React web. It is an **Online** surface: queries and mutations run against a
reachable Snapback backend. It does not execute handlers locally and therefore
does not claim local-first behavior or Parity.

The current implementation has independent clean seven-check Android emulator
and iOS Simulator receipts. Each binds its implementation revision, hashed
carrier/build inputs, release build and artifact digest, so both
`STEP2.REACT_EXPO_ANDROID_ONLINE` and `STEP2.REACT_EXPO_IOS_ONLINE` are passing.
Treat this page as the shipped API plus the exact current evidence boundary,
not as a physical-device or production-support declaration.

## Use the same generated API and hook

The carrier imports project-generated refs and binds them through the ordinary
React hook:

```tsx source=demos/competitive-checkpoint/surfaces/react-expo/App.tsx
  const conversations = useSnapbackQuery<Conversation>({
    provider: checkpointProvider,
    query: api.listConversations,
    userId: USER_ID,
    authority: USER_ID,
  });
```

The package compatibility layer resolves that immutable reference for the
provider; application code never supplies a string function name. There is no
direct table-write API or second native cache. The provider declares the exact
`snapback.external-store.v1` compatibility token. A different token refuses
before application data is published.

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

Backgrounding quiesces the provider's live handles while retaining rendered
rows; foregrounding restarts the surviving current-authority subscriptions and
waits for authoritative snapshots. The Online gate asserts those provider
transitions in addition to the OS events. It does not claim the durable queue,
local execution, replay/rebase, or authority-safe retained store required for
Exact Native Parity.

Use `bindSnapbackAppLifecycle(AppState, liveHandle)` from `@expo/snapback-react`
(or `@expo/snapback-client/online`) when a provider exposes the first-party
`liveQuery` handle. The helper has no React Native package dependency: it
serializes AppState changes onto the handle's `pause()` / `resume()` methods
and removes the listener on disposal. This is the supported replacement for a
timer that tears down a merely quiet socket.

## Anti-patterns

- **Do not transfer evidence between operating systems.** Native evidence is
  per immutable surface/OS profile.
- **Do not call Online local-first or Parity.** No local handler execution is
  claimed.
- **Do not bundle the Snapback server into the carrier.** Native packages
  contain public generated client artifacts only.
- **Do not replace generated function refs with stringly table calls.** The
  generated API is the cross-surface contract.
- **Do not ship emulator port bridging as endpoint security.** It is local
  acceptance infrastructure only.
