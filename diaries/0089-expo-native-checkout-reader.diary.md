# Diary 0089: Expo native checkout reader

**Date:** 2026-08-16

**Run:** LLP 0262 D2 first-party native checkout reader and live-witness setup

**Client:** Expo 57 development client / React Native 0.86

**Provider:** Supervised Snapback Expo with one-shot dev-identity checkout

## Build entry

The application surface stayed small: one owner-visible table, one generated
live query, and one screen that proves the checkout and dev-identity headers
were presented without retaining either value. The server-authoritative query
was a useful final witness because a successful redemption alone would not
show that the resulting capability crossed the real Snapback client transport.

The native boundary was pleasantly narrow. An iOS app-delegate subscriber and
an Android activity-delegate handler capture one launch value into process
memory before React load, while a first entry import consumes it synchronously and installs the
documented non-enumerable hook before the application module evaluates. That
keeps the nonce out of `EXPO_PUBLIC_*`, app config, Metro source, receipts,
storage, and logs. The supervisor's existing one-shot registry and startup
nonce binding then compose without another authority format.

The main friction was local Expo autolinking. Bun's `file:` packages expose
individual native source files as symlinks, while Expo's Android legacy-package
scanner ignores symlink file entries. Giving the witness a source-level
autolinking search path made the actual `*Package.kt` visible; static resolution
then named both the Kotlin module and the pre-React activity listener. The same
configuration made the Swift module and app-delegate subscriber explicit.
Moving the witness out of the module package also avoided Bun recursively
copying a fixture nested inside its own file dependency.

The development client needed a second, non-secret launch step after the
nonce-bearing bundle/component launch: an explicit deep link loads the
supervised Metro URL in the same fresh process. This was easy to overlook
because Expo Go normally owns that convenience. The harness now performs that
step itself while keeping checkout issuance default-off and refusing Expo Go.

Compared with React Native plus Convex or Supabase, this is more native launch
and evidence plumbing than an ordinary app would carry. The benefit is a much
sharper custody story: app code never owns an operator token or durable dev
credential, browser paths cannot see the carrier, replay and rotation are
negative witness rows, and the application still uses a normal generated query
once admission completes.

No Guide-gap ticket was filed. This is implementation and qualification work
for the explicitly open LLP 0262 carrier ticket, not missing guidance for an
already supported app-authoring path. Static generation/prebuild/autolinking
checks pass; iOS simulator, Android emulator, and Android USB live receipts
remain pending on the orchestrator host.

## Review-fix entry — 2026-08-16

Two independent reviews caught three places where the first witness pass was
more optimistic than the implementation. First, the harness knew the
development client needed a Metro deep link, but the supervisor itself stopped
after the nonce-bearing own-bundle launch. Making the app scheme an explicit
input and treating own-bundle launch plus deep-link open as one synchronous
sequence puts the application boot back under the supervisor's readiness
contract. The development-client URL contains only the routed Metro origin.

Second, the negative receipts had to be named after observable facts. A
headerless checkout POST returning 403 said nothing about what the tunneled
bootstrap exposed; the replacement GET inspects the real tunneled bootstrap
body and headers for the nonce and dev-capability vocabulary. Similarly, a
Node `fetch` carrying `Origin` proves the server's Origin gate, not execution of
an Expo web bundle. That row is now narrowly named, and the real browser-bundle
web row remains pending instead of being inferred.

Finally, the iOS reader's one-shot state was too eager: JavaScript could call
`takeCheckoutNonce` before the app-delegate subscriber captured the launch
environment and permanently consume an empty delivery. The getter now performs
the environment capture attempt itself under the same lock when needed, and
both capture paths unset the environment immediately. This was native launch
ordering friction, not a missing Guide fact, so no guide-gap ticket was filed.

## Progress — 2026-08-25 (Android emulator carrier-only / pre-fail-sensitive, NOT YET)

The Android emulator carrier run passed its then-current checks and is retained under
`demos/expo-native-checkout-reader/receipts/android-2026-08-25T14-54-18-163Z/`.
It records the selected emulator's per-serial `adb reverse` path, Activity-extra
checkout, pre-JS native reader, query admission, rotation replacement, replay
and post-rotation refusal, browser-Origin refusal, and tunneled bootstrap
isolation without retaining either secret value. It predates the later
server-observed, nonempty-row criteria and is not D2 evidence.

