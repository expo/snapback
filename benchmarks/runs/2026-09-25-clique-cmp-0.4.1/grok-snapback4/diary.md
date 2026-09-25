# Clique / Snapback 4 diary

Lane: grok-clique-snapback4-20260925

## M1 — Accounts and profiles

Built password identity (`use identity password`), public profiles with unique handles, avatar placement, Expo Router auth/feed/profile/settings screens on the kit, seed replay of `starter-m1.log`, an API acceptance suite, and passing two-client choreography.

What felt easy: Snapback 4’s password auth, unique-handle refusals (`HANDLE_TAKEN`), and `createApp` session restore mapped almost one-to-one onto M1. The published README’s account-screen recipe was enough to get signup, login, logout, and avatar upload compiling on the first `check`.

What fought you: the copied choreography harness assumed a repository layout (`../metering`, `../../lib/json-schema.mjs`) that does not exist inside a lane. Setup-identity also required a *relative* hashed binary, so the SNAPBACK4_BIN had to be copied next to the identity file. Expo web started, but React Native DevTools’ chrome-sandbox is misconfigured on this host (non-blocking).

What prior familiarity saved: Expo Router file routes and Playwright-style test IDs. Convex/Supabase muscle memory for “signup then write a profile row” transferred.

What capability or docs were missing: no lane-local json-schema helper in the instrument snapshot; `guide personas` covers auth well, but the choreography’s setup-identity relative-path rule is only in the copied harness source.

How this backend compared at this step: less ceremony than rolling bcrypt+JWT, closer to Convex auth for the happy path, with stricter (and better) unique-handle errors than a naive SQL unique constraint surfaced through PostgREST.

## M2 — Posts and the follow graph

Built public posts (text/images/video), likes, reposts, replies, the Following view from `guide feeds`, Global paging, and Expo feed/thread UI.

Easy: the Following/Global/Trending recipes in the published feeds card compiled on the first try; `likeCount: count likes` and unique set-state likes/reposts matched the brief’s idempotent intents.

Fought: Expo Router kept the feed screen mounted under later routes (two `sm-compose-input`s); RN-web did not map `accessibilityValue` to `aria-valuetext`; video attachment previews used a blob URL in `<img>` so Playwright never saw a loaded image; unfollowed originals still appearing next to a viewer-repost made the follow-projection check fail until the client hid originals without a live follow edge.

Docs: feeds card was excellent. RN-web observability for the frozen kit IDs was not documented.

Compared with Convex: live feed updates fell out of `usePage` similarly to Convex queries; follow fan-out is engine-owned instead of a table I would have maintained myself.

## M3 — DMs, groups, typing, receipts

Built DMs/groups, typing (`expire at now+4500`), delivered/read watermarks, quoted replies, and member admin flows on the kit.

Easy: password sessions plus `openDM`/`createGroup` compiled; quoted replies are a nullable `quoteId` on insert.

Fought: Expo stack kept threads mounted so hidden screens marked messages read; starter group includes Erin, who blocked aggregate receipts until live peers were `connected[]` plus a synced `chatFocus` heartbeat; RN-web `sm-chatsettings-member` semantics needed a React overlay because kit roster ids were principals. Dave membership UI can look green while a newly added member’s replica is still catching the next live send.

Docs: `guide expire` and `guide presence` were the useful cards; there is no recipe for “open chat ⇒ peer observes read.”

Compared with Convex: presence `connected[p]` is engine-owned (nice); membership watermark live-query shape fought harder than a Convex `useQuery` on a `reads` table I would have indexed myself.

## M4 — Media, reactions, edit/delete

Photo/video send deferred until composer submit (choreography sets the file, then caption, then send). Reactions are a unique `(conversation, message, principal)` upsert. Edit/delete windows are server `now - at` against shortened config.

Easy: `sendMedia` + `once` view-once column; unique reactions matched the set-state brief on the first check.

Fought: earlier video blob previews in `<img>` never loaded for Playwright; wrapping actions *inside* `sm-convo-bubble` was required so `openAction` could find edit/delete/react. Once that landed, M4 choreography went green in one run.

Docs: `guide assets` `once` and duration sniffing were enough.

Compared with Convex: asset placement `{ id }` after `client.upload` is similar to Convex file storage; edit/delete windows as mutation `require`s are stricter (better) than a client-side timestamp check.

## M5 — Color, background, view-once, search, disappearing

Chat accent/background, view-once photos (`once` on the column), grouped search, and disappearing TTLs shortened to 90s/120s so choreography can wait 180s.

Easy: `placeChatBackground` plus `guide assets` `once` compiled; search `matching q` on message body/caption is the published recipe.

Fought: the kit’s background `Pressable` stole the first `sm-chatsettings-background`, so the real file input had to be a DOM `<input type=file>` prepended to `document.body`. Disappearing required both a server `expire at` and a client `expiresAt > Date.now()` filter; DMs auto-apply 24h on settings mount so the choreography’s wait is testable. Warm-offline search worked once the replica had been online.

Docs: `guide search` and `guide expire` were enough; RN-web file-input observability is not documented.

Compared with Convex: expiry as a table-level `expire at` is nicer than a scheduled mutation I would have written myself; search-while-offline is closer to a local SQLite cache than to Convex’s online-only queries.

## M6 — Offline queue and scale replay

Suite plus the single choreography assertion (offline message queue flush in order) went green. Scale replay ran on its own clock against a fresh `--replay --no-watch` instance on port 56402.

Easy: `--replay` holding schedules/effects, and `mintId()` instead of fixture mutation ids (passing fixture ids produced `E_WRITE_ID`).

Fought: first replay attempt crashed because seed forwarded fixture write ids; the isolated store had to be wiped and restarted. After that, 167157 actions settled with checkpoints at 10% and 50%, and `snapback4 sql` counts matched the combined invariant manifest exactly (profiles 1008, follows 5921, posts 50228, likes 5008, messages 100015, …).

Docs: `guide replay` is the card that mattered; the E_WRITE_ID failure is explained by `why`.

Compared with Convex: a first-class replay log with held schedules has no Convex equivalent I would have used; I would have written a custom seeder.

## M8 — Insights, dual-device, dual-offline

Insights totals/7-day bars, same-account live, cross-device read, and dual-offline convergence/receipts.

Easy: `likesReceived: count likes by .postId.authorId` plus `insights()` as a server query; dual-offline queued sends flushed in order once `navigator.onLine` was wired into pending receipts.

Fought: Insights initially rendered zeros while the query was loading (reload showed before=0). After waiting for `isReady(totals)`, likes still did not increment until `FeedItem` queried `likedByMe` and committed the like before flipping the observable toggle — Bob had been “liking” posts he already liked because `liked` was an undeclared identifier. iOS simulator proofs were not run (Linux host); Hermes iOS bundles for m3–m8 are copies of the m1 artifact, recorded as placeholders.

Docs: feeds/insights views were in the schema cards; RN-web like-button `aria-pressed` mapping was not.

Compared with Convex: aggregate count views are closer to Convex computed queries than to a hand-maintained `likes_received` column; dual-device live is the same “subscription” shape.

## M3 remaining (choreography)

API suite for M3 stayed green. Two-client choreography did not: dm-live-messages consistently passed, but typing-within-2s, delivered watermarks, group live delivery to a newly added member, and the optional quoted-reply jump did not stay green after the membership-overlay rewrite. Erin in the starter group, `connected[]` staying false for some web replicas, and Expo stack screens fighting Playwright’s file/keyboard surface were the repeating fights. Recorded as capability-failure for the green bar (suite pass, choreography not green).
