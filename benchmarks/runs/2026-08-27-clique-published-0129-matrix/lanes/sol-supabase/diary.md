# Clique Supabase build diary

## M1 boundary — 1787853953

Built real email/password accounts on Supabase Auth, lane-prefixed profiles with server-side handle uniqueness, private Storage avatars, persistent browser sessions, profile editing, RLS, and Realtime profile refresh. The suite and frozen two-client choreography both finished green.

What felt easy: Auth password sessions, authenticated RPC calls, unique Postgres constraints, and private bucket upload/download were direct. What fought me: current Expo/npm peers had to be aligned to Expo's bundled React Native pin, npm initially tried to install inside the read-only UI-kit tree, and the first choreography run exposed that a successful re-login must reset `/settings` back to an authenticated landing route. Prior familiarity with Supabase Auth/RLS and React Router-shaped state made the backend and route correction quick. Missing capability/docs: Expo's headless DevTools launch produced a sandbox diagnostic unrelated to the product, and npm's first peer error did not identify Expo's bundled-version source; `bundledNativeModules.json` supplied the decisive pin.

## M2 boundary — 1787858493

Built text/image/video composition, private media delivery, Following and Global projections, live like/repost/reply behavior, attribution, URL-safe text rendering, and deterministic feed pagination checks. The suite and all nine frozen browser choreography assertions are green.

What felt easy: Postgres set-state RPCs and Realtime table subscriptions mapped cleanly onto likes, reposts, and replies. What fought me: the choreography observes tab state at the event boundary, so normal asynchronous React hydration briefly exposed the prior tab; repeated hosted round trips also amplified signed-URL and chat-loading latency. Prior familiarity with optimistic caches, request generations, and atomic Postgres advisory locking supplied the decisive fixes. Missing capability/docs: React Native Web drops the kit's `accessibilityValue` into no queryable DOM attribute, requiring a small semantics bridge; Supabase Storage signed URLs also needed an application cache because the client surface provides no projection-aware media batch primitive.

## M3 boundary — 1787859831

Built pair-unique DMs, distinct groups, live bidirectional messages, v2 typing expiry, sent/delivered/read receipts, quote jumps, and the full add/promote/remove/re-add/leave lifecycle with live cutoff. Seven atomic assertions and all required frozen choreography checks are green.

What felt easy: Realtime Broadcast gave typing an excellent final-keystroke response, and Postgres constraints/RPCs expressed the group invariants cleanly. What fought me: showing the composer before the authenticated sender ID existed made a frozen immediate click a no-op; Home originally delayed delivery acknowledgement behind unrelated feed hydration; and navigation canceled membership fetches. Prior familiarity with optimistic insertion, keepalive requests, and transaction advisory locks made each race concrete. Missing capability/docs: there is no Supabase client option to mark an individual RPC fetch `keepalive`, so the navigation-critical mutation uses the published REST RPC surface directly with the current Auth token.

## M4 boundary — 1787860238

Built normal photo/video messaging, remote media loading/playback, one-reaction-per-user replacement/removal, one-minute edits, and two-minute delete-for-everyone tombstones. Five atomic assertions and all five frozen browser checks are green.

What felt easy: private Storage plus message rows made media authorization explicit, and unique reaction keys made replacement semantics nearly automatic. What fought me: Storage `upsert` needs SELECT even before a message row exists, creating an authorization cycle for owner uploads; the frozen video loader also expects a stable container before its media child mounts. Prior familiarity with additive RLS policies and stable async DOM roots resolved both without weakening recipient access. Missing capability/docs: the Storage upsert error reported only a generic RLS failure and did not identify the missing SELECT leg.

## M5 boundary — 1787861634

Built synchronized chat accents/backgrounds, one-time media refusal, warm-offline search, prefix search, and shortened disappearing-message visibility. The atomic suite and frozen web choreography are green. The separate O5 replay is not conforming: the generated log and all verbs validated, but hosted Supabase Auth rate-limited real sequential signups after only the initial prefix, before any checkpoint; the invariant envelope and probes were therefore invalid and receive the failure band.

What felt easy: Postgres full-text prefix search and expiry predicates were compact, and offline fallback over warmed message storage behaved predictably. What fought me: RN Web omitted swatch state and represented the kit preview as a background div; recipient Storage policy did not naturally cover conversation backgrounds; and hosted Auth's signup quota stopped the scale corpus long before database throughput mattered. Prior familiarity with correlated RLS, semantic DOM shims, and checkpoint-bound receipts kept the failure honest and attributable. Missing capability/docs: the hosted credentials expose no lane-local Auth rate-limit override or disposable second project, so the published scale workload cannot be validly completed through real signup on this project.

## M6 boundary — 1787861953

Built push-payload logging, a documented external-client surface, a clean-running custom client demo, full action-schema sample replay, and ordered offline message reconciliation with normal read receipts. The web suite and frozen choreography are green; iOS Simulator, Xcode, and Hermes export are environment-null on this Linux lane.

What felt easy: the REST/RPC surface was naturally usable outside the app, and local queue persistence mapped cleanly to idempotent message IDs. What fought me: the sample fixture deliberately separates logical actor IDs from public handles, exposing an adapter assumption that starter fixtures had hidden. Prior familiarity with offline single-flight flushes and schema-driven adapters made the correction small. Missing capability/docs: native authoring proof is unavailable on this host by definition; no product failure is inferred from that absent environment.

## M8 boundary — 1787862303

Built lifetime Insights, seven UTC activity buckets, 24-hour ranked Trending, same-account live delivery, cross-device unread clearing, and ordered convergence/read receipts for two warm-offline clients. The suite and all five frozen browser checks are green; the native leg remains environment-null on this Linux web-only lane.

What felt easy: aggregate SQL and deterministic ranking with a newest-first tie break were natural in Postgres, while existing Realtime subscriptions carried same-account state without a new service. What fought me: the kit’s like control exposed selection only in its accessible label on React Native Web, and a Realtime commit briefly overlapped with a same-ID optimistic queue entry. Prior familiarity with accessibility projections and identity-based reconciliation made both corrections small and testable. Missing capability/docs: Supabase gives durable events but no built-in client-side optimistic/Realtime merge policy, so exact-once rendering remains application-owned.
