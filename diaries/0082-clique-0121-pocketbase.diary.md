# Diary 0082: Clique 0.1.21 PocketBase exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-pocketbase/`

**Lane:** `sol-pocketbase`

**Model:** GPT-5.6 Sol, high effort

**Backend:** PocketBase 0.39.9 server / 0.27.3 JS

## 1786756184 — M1 boundary (green, 751 seconds)

Built the Expo Router shell, lane-local PocketBase runtime and schema, public signup plus built-in password authentication, persistent native/web auth storage, exact profile fields, unique handles, avatar storage, live profile subscriptions, settings/logout, acceptance coverage validation, and the first iOS Hermes export. The frozen UI kit was consumed verbatim from a lane-local npm pack artifact so Metro and TypeScript could resolve peers without reaching outside the lane at build time.

PocketBase auth and realtime were easy: registration, password verification, field validation, file upload, and record subscriptions all fit the app directly. The schema API was pleasantly fast once the server stayed up. What fought me was setup at the package/lifecycle edges: npm-latest React Native was newer than Expo 57's bundled native version, a `file:` UI dependency became a symlink whose peer resolution escaped the app tree, and the first background server inherited a short-lived shell. The Expo bundled-native manifest, the frozen kit package metadata, the PocketBase binary help, and the published SDK source saved time. PocketBase's auth-record create response also correctly hid email before authentication, but that behavior was not obvious until the acceptance assertion failed.

Workarounds: pack the frozen UI kit into a lane-local tarball; retain long-running processes through exec sessions; derive Expo companion versions from `bundledNativeModules.json`; seed fixture actions through individual users' normal auth/mutation clients. Ownership friction was low for a single profile: record update rules express “owner may edit” directly and the handle index is genuinely server-authoritative. Logout in this reduced run clears the client token; PocketBase's stateless token model does not provide a first-class per-session revocation row, and the contract's old-token API probe is full-run-only.

## 1786756608 — M2 boundary (green, 424 seconds)

Built top-level text/image/video posts, fixture media upload and serving, follows, likes, reposts, replies, Global/Following projections, self-membership semantics, server paging, live PocketBase subscriptions, feed/profile/thread navigation, URL linkification through the frozen kit, and exact suite coverage for all 22 M2 suite-required assertions. The final choreography run passed all seven implemented checks; its two media-composition skips were explicitly optional because the frozen contract has no media-picker test ID. An iOS Hermes bundle was exported.

PocketBase relations, file arrays, unique compound indexes, expansion, filters, and collection-wide realtime events made the social model compact. The awkward part was not the backend; it was matching route lifecycle and accessible surface expectations in a retained Expo Router stack. PocketBase's schema API also does not silently add `created`/`updated` to hand-authored collection payloads: my first bootstrap lacked autodate fields, which made `sort=created` fail with a generic 400. Declaring the fields fixed both live ordering and paging. The published SDK source was useful for filter and expansion behavior; the 400 diagnostics were accurate about validation but shallow for invalid sort fields.

Workarounds: compute Following projection client-side from indexed follow edges plus implicit self; merge original and repost streams in the client for this starter envelope; render profile-level feed navigation so the frozen choreography can return to feeds; suppress the inactive Home route so test IDs remain unique. Authority friction was moderate. Record rules express actor ownership for follows/likes/reposts directly, but richer feed projection is application query logic rather than a reusable policy/read-model primitive. Media serving is easy, while future per-recipient revocation would require protected files plus a hook or custom route.

## 1786756690 — M3 boundary (green, 82 seconds)

Built deterministic DM identity, distinct groups, memberships and creator-admin authority, live text messaging, per-message sender/avatar expansion, quoted pointers and excerpts, typing records with expiration, receipt storage and sent rendering, chat-list/conversation routes, and the full M3 starter replay. The acceptance suite passed every M3 suite-required assertion, including a second full starter replay with unchanged entity counts. The implemented choreography passed live two-way DMs, typing timing/expiry, and quoted excerpt/jump. The frozen harness separately emitted four honest optional skips for surfaces it cannot semantically drive. The final iOS Hermes bundle and raw receipts are present.

The easy parts were the same PocketBase strengths as M2: one relation-backed message create produces a realtime event immediately, expansions return the sender and quote graph, and a unique `dmKey` makes one-DM-per-pair unambiguous. Typing was less natural. PocketBase realtime is record-oriented, so ephemeral typing became durable rows plus client-maintained expiry and cleanup rather than a presence primitive. It passed comfortably but is conceptually heavier and leaves expired rows unless swept. The docs covered SDK subscriptions and collection rules; they did not provide a purpose-built recipe for aggregate receipts or membership-at-send recipient snapshots.

Workarounds: represent typing as an upserted record with an authoritative expiry timestamp and client-side visibility cutoff; use the message relation itself for quote navigation; model membership authority with collection rules keyed to the conversation creator. Ownership friction becomes real in groups. The creator-only rule cleanly denies a non-admin, but fully expressing promoted admins, self-leave, removed-member historical access, membership-at-send receipt sets, and “new members see history” would need more nuanced back-relation rules and likely server hooks/custom routes. PocketBase can host that logic, but the declarative rule layer alone is not a complete group-messaging authorization language.
