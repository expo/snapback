# 0063 — Expo G1 iOS golden path

**Date:** 2026-08-06
**Systems:** Expo SDK 57, `@expo/snapback-expo`, AppDescriptor, supervised development, iOS simulator
**Related:** `demos/expo-golden-path-fixture/`, LLP 0176 G1, LLP 0179,
LLP 0181, `demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`

## What was built

A clean Expo SDK 57 app with one Sessions-mode Snapback backend, one seeded
live query, and one ordinary mutation. The app passes only `app={app}` to
`SnapbackExpoProvider`; the supervisor supplies binding, loopback routing, and
ordinary session authority. The screen automatically dispatches the mutation
after seeing the seed and declares `G1_IOS_PASS` only when the mutation row
returns through the live query.

## What felt good

- Once the plumbing defects were removed, the application code matched the
  intended shape. There is no backend URL, token carrier, session-mint call,
  or transport choice in `App.tsx`. Provider readiness and the ordinary
  React query/mutation hooks were enough.
- The supervisor's JSONL was unusually useful evidence. It joined runtime
  build identity, binding identity, Sessions readiness, literal listener
  addresses, Metro output, app markers, and strict reclamation under one
  correlation id. The screenshot then corroborated the user-visible state
  instead of carrying the proof alone.
- The final simulator transition was fast: provider ready, seed observed,
  mutation dispatched, and mutation observed live all arrived within the
  first launch. The live query remained the authority for success rather than
  treating the mutation promise as proof of the read path.

## What felt bad or surprising

- The first inherited run had a plausible-looking ready receipt and a
  successful Metro bundle, yet Expo Go could not connect. Node had resolved
  Expo's `localhost` listener to `::1` while Snapback advertised
  `127.0.0.1`. A loopback boolean was not enough; the advertised origin had
  to be dialable in the exact enumerated address family.
- Generated ESM identity queries worked in Node but Metro treated the query
  as filename text. Content-addressed filenames were the portable answer,
  with `app.binding.mjs` retained only as a re-exporting compatibility alias.
- The first successful app render exposed a boundary bug hidden by JSON-only
  tests: hydrated function references carry a non-enumerable `artifacts`
  convenience, and client admission tried to hash the hydrated graph as
  CanonicalClientValueV1 query arguments. Projecting back to the portable
  descriptor at the admission boundary fixed the ownership mismatch.
- Repacking changed local tarballs at a stable pathname did not update Bun's
  locked bytes. The helper even reported the new digest while the fixture ran
  the old client. Content-addressed tarball paths, with predecessor retention
  until Bun adopts the new lock, made repeated source installs honest.
- `await import('react-native')` looked like a harmless way to obtain
  `AppState`, but Metro evaluated the React Native root namespace and touched
  `PushNotificationIOS`, a native module Expo Go intentionally lacks. A
  direct lazy import of the AppState module avoided unrelated native exports.

These were product/runtime defects, not missing guide knowledge, so this run
did not file a `guide-gap` ticket.

## Comparison

Compared with a conventional React plus Convex or Supabase Expo screen,
Snapback removed explicit endpoint and session wiring from the application
once supervised boot worked. The tradeoff was a newer generated
descriptor/binding/package pipeline with more cross-tool seams to prove:
Node versus Metro resolution, Bun lock identity, and Expo Go's native-module
set. The end-state application surface is smaller; the path to proving that
surface was materially rougher than mature package-only client setup.

## Result

The Air's dedicated iOS 26.4 simulator showed provider `ready`, live query
`ready`/`live`, the seeded row, the mutation row, and `G1_IOS_PASS`. The raw
supervisor stream closed with backend, Metro, and bootstrap all reclaimed.
This is only LLP 0176 G1's iOS-simulator half; Android and any physical-device
or LLP 0064 claim remain open.
