# 0063 — Expo G1 simulator/emulator golden path

**Date:** 2026-08-06
**Systems:** Expo SDK 57, `@expo/snapback-expo`, AppDescriptor, surfaces,
supervised development, iOS simulator, Android emulator
**Related:** `demos/expo-golden-path-fixture/`, LLP 0176 G1, LLP 0179,
LLP 0181, `demos/expo-golden-path-fixture/receipts/20260806-g1-ios-simulator.md`,
`demos/expo-golden-path-fixture/receipts/20260806-g1-android-emulator.md`,
LLP 0176 G2,
`demos/expo-golden-path-fixture/receipts/20260806-g2-ios-simulator.md`,
`demos/expo-golden-path-fixture/receipts/20260806-g2-android-emulator.md`,
LLP 0176 G3, LLP 0180

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

## 2026-08-06 — G2 Relay Room falsification checkpoint

### Freeze and rebuild

I chose Relay Room rather than Tandem for the required comparison. Relay's
conversation-list and thread files are Snapback-specific and keep the query,
mutation, connection, outbox, asset, and presence hooks beside the UI they
drive. Tandem's 881-line shared presentation layer plus separate 223-line
Snapback adapter would make a screen-only reduction harder to attribute. Relay
was also the stricter target because its original screens already had zero
manual subscription cleanup.

Before touching rebuild code, I froze the exact files and Git blobs, 510
physical lines, 35 hook call sites across 14 APIs, zero cleanup lines, an
advance 26-line/5% reduction bar, and all 18 retained/error/capability facts in
the G2 receipt. The rebuilt screens are 339 lines and use 23 hook call sites
across 10 APIs. One `useSurface` now owns the thread's five reads, five bound
mutations, and scoped typing room, while connection, outbox, and raw asset-task
state remain explicit because they are not surface-owned facts.

### What felt good

- The thread finally reads like a product resource: `data.messages` sits beside
  `state.messages`, and bound mutations no longer repeat `conversationId`.
- Online headless acceptance confirmed that the surface and a low-level sibling
  share the same five upstream owners. Compactness did not require a second
  cache or a cleanup protocol.
- Rich state remained available after projection. A retained-state unit witness
  simultaneously observed retained/refreshing/stale facts and the same message
  array through `data`; mutation refusal stayed a rejected promise.

### What failed

The mandatory real cold-client path falsified the design. An online
AppDescriptor boot persisted the exact binding receipt and retained message
rows. After closing that client/store, stopping the server, and reopening a
fresh store/client, descriptor-mode `prepareReactBinding` threw `fetch failed`
before a provider or `useSurface` could exist. The client intentionally refuses
receipt adoption here: the portable descriptor omits server-owned function
interiors, while the legacy receipt does not retain the admitted deployment
view needed to reconstruct them safely.

This is worse than a missing “retained” flag. Snapback possesses the retained
rows and the projection preserves their rich state, but the preferred
`<SnapbackExpoProvider app={app}>` entry point makes them unreachable exactly
when the screen needs “Saved history.” The 33.5% shrinkage therefore passes
Half 1 and still cannot rescue Half 2. Per the gate, the overall checkpoint is
FAIL and no G3 command work started.

Compared with React plus Convex or Supabase, Snapback's surface removes more
repeated resource plumbing and gives canonical ownership a crisp test seam.
But an application-owned mature cache can normally be opened before a network
round trip; having durable rows that the generated descriptor cannot admit
offline is a sharper failure than simply lacking first-class retention.

The receipt is
`demos/expo-golden-path-fixture/receipts/20260806-g2-falsification-baseline.md`.
The repaired design defect is archived in
`issues/closed/20260806-app-descriptor-use-surface-blocks-cold-retained-boot.md`.

## 2026-08-06 — G2 simulator/emulator exit

### What changed

The fixture now cold-opens Engine Room and turns the accepted north-star shape
into a visible per-platform proof. Its single conversation surface publishes a
scoped typing fact, waits for current messages, sends text, reacts to the
returned message, and waits for both writes to return through the surface
before emitting `G2_IOS_PASS` or `G2_ANDROID_PASS`. Structured app events and
the screen expose each constituent fact rather than treating the mutation
promises or screenshot alone as proof.

The real-runtime acceptance was tightened at the same time: five reads must
remain five canonical stores/subscriptions beside an equivalent low-level
message consumer, typing must remain one presence store/room subscription, and
disposal must leave the complete query, presence, publisher, timer, and
listener vector at zero.

### What felt good

- The same authoring snippet worked unchanged behind same-host loopback on iOS
  and three supervisor-owned `adb reverse` rules on Android. Transport and
  authority facts stayed outside the screen.
