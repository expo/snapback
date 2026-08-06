# 0063 — Expo G1 simulator/emulator golden path

**Date:** 2026-08-06
**Systems:** Expo SDK 57, `@expo/snapback-expo`, AppDescriptor, supervised development, iOS simulator, Android emulator
**Related:** `demos/expo-golden-path-fixture/`, LLP 0176 G1, LLP 0179,
LLP 0181, `demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`,
`demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md`

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
At that point this was only LLP 0176 G1's iOS-simulator half; Android and any
physical-device or LLP 0064 claim remained open.

## 2026-08-06 — Android emulator half

### What was built and proved

The iOS fixture was made platform-neutral rather than forked. Its Android arm
uses `android-emulator` as the mutation source and renders/emits
`G1_ANDROID_PASS`; the seed text and app metadata are now neutral across both
platforms. The provider surface is unchanged: the app still passes only
`app={app}`, with no URL, bearer, session-mint call, or transport choice.

On the fleet M4 Mac mini, a real Android 16 / API 36 AVD cold-opened Expo Go
57.0.3 through `snapback dev --expo --expo-platform android`. Three explicit
`adb reverse` rules made backend, Metro, and bootstrap app-local at
`127.0.0.1`. All three host listeners independently enumerated as IPv4
loopback. The provider adopted ordinary Sessions authority, saw the seed,
sent the ordinary mutation, saw the row return through the live query, and
rendered `G1_ANDROID_PASS`.

### Differences from iOS

- iOS was same-host loopback and needed no forwarding rules. Android made the
  routing ownership more visible: the supervisor had to install, enumerate,
  and later reclaim three `adb reverse` rules. The binding correctly called
  this `port-forward` even though the application still dialed loopback.
- The Android launch path needed SDK tools added to `PATH`, a headless AVD,
  and an Expo Go APK download/install. The one-time Expo Go developer-menu
  introduction also had to be dismissed before a clean screenshot.
- The AVD clock lagged the mini by about 21 seconds. A slow first bundle hid
  that difference; a cached cold launch was fast enough to expose strict
  `issuedAt` admission as a real race.
- The mini had no sibling prepared Ibex checkout, so bootstrap initialized
  vendored Ibex and paid the Hermes fallback build. This was much slower than
  the Air's prepared-runtime path but left reusable fleet capacity behind.

### Defects and friction

The public HTTPS clone was valuable precisely because it did not inherit
ignored state. It revealed that the local-package installer's predecessor
retention fixed repeat installs but not clean clones: the tracked fixture lock
named ignored tarballs that were absent, and Bun failed before rotating them.
The fix now updates only helper-owned paths and their dependency/integrity
records while preserving the unrelated locked graph byte-for-byte. The test
models missing predecessor artifacts and rejects Bun's lockfile-ignore
fallback.

The second defect was the host/emulator clock race. The Expo binding validator
now admits at most 60 seconds of issuer-ahead skew only for supervised
`local-supervised-ipc` issuance. Expiry stays strict and release admission is
unchanged. The final receipt launched while device time was still before the
binding's `issuedAt`, so this fix was exercised rather than merely unit-tested.

The fixture also had two receipt-quality papercuts: an iOS-specific seed label
on Android, and a promise/live-update ordering race that could render
"awaiting live echo" after the live row was already visible. Both were made
platform-neutral/monotone before the final screenshot.

These were product/runtime or fixture defects, not missing guide knowledge, so
this section does not file a `guide-gap` ticket.

### Comparison and result

Compared with a conventional React plus Convex or Supabase Expo app, Android
required more host plumbing, but that plumbing stayed outside application
code and was unusually auditable: route selection, literal listeners,
forwarding rules, authority, application markers, and reclamation shared one
supervisor receipt. The setup path is still rougher than a mature hosted
client's package-plus-environment-variable flow, especially on a new machine;
the final authoring surface is smaller because endpoint and session wiring do
not leak into the screen.

The Android receipt closed with backend, Metro, bootstrap, and all three port
forwards reclaimed; the emulator and adb daemon were stopped. With the prior
iOS half, LLP 0176 G1's no-URL boot exit evidence is complete for
simulator/emulator. No physical-device or LLP 0064 claim follows.

## 2026-08-06 — LLP 0179 S1 conversation surface

### What changed

The same Expo golden-path fixture now carries a small messaging backend beside
the G1 receipt path: conversations, messages, a reaction mutation, and
connection-owned typing presence. Codegen emits one `conversation` surface
that binds `conversationId` across the two live reads, the mutation, and the
presence scope. The screen consumes the accepted north-star shape through the
existing E1 provider; a headless provider test exercises the same generated
surface without React.

I chose this fixture over the older messaging demo because the S1 question is
specifically whether the generated surface survives the no-URL Sessions/E1
provider path. Keeping the conversation deliberately small avoided importing
reply previews, aggregates, or the G2 simulator receipt into this slice.

### What felt good

- The surface implementation could stay a projection over the LLP 0114
  registry. An equivalent low-level query and the surface read share the same
  snapshot object and one upstream subscription; typing consumers share one
  room. There is no surface-specific transport or cache to explain.
- Binding `conversationId` once made the reaction call meaningfully smaller
  while the portable descriptor retained every target-to-source mapping.
  Generated TypeScript rejects both a repeated `conversationId` call input and
  a `userId` field in the empty typing payload.
- Pairing `data.messages` with `state.messages` kept the rendering path terse
  without losing pending/error/freshness/retention facts. Pending and authority
  replacement remain `undefined`; the projection never manufactures an empty
  array.

### What felt bad or surprising

- Surface declaration values cross the isolated definition evaluator, so
  authored reference identity is intentionally lost. Resolving a bound child
  required structural matching against the generated function or ephemeral
  namespace and a loud ambiguity refusal.
- The provider admission path previously ignored descriptor surfaces even
  though it admitted all of their children. S1 needed a small admission index
  so a surface cannot be borrowed from another prepared app.
- Empty-object TypeScript emission had historically produced `{}`, which in
  TypeScript accepts arbitrary properties. The typing lane exposed that this
  was too weak: it now emits `Record<string, never>`, making the no-identity
  payload contract real rather than documentary.

These observations came from implementing a newly accepted RFC, not from
knowledge the current guide claimed to cover. The guide still has no surface
page; per the delivery plan that page can wait for the G2 exit/falsification
work, so this entry does not file a `guide-gap` ticket.

### Comparison and boundary

Compared with assembling the same resource hook around React Query plus a
Supabase realtime channel, the generated binding removes repeated resource
arguments and makes cleanup/canonical ownership testable at one provider seam.
The cost is a stricter codegen declaration and descriptor-admission pipeline.
This entry proves S1 machinery and an E1 headless/React boot only. It does not
claim the separate G2 falsification checkpoint, simulator receipts, commands,
aggregates, or reply-preview behavior.
