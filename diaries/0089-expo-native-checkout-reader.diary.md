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