Android exposed two concrete integration frictions. The legacy Expo activity
handler compiles against React Activity callback types, so the native module
needs an explicit `react-android` implementation dependency. More subtly,
issuing the Metro deep link immediately after `am start -S` can lose the intent
while Android is still forcing the process restart even though both commands
return success. Adding `-W` to the nonce-bearing Activity launch made the
supervisor wait for Activity readiness before opening the non-secret Metro URL.

The witness harness also had drifted from the canonical managed database
layout now required by `dev-fresh`; putting each run under its own
`.snapback/dev.sqlite3` project restored safe rotation. Compared with a typical
React Native plus Convex/Supabase smoke test, this is heavier device and
negative-evidence plumbing, but the failure modes are correspondingly precise:
the receipt distinguishes native custody, stale/replayed delivery, browser
redemption, and raw HTTP isolation instead of treating “the app launched” as
the security claim. No Guide-gap ticket was filed because these were carrier
implementation and acceptance-harness defects, not missing author guidance.

## Progress — 2026-08-25 (Expo web isolation witnessed; D2 NOT YET; iOS simulator carrier-only / pre-fail-sensitive, NOT YET)

The real Expo web bundle now passes its sessions/isolation checks in Chrome under
`demos/expo-native-checkout-reader/receipts/web-2026-08-25T14-49-42-653Z/`.
It keeps the ordinary session path working while proving that the native hook,
checkout capability, and dev-identity header are absent; direct custom-header
assertion is CORS-transport-refused in the browser and generically refused at
the host-side probe. This is materially stronger than inferring web behavior
from the native run's Node Origin-gate request.

The current sessions-first iOS simulator carrier run passed its then-current checks under
`demos/expo-native-checkout-reader/receipts/ios-2026-08-25T15-06-51-734Z/`.
iOS 26 revealed that a separate `simctl openurl` now presents a confirmation
on every development-client launch. Passing Expo's supported `--initialUrl`
argument in the same nonce-bearing `simctl launch` avoids that UI gate without
moving the nonce out of child-environment custody. Relative to ordinary Expo
development, the carrier remains unusually evidence-heavy, but the retained
receipt now proves both the dev-identity admission and the composing ordinary
session/query rather than treating either as implied; the correction below
records why that observation was still not fail-sensitive D2 evidence.

This section originally treated physical Android USB as the only remaining
gate; the correction below supersedes that claim.

## Review correction — 2026-08-25

The first native receipt treated “the client intended to attach the header” as
if the server had witnessed it. That distinction matters in stage 2: a
headerless request is still admitted, so a transport that silently strips the
capability could pass the old application check. The strengthened fixture uses
the actual client connection-grant path and records only the server's
credential-free, post-verification `devIdentityCapabilityWitnessed` result. A
headerless request now produces `false` and fails the positive assertion.

The fixture also mutates a session-owned row before querying and requires at
least one result. The existing iOS and Android-emulator receipts predate the
server-observed check, so they are retained as narrower carrier/negative-path
evidence while their D2 rows return to **NOT YET** until rerun. The next
Expo-web run under
`demos/expo-native-checkout-reader/receipts/web-2026-08-25T19-34-11-484Z/`
was not an honest shipped-topology witness: its Playwright harness read the
owner-only sidecar and intercepted `/connection/open` to inject the capability.
That made the server witness true while the shipped Expo-web binding still
connected directly. The receipt is retained as superseded non-D2 evidence.

Removing the interceptor and rerunning the real bundle produced
`demos/expo-native-checkout-reader/receipts/web-2026-08-25T20-16-02-195Z/`.
This is an **isolation witness only**: the session seeded and read one row,
`serverDevIdentityCapabilityWitnessed`, `checkoutHeaderPresented`, and
`devIdentityHeaderPresented` were all false, invalid assertions were refused,
and `d2Evidence` is false. Expo web therefore returns to **NOT YET** for D2.
If a future positive stamp is required, it belongs on the shipped Vite/proxy
relay with unconditional overwrite, not in test interception. This was
acceptance-test honesty rather than missing app-author guidance; no Guide-gap
ticket was filed.
