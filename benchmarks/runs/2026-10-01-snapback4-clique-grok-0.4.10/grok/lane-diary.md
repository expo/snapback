# Clique on snapback4@0.4.10 — diary

## M1 — Accounts and profiles

Built password identity, public profiles with unique handles, avatar uploads, Expo Router auth + profile screens, an idempotent starter seed, and the M1 acceptance suite. Two-client choreography is green after wiring the frozen UI kit test IDs and keeping feed tabs in the signed-in chrome.

Easy: `use identity` plus `unique handle else HANDLE_TAKEN`, `client.upload` / `placeAvatar`, and `npx snapback4 new --template social` as a documented starting shape.

Fought: choreography setup-identity (binary must sit under the identity directory), metering imported as `../metering`, Expo `CI=true` disabling Metro reloads, and logout leaving the SPA on `/settings` so the post-login surface had no feed tabs until chrome tabs were always mounted.

Prior familiarity: Expo Router layouts and Playwright locators. Snapback 4’s published README/guide were the only backend teacher.

Missing capability/docs: the social template’s receipts/once-media recipes are excellent; the published surface does not mention the benchmark’s setup-identity hash layout.

Backend comparison at this step: closer to Convex than Supabase on identity+storage in one schema file; handle uniqueness is a one-line table constraint instead of a SQL unique index plus an RPC.

iOS Hermes export: `artifacts/ios-m1`.

## M2 — Posts, follows, feeds, likes, reposts, replies

Built public posts with image/video, a follow graph, Global/Following/Trending, likes/reposts/replies, and a `/post/[id]` thread composer. Suite was already green; choreography went green after own-key `follows` plus a planned `home` query (so follow/unfollow overlays on the device) and optimistic `setRepost`.

Easy: public `posts`/`likes`/`reposts` with `sync public last N by .at with own keys`, and `view activity` as a union of originals and reposts.

Fought: `view following` materialization plus `online only` follows meant `setFollow predicts: never`, so Following did not live-update. Profile `sm-feed-item` cards also polluted feed-projection counts until those posts used a different testID and the chrome feed hid off `/`. Reply had to navigate to a thread screen, not reuse the feed composer.

Prior familiarity: feed-tab chrome from M1.

Missing: the feeds guide shows both planned `home` and materialized `view following`; live follow-edge overlay needs own-key follows and a device `exists follows[viewer, .actor]` filter, which the social template’s online-only follows do not give you.

Backend comparison: closer to Convex reactive queries than to Supabase RPC+realtime. Own-key coverage is the distinctive Snapback 4 piece — likes overlay immediately; follow/repost inserts that cannot prove absence still queue.

iOS Hermes export: `artifacts/ios-m2`.

## M3 — DMs, groups, typing, receipts, quotes

Built `openDirect`/`createGroup`, history, SDK `reports delivery` plus screen `seen`, ephemeral typing, quoted replies from the in-memory history row, and group member add/promote/remove/leave with retained history after cutoff.

Easy: the receipts guide’s `delivered`/`seen`/`receipt()` function is copy-pasteable; typing `ephemeral 4s` just works for the 2s/5s choreography clocks.

Fought: concurrent `openDirect` with `mintId()` created two chats; quoted excerpt needed the history row because `quotedMessage` lagged; after `removeMember`, `namedGroup` dropped the route and `useQuery(history)` emptied, which is documented (“membership removal replaces the answer”) and fights `retain delivered-history` unless the screen holds the last page.

Prior familiarity: kit `ReceiptTicks` semantic tokens (`sent`/`delivered`/`read`).

Missing: a first-class “keep last replica page after leave” hook. The receipts guide’s `useReceipts` is the right shape; it does not itself retain the transcript on membership loss.

Backend comparison: this is the strongest Snapback 4 showing versus Convex/Supabase — ordinals, runs, join floors, and retain-delivered-history are one schema, not a pile of presence channels and read receipts tables.

iOS Hermes export: `artifacts/ios-m3`.

## M4 — Media messages, reactions, edit/delete

Built photo/video messages, reaction chips, 60s edit and 120s delete-for-everyone windows from `config/windows.json`.