- The pass marker is a genuine join: provider readiness, surface data, both
  mutation echoes, and the self-presence member must all coexist. That made the
  screenshot useful without asking it to prove canonical ownership.
- The supervisor JSONL closed the evidence loop. Each platform receipt joins
  binary identity, routing, app facts, literal listeners, and strict process or
  forward-rule reclamation; executable inspection supplies the duplicate-owner
  and post-disposal resource assertions.

### What felt bad or surprising

- Evidence instrumentation grew the rebuilt thread from 235 to 361 lines. The
  frozen two-screen boundary is still 465 lines, 45 lines/8.8% below Relay's
  510-line original and past the 5% advance bar, but a production screen would
  not keep this much receipt-only orchestration inline.
- A clean evidence worktree needed the repository root frozen install before
  generation because current codegen imports its declared `acorn` dependency.
  The pinned Bun executable handled it without a source workaround.
- On iOS, interrupting the SSH/`tee` wrapper detached the shell without
  stopping its independent supervisor child. The required post-stop checks
  caught it; signaling the exact supervisor PID then produced the expected
  closed event and full reclamation. Android's first capture also showed an
  existing SafeAreaView warning toast, so the final screenshot was recaptured
  after dismissing the warning rather than hiding it in the receipt.

During final mainline reconciliation, the dedicated
`guide/clients/surfaces.md` page landed and made the fixture a verified snippet
source. Updating its declaration excerpt to the north-star `react` projection
kept the guide and generated manifest byte-current with the exercised screen.

None of those observations exposed missing guide knowledge or a product defect,
so no `guide-gap` or defect ticket was filed.

### Comparison and result

A hosted React plus Convex or Supabase app would usually avoid the local
supervisor and emulator-forwarding setup. Snapback required more evidence
plumbing, but the application resource shape was smaller: one bound surface
owned messages, mutations, and room-scoped presence, while one supervisor
could prove the carrier and its cleanup. The canonical-owner inspection is
also stronger than inferring subscription health from a visually correct chat
screen.

Both platform chains passed and shut down cleanly. The Air's pre-existing
checkout is clean with the named `g2-ios-receipt` transport branch retained
without a worktree; the Android prepared checkout is clean on
`g2-android-receipt`. No task-owned simulator, emulator, server, Metro,
bootstrap, reverse rule, or adb daemon remained. This completes LLP 0176 G2
for headless React plus iOS simulator and Android emulator only; it makes no
physical-device, release, LAN-carrier, or LLP 0064 claim.

## 2026-08-06 — LLP 0180 command core and G3 headless acceptance

### What changed

The messaging backend now declares one `send` command over an optional image
upload and one ordinary `sendMessage` mutation. The conversation surface binds
its resource and seeded sender fields, leaving text and image source as the
same typed call. Headless real-runtime acceptance exercises text, one image,
finalized-but-unattached residue, and anonymous refusal at the distinct
mutation and asset boundaries.

### What felt good

- The descriptor remained inspection data. Its new `commands` namespace names
  the ordinary mutation, optional upload intent, mapping, and passthrough
  inputs without moving the command into `mutations` or inventing a command
  endpoint.
- The client wrapper could reuse the existing asset task and ordinary mutation
  attempt. React's direct hook and surface callable share those provider-owned
  children; the wrapper only projects phases and terminal outcomes.
- One optional asset mapping made text and image sends genuinely the same call
  shape. The mutation stayed the sole row/attachment commit, which made the
  no-false-atomicity test straightforward.

### What felt bad or surprising

- The first real-runtime run exposed a contract gap below codegen: generated
  mutation arguments could now carry `AssetRef`, but Rust manifest admission
  still rejected that result-value contract in the argument lane. Extending
  the existing argument validator fixed the actual boundary; a fresh
  digest-bound runtime readiness receipt was necessary before trusting the
  acceptance server.
- LLP 0044 currently exposes finalized asset identity but no authoritative
  global “unattached everywhere” fact. A proved same-authority mutation
  refusal can therefore report only `inferred`; ambiguity and authority
  replacement are `unknown`. The task cannot honestly offer “safe to delete.”
- Anonymous text reaches the mutation boundary, while anonymous image send is
  rejected earlier by asset owner custody. Keeping those diagnostics and the
  absent mutation child visible was more useful than flattening both into one
  command error.

The surface guide was updated in the same change because its S1-era statement
that commands were reserved had become actively wrong. This was feature drift
caused by the implementation itself, not missing knowledge encountered while
following the prior guide, so no separate `guide-gap` ticket was filed.

