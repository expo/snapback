# Clique / grok-clique-supabase diary

## M1 — Accounts and profiles

Built Expo Router web (SDK 57) on hosted Supabase (`@supabase/supabase-js@2.112.4`) with every table, bucket, function, and Realtime channel namespaced `grokclq25_`. Auth uses Supabase password credentials; profiles, handle uniqueness, avatar storage, and session persistence are in. Starter-m1.log replays through the same RPCs the UI uses. Acceptance is `npm run acceptance -- --milestone mN`.

Easy: Supabase Auth + unique handle constraint expressed the M1 data rules directly; the frozen AuthForm/ProfileForm IDs lined up with choreography.

Fought: Expo `start --web` died on this host because React Native DevTools' Chromium sandbox is misconfigured, so web proof is `expo export` + a static server on 48300. `expo-router` `<Link asChild>` crashed RN-web with a CSSStyleDeclaration error; nav uses `router.push`. Hosted Realtime was slow enough that profile live-update needed a short poll alongside `postgres_changes`.

Prior familiarity: password auth, RLS, storage public URLs, Playwright against `data-testid`.

Missing: a local Supabase we could bind inside 48300–48319 (no Docker/CLI here); DevTools sandbox docs for this CI image; a first-class ephemeral presence primitive (not needed until M3 typing).

## M2 — Posts and the follow graph

Posts (text/images/video), likes, reposts, replies, Following/Global feeds with keyset paging, and the follow graph all go through `grokclq25_*` RPCs. Starter-m2.log replays through that path. Feed tabs live in the authenticated chrome so choreography can still click them after a profile navigation.

Easy: SQL feed union of originals + reposts expressed the Following vs Global rule cleanly; like/repost live counts just worked once the list was polling.

Fought: `expo-router` `<Link>` already bitten us; M2 then hid feed tabs on `/profile/{handle}` so follow-toggle choreography could not get back to the feed. Own-profile `sm-profile` innerText started with the kit’s “Edit profile” button, so the author-name check read the wrong first line. Viewer-repost vs follow-projection needed a tab-change list clear so stale Global cards were not counted as Following hits.

Prior familiarity: reverse-chrono feeds, idempotent like/repost, Playwright `hasText`.

Missing: a compose media-picker contract ID (image/video live delivery is an optional choreography skip by design).

## M3 — Messaging core

DMs (pair-unique), groups as entities, quoted replies, typing via namespaced Realtime broadcast, and seed replay of starter-m3.log. Chat list lives in the authenticated sidebar so two-client DM open does not need a contract chats-tab ID.

Easy: `ensure_dm` with a sorted-pair unique key made “open the same DM again” a constraint instead of an algorithm. Broadcast typing hit the 2s/5s windows once both clients were in the conversation.

Fought: `list_messages` originally computed aggregate receipts with nested EXISTS and was too slow for live poll; Playwright `fill` on RN-web controlled `TextInput` did not always update React state so Send stayed disabled. A capturing `input` listener on `sm-convo-input` bridged that. Suite login needed `networkidle` plus click-before-fill after the feed grew heavy.

Prior familiarity: WhatsApp-style quote excerpts, membership-at-send-time receipts (implemented, not choreography-gated).

Missing: a purpose-built ephemeral typing primitive with server-side expiry; we used broadcast plus client timers. Native iOS/Hermes remains environment-null on this Linux host.