Easy: `editMessage`/`deleteMessage` with `require now - m.at <= N` is the whole window. Kit `ReactionPicker` is presentational; `upsert reactions` is the toggle.

Fought: choreography fills caption and clicks send before `client.upload` returns, so the first green path was text-only without `sm-convo-media`. Video inline used the poster asset as `src`. `useQuery(api.profileByPrincipal, { principal: "none" })` throws and took down ConversationView.

Prior familiarity: feed media upload from M2.

Missing: upload is online-only with no queued-bytes story in the published client; the lane has to await in-flight upload on send.

Backend comparison: asset ids on rows plus `useAsset` blob URLs beat Supabase signed-URL plumbing. The throw-on-bad-principal is harsher than Convex’s empty query.

iOS Hermes export: `artifacts/ios-m4`.

## M5 — Disappearing, view-once, chat config, search

Built chat color/background, disappearing TTL 180s/300s, view-once photos, and word-prefix search over replica inbox snippets.

Easy: `expire at .expiresAt` with `disappearingTtl`; view-once `image once`; kit disappearing segments already expose `aria-valuetext` `24h`.

Fought: Expo Router `[group].tsx` beside `[group]/settings.tsx`; DM settings pushed `/conversation/<uuid>/settings` with no route. `search`/`people` are N_SYNC_ORDER server-leaning, so warm offline search needed `inboxSnippets` plus a client word-prefix filter.

Prior familiarity: kit ChatSettingsForm candidates and semantic values.

Missing: a device-complete search over membership-scoped messages whose sync key is ordinal not `at`. Recorded as a query-horizon gap, worked around in the client.

Backend comparison: server-enforced expiry with no client open is a Snapback 4 win over Convex cron-plus-delete and Supabase scheduled jobs. Search is the place Supabase/Postgres still feels simpler.

iOS Hermes export: `artifacts/ios-m5`.

## M6 — Offline, push, custom client, replay adapter

Built pending sends (`usePendingWrites` + `receiptPending`), a notifications worker appending `data/push-log.jsonl`, `scripts/custom-client-demo.mjs`, and `scripts/replay.mjs` / `scripts/scale-replay.mjs` through the same auth/mutation path as the app.

Easy: `waitSeconds: 0` plus replica outbox; m6 choreography (single-client offline queue flush) passed on the first try after M4/M5 send path was solid. `effect notify` + `connected[p]` is the push seam.

Fought: none on the green bar. The scale replay is a separate clock on port 49362.

Prior familiarity: M3 receipts pending glyph.

Missing: the published worker contract is a JS file under `snapback/workers`; the guide is thin on JSONL logging shape, so the lane chose a line format.

Backend comparison: offline mutation queue is closer to a local-first database than to Convex (online by default) or Supabase (you build the queue). Custom-client `createClient` + generated `api` handles is the same surface as the React app, which Convex also does and Supabase splits into REST/JS client vs RLS.

iOS Hermes export: `artifacts/ios-m6`.

## M8 — Insights, trending, digest, multi-device

Built `insights`/`insightDay`, trending by `likeCount`, `schedule dailyDigest every 2m`, and two-device Alice contexts.

Easy: digest job looping profiles and `emit notify once [principal, periodEnd]`. Trending predicate read from the feeds guide.

Fought: Insights tiles rendered `0` while the server query was still loading, so choreography read zero twice. Dual-offline convergence failed until OpenDirect froze the conversation id (a late `directConversation` hit was remounting the screen and dropping the other device’s queued send).

Prior familiarity: M6 pending receipts; M2 like counts.

Missing: insights as a server loop over posts is meter-sensitive; a maintained `receivedLikeCounts` cannot inherit public sync because `.postId.authorId` is not a likes group key. Client `max(server, sum of userPosts.likeCount)` covers the live like.

Backend comparison: multi-device same-account live messages felt like Convex reactivity. Dual-offline two-replica flush is a Snapback 4 story Supabase would not give you without a local database. Digest-as-schema is nicer than either alternative’s cron product.

iOS Hermes export: `artifacts/ios-m8`.