### Comparison and boundary

Compared with a React plus Convex or Supabase screen that hand-sequences
storage upload and row mutation, the typed command removes application-level
sequencing and gives retry/ambiguity one explicit task. Snapback also makes
the non-atomic seam unusually visible: finalized storage can outlive a failed
row mutation. That honesty costs a richer result than a normal rejected
promise, but prevents an ambiguous send from looking safe to repeat.

This entry covers the command core and headless G3 acceptance only. Expo picker
and content-URI adapters, platform receipts, offline/restart custody,
multi-asset commands, attempt grants, and anonymous claim-on-attach remain out
of scope.

## 2026-08-06 — LLP 0181 E2 and G3 platform exit

### What changed and what passed

The Expo provider now registers the native image-source boundary once. A raw
`expo-image-picker` asset with `content://`, `ph://`, or `file://` becomes an
immutable slice-readable structural source, while Expo's WinterCG fetch owns
binary TUS transport and the existing client owns SHA-256/checksum work. The
fixture sends text and the picker object through the same
`conversation.commands.send` callable, renders phases and terminal outcome,
and refuses to declare the receipt complete until React Native `Image` has
actually loaded the delivery URL.

The iOS library received a task image through `simctl addmedia`, and the image
was chosen through the real Photos picker. Android received 30,670 bytes by
`adb push` plus MediaStore scan, then returned those bytes through Android's
Photo Picker. Both fresh supervised runs used one ordinary Sessions provider
cohort for text and image, committed both rows, visibly rendered the image,
and truthfully ended a deliberately cancelled command as `cancelled` with no
residue. Both supervisors then reclaimed backend, Metro, bootstrap, and—on
Android—all three reverse rules.

### What felt good

- The final screen API is the intended product sentence:
  `conversation.commands.send({ body, image: picked })`. The screen does not
  sequence reservation, TUS, finalization, asset-id attachment, or mutation.
- The adapter is genuinely an adapter rather than an Expo upload subsystem.
  The command's existing asset and mutation child states continued to drive
  `preparing`, `transferring`, `committing`, and the terminal outcome.
- The visible proof was hard to fake accidentally. A committed row alone was
  insufficient; native `onLoad` had to corroborate public delivery before the
  pass marker appeared.
- The receipt loop preserved the useful safety claim from LLP 0180: successful
  and cancelled tasks have no residue, while the headless post-finalize arms
  remain only `inferred` or `unknown`, never “safe to delete.”

### What felt bad or surprising

Snapback's cross-runtime byte seam needed more repair than its compact API
suggests. Native local-resource responses can be valid with status 0. A React
Native legacy Blob can look Blob-shaped until `slice().arrayBuffer()` is
needed. Expo 57 Android can return an actual 404 with the literal 14-byte body
`File not found` for a picker-cache `file://` that `expo-file-system` can still
read. And the legacy global fetch cannot be trusted to carry the task's binary
TUS body. The final adapter therefore freezes copied bytes and uses a narrowly
scoped local `File.bytes()` fallback rather than accepting response text.

The rendering path had two similarly plausible false positives. The fixture
used a DOM-only asset component on native, then the native hook projected a
private-strict URL for a `public-immutable` record. Both could produce a URL
or row without producing pixels. The repaired hook chooses a concrete public
rendition and the fixture observes the native load.

Expo itself was helpful once ownership was explicit: `expo-image-picker`,
`expo/fetch`, `expo-file-system`, `simctl addmedia`, and Android's Photo Picker
formed a credible device boundary. The rough edge was that the three local URI
representations do not share browser HTTP semantics even within one Expo SDK.

The assets guide still showed the earlier hand-sequenced `expo/fetch` + raw
upload recipe. That text became stale because this change introduced the
provider adapter and typed command; it is replaced in this same change rather
than filed as a separate `guide-gap`. The receipt-found product defects are
recorded and resolved under `issues/closed/`.

### Comparison and result

Compared with React plus Convex or Supabase, Snapback's end-state screen has
less application-owned sequencing and a much more explicit ambiguous/residue
contract. A conventional storage SDK may make the native URI-to-upload path
feel mature sooner, but the application typically still coordinates storage
and row mutation and decides what a partial failure means. Snapback moved that
coordination into one typed task; proving the native adapter was materially
rougher, while the resulting UI code and failure vocabulary are materially
cleaner.

The dated iOS and Android receipts complete LLP 0181 E2 and the Expo arm of
LLP 0176 G3 for supervised simulator/emulator online use. They make no
background, restart, offline, attempt-grant, release, physical-device,
LAN-carrier, or LLP 0064 claim.
