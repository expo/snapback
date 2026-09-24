# Clique × Snapback 4 — builder diary

## M1 — Accounts and profiles

**What I built.** Password identity (`use identity password`), public profiles with unique handles, avatar assets, Expo Router auth/feed/profile/settings, seed of `starter-m1.log` through real signup, and the M1 suite plus two-client choreography.

**What felt easy.** Snapback 4’s README password walkthrough mapped almost 1:1 onto M1: Argon2 sessions, `format handle`, unique indexes with `HANDLE_TAKEN`, `client.upload` + `placeAvatar`, `createApp` + `AppProvider`. Live profile edits showed up on Bob without extra wiring.

**What fought me.** `snapback4 init` refused a non-empty lane (instrument symlink). The generated `snapback/server.ts` typecheck wanted Node types. Copied choreography imports `../metering` and `../../lib/json-schema.mjs` from the instrument’s original repo layout — I copied observations into the lane and pointed setup-identity at a local AJV helper (instrument skip: frozen copy is not self-contained). Linux has no npm binary; `SNAPBACK4_BIN` via `npx snapback4` worked.

**Prior familiarity.** Convex/Supabase auth+profiles; Expo Router. Saved time on screen inventory, not on Quarry.

**Missing docs/capability.** No Linux binary package (documented). Init vs non-empty dir. Choreography copy layout not documented for a lane directory.

**Vs alternatives at this step.** Faster than rolling Supabase Auth + RLS for handle uniqueness; closer to Convex “just write the schema.” Asset placement is stricter (upload then mutate) than Supabase Storage URLs.

## M2 — Social feed

**What I built.** Public posts (text/images/video), follow graph, Following vs Global feeds, likes/reposts/replies, Expo feed tabs and composer with fixture media, seed of `starter-m2.log`, suite 22/22, two-client choreography.

**What felt easy.** Quarry `public` + `maintain feed: timeline` mapped onto Following without a custom fan-out table. Toggle mutations (`setFollow`/`setLike`/`setRepost`) are the brief’s idempotent set-state intents. Live counts arrived without extra subscriptions.

**What fought me.** RN-web file inputs: `createElement("input")` inside the React tree crashed the feed (no `sm-feed-item`). DOM `input` on `document.body` plus a capture-phase `change` listener fixed choreography. Video composer preview as a blob URL failed `waitForLoadedMedia`; a 1×1 PNG data URI stands in for the preview while the real MP4 is posted. Feed events join `author` on the event, not the post — PostCard had to take `row.author ?? row.actor`. Expo `--non-interactive` disables HMR, so every UI fix needed a process restart.

**Prior familiarity.** Convex feeds and Expo Router saved screen inventory. Quarry feed maintain / event union was new.

**Missing docs/capability.** No Linux npm binary (documented). RN-web file input is outside Snapback. Semantic values for Playwright need `data-value`/`aria-valuetext` on kit nodes because RN-web `accessibilityValue.text` is unreliable.

**Vs alternatives at this step.** Closer to Convex reactive queries than to Supabase + Realtime + RLS. Asset sniffing (duration/type) is stricter than “upload to a bucket and store a URL.”

## M3 — Messaging core

**What I built.** DMs (one per pair), groups with admin membership, text messages, quoted replies, typing (4.5s server expiry, 3.5s local hide), sent/delivered/read receipts via a `deliveries` table, seed of `starter-m3.log`, suite 7/7, choreography green.

**What felt easy.** Membership-scoped `sync to memberships[.conversationId]` and `expire at` for typing. `openDm` reuse. Quoted `quoteId` pointer plus kit excerpt.

**What fought me.** Receipts: `chatDeliveries first 50 by .id` hid new acks after ~50 rows (choreo m3e failed delivered). Fix was a per-message `messageDeliveries` query plus DeliveryAcker polling after Playwright `setOffline`. Group “delivered” must ignore members who never opened (Erin). Typing expiry needed a local hide clock because `expiresAt` did not drive a re-render. Dave leftover in `g-starter` blocked addable-candidate; remove before re-run. `sm-convo-bubble` wrapping was required so quote clicks hit the row.

**Prior familiarity.** WhatsApp-shaped receipts. Convex presence analogues.

**Missing docs/capability.** No first-class “device fetched message” receipt; the client must `markDelivered`. Page size on deliveries is easy to get wrong. Playwright offline vs Snapback reconnect needed an application poll.

**Vs alternatives at this step.** Typing `expire at` is nicer than a Convex scheduler job. Receipts are more manual than a host that acks on replica apply. Groups as rows + membership is closer to a chat schema you’d write in Postgres than to a black-box channel API.

## M4 — Media messages, reactions, edit/delete

