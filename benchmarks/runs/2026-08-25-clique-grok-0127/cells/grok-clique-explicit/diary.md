# Diary — grok-clique-explicit

## M1 — Accounts and profiles

Built: Expo Router Clique on Snapback 0.1.27 explicit (`schema.mjs` / `functions.mjs`), sessions + built-in password auth (`durable-required`, `minimumLength: 8`), profiles with unique handles, avatar upload via generated command, frozen UI kit, starter-m1 replay through `signUpWithPassword` + `saveProfile`, Playwright suite, two-client choreography.

Easy: the expo-chat start packet and generated `useSnapbackAuth` / `useSnapbackQuery` / `useSnapbackSettledMutation` surface were enough to get signup, live profile edits, and logout revocation without inventing tokens.

Fought: inline handlers cannot close over `const` regexes; Node `memory` platform cannot satisfy durable custody; this host had no Chromium GTK/X11 libs; HomeScreen remounted on auth and dropped HANDLE_TAKEN errors; calling `setProfile` in the same tick as signup used a stale anonymous dispatcher.

Explicit profile: writing `schema.mjs`/`functions.mjs` by hand made unique indexes and `ctx.refuse` codes obvious. Cost: codegen refusals (`SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER`) and a large generated graph to keep out of.

Missing docs: that supervised Expo bakes an integration-receipt descriptor identity at first Metro start, and that `snapback dev` stdin is `/dev/null` when launched without a control pipe — so later schema successors can rotate the backend while the web arm still admits the first identity.

## M2 — Posts and the follow graph

Built (backend): additive tables `follows`, `posts`, `likes`, `reposts`; mutations `setFollow`, `createPost`, `setLike`, `setRepost`; live queries; starter-m2 replay of 52 actions. Lifecycle reported `startup-successor-activated` with `continuity.accounts/sessions/stores: preserved`. Old schema `…2d884c32…` → new `…f6d3f2a1…`.

UI: feed assembly (Following vs Global, repost attribution, 20-item pages), thread replies, profile follow counts.

Fought: after the successor loaded, the web client refused with `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`. File identities matched the new descriptor; the running Expo extra/integration receipt still named the M1 descriptor from first Metro boot. Lifecycle control verbs could not be delivered (`fd/0 → /dev/null`). Did not pkill.

Explicit profile: additive `defineTable` successor was routine and the watch loop activated it. Cost: any functions.mjs edit rotates bundle identity, and the Expo web carrier did not follow that rotation in this launch mode.

Missing: a documented, non-destructive way to refresh the supervised Expo integration receipt after an in-lifecycle schema successor.

## M3 — Messaging core

Not built on the web client. Messaging UI remaining from the expo-chat scaffold was stripped for Clique routes; adding conversations/ephemeral typing would have required another identity-rotating generate. Recorded blocked-by-M2 for web authoring green. Native iOS/Hermes: environment-null on this Linux host.