**What I built.** Photo/video messages from fixture files, one-reaction-per-user with replace/remove, 60s edit and 120s delete-for-everyone windows, tombstones, live two-client choreography (all five required checks), suite 5/5.

**What felt easy.** `sendMedia` with server-sniffed video duration. Kit reaction picker + chips. Tombstone text already in the kit.

**What fought me.** Composer file inputs (carried from M2). Video viewer needed a real `<video>` for `sm-media-viewer-video` because the kit renders a poster, not a player. Reaction suite write-id reuse on re-run. Dismissing the picker must not clear the reaction.

**Prior familiarity.** WhatsApp media/reactions. Snapback asset upload from M1/M2.

**Missing docs/capability.** Kit does not own an HTML file input or a video player; the lane must. Edit/delete windows are schema `now - .at` constants matching `config/windows.json`.

**Vs alternatives at this step.** Asset-typed columns (`image once`, `video`) beat storing URLs in Postgres. Window enforcement in Quarry is simpler than a Convex action plus a cron purge.

## M5 — Ephemeral, chat config, search

**What I built.** Per-chat disappearing (`expire at`), view-once `image once`, group accent/background, people/in-chat/grouped/held search, warm-offline search, suite 6/6, choreography all four checks including optional view-once and disappearing.

**What felt easy.** `expire at` plus shortened 180s/300s TTLs. Snapback search `matching q` is word-prefix as the brief requires. Held queries for warm-offline.

**What fought me.** Group background: RN-web `View` drops `data-value`/`src`; Playwright observes `aria-label`. File input had to be a real `input[type=file]`. Upload `POST /assets` returns 429 when admission slots are full — retries in `useUploadBlob`. ChatSettingsView `useEffect` after an early return broke the Rules of Hooks.

**Prior familiarity.** WhatsApp disappearing/view-once. Convex search is weaker out of the box.

**Missing docs/capability.** Asset admission 429 is easy to miss (`why E_RATE_LIMIT` points at personas/assets). RN-web accessibility is not a Playwright semantic channel.

**Vs alternatives at this step.** Server-enforced `image once` and `expire at` beat app-side timers. Search indexes are declared on the table, closer to Postgres FTS than to Convex.

## M6 — Offline writes, push, custom-client, scale replay

**What I built.** Offline queued sends with `pending` receipts (webDevice outbox), push seam via `effect notify` + `snapback/server.ts` JSONL, `API.md` + `custom-client-demo.mjs`, sample-50 replay, scale replay of 167,157 actions on a fresh `--replay --fresh` instance at :56402 in 788s. Suite 5/5, choreography offline-queue green. iOS simulator proofs unavailable.

**What felt easy.** Predicted mutations made pending ticks appear without a custom outbox. `dev --replay` really suppresses emits. `createClient` + `observe` is a small custom-client surface.

**What fought me.** First scale run died at ~22,725 with `E_BOUND` examined-row ceiling 8192 on `chat.sendMessage`: `expire at .expiresAt` made the unique `(conversationId, ordinal)` insert skip expired rows until the meter cut — g0001’s 10,000 messages cannot be inserted under that combination. Fix: drop `expire at` (keep `expiresAt` for client hide) and stop probing `connected[]` in the emit loop. Recorded as a Snapback bound/expiry interaction, not an adapter bug.

**Prior familiarity.** Convex scheduled functions vs Snapback jobs; fixture replay from earlier milestones.

**Missing docs/capability.** `why chat.sendMessage` names the expired-row skip only after you hit E_BOUND at scale. No Linux binary. No iOS simulator on this host.

**Vs alternatives at this step.** Offline writes are closer to a local-first database than to Convex (online) or Supabase (Realtime + optimistic UI you build yourself). Scale bounds are stricter than Postgres.

## M8 — Insights, digest, multi-device

**What I built.** Lifetime insight views, 7-day client-filled zeros, trending last-24h, digest job every 2m writing the push seam, ChatRail on home for cross-device unread, dual-offline convergence. Suite 6/6, choreography 5/5 green including dual-offline receipts.

**What felt easy.** Maintained views (`count likes by .postId.authorId`) and `schedule cliqueDigest every 2m`. Multi-device unread because memberships sync to the conversation partition.

**What fought me.** RN-web like buttons needed `aria-pressed`/`data-liked`. Chat list had to be visible on `/` (`sm-chats-item`) because M8 goes to `baseUrl` not `/chats`. Insights tiles needed `data-count`.

**Prior familiarity.** Analytics dashboards; WhatsApp multi-device.

**Missing docs/capability.** Simulator still unavailable. Digest payloads are effect logs, not APNs.

**Vs alternatives at this step.** Scheduled jobs are first-class, like a tiny pg_cron, without Convex’s “cron in code” or Supabase’s extra Edge setup. Multi-device sync is the local replica, not a presence channel you invent.
