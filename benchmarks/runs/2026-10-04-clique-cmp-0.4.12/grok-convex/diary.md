# Clique Convex lane diary

## M1 — Accounts and profiles

**What I built.** Email/password auth with bcryptjs (cost 10) in Convex mutations, server-side sessions, profile fields exactly as specified, avatar upload through Convex file storage, Expo Router shell using the frozen UI kit, seed replay of `starter-m1.log`, acceptance suite, and two-client choreography.

**What felt easy.** Convex schema + indexes and `npx convex dev --once` in `CONVEX_AGENT_MODE=anonymous` came up on the assigned ports (`55501`/`55502`) without an account. Queries are automatically reactive, which is the whole point of the M1 live-profile check.

**What fought me.** The copied choreography tree imports `../metering` and `../../lib/json-schema.mjs`; those paths assume the instrument layout, so the copy was not runnable until those were linked. Expo web failed first on a missing `babel-preset-expo`, then on a JSX syntax error around `createElement`. Metro CI mode disabled fast refresh, so each fix needed a full rebundle.

**Prior familiarity.** Convex mutations/queries/file storage and Expo Router file-based routing. No prior Clique implementation was consulted.

**Missing capability/docs.** Hidden CLI flags `--local-cloud-port` / `--local-site-port` are `hideHelp()` in convex@1.45.0; discovered from package source. Anonymous dashboard URL printed as `null`. Node on PATH is 24.13.1, not the 24.18.0 named in ENVIRONMENT.md.

**Vs other backends at this step.** Convex local anonymous mode is closer to “run a binary” than hosted-project onboarding (no login). Password auth is not a first-class built-in the way some BaaS products ship it — I hand-rolled bcrypt in a mutation, which the brief allows. Reactivity is the win: profile edits appear on the other client without a refresh path I had to invent.

## M2 — Posts and the follow graph

**What I built.** Posts (text/images/video), follow graph, likes/reposts as set-state intents, replies excluded from feeds, Following/Global pagination, live two-client feed.

**What felt easy.** Convex reactivity made like counts and new posts appear on the other client once the query was shaped right. File storage upload URLs are a short, documented loop.

**What fought me.** Expo Router `push('/?tab=global')` stacked a second home screen so `sm-feed-item.first()` was an invisible duplicate. RN-web does not always emit `aria-valuetext` from `accessibilityValue` on `View`/`Text`; I added `dataSet.value` on the vendored kit copy. Video attachment previews are `<Image>` in the kit, so a video blob URL never becomes a loaded `img` — a 1×1 PNG poster unblocked choreography.

**Prior familiarity.** Feed fan-in vs filter-at-read; I chose read-time filter on `feedEvents`.

**Missing capability/docs.** RN-web accessibility mapping is not in Convex docs (client problem). Hidden Convex port flags already noted.

**Vs other backends.** Live likes without a custom subscription API is Convex’s shape. Pagination cursors I had to invent on `createdAt` rather than getting a skip/offset helper.

## M3 — Messaging core

**What I built.** DMs (one per pair), groups, quotes, typing, receipts, membership admin actions, idempotent seed.

**What fought me.** Convex optional validators reject `null` (only `undefined`) — conversation sends silently failed until I stripped `mediaStorageId: null`. Group receipts waited on Erin from the starter roster; I treated members without presence as not required. Typing expiry needed a client timer because queries don’t re-run on wall-clock.

**Easy.** Once sends actually landed, live DM delivery via a thin `messages.texts` query was immediate.

**Vs other backends.** Presence/receipt aggregation is fully hand-rolled; Convex gives you the table and the subscription, not WhatsApp semantics.

## M4 — Search, offline writes, push seam

**What I built.** Word-prefix search over people and messages, a localStorage message corpus for offline search, queued composer writes, and a `pushLogs` table as the notification seam (preview, chat id, sender name).

**Easy.** Convex indexes on tokenized words made prefix search a straightforward range query. File-storage URLs for photos/video already existed from M2.

**Fought me.** Send raced the upload promise until I awaited `uploadWait`. History originally omitted `mediaUrl`, so Bob never got a loadable image. RN-web Image cannot preview a video blob.

**Vs other backends.** Offline is entirely a client problem — Convex HTTP mutations have no outbox. The push seam is just another table plus a query, which is honest and small.

## M5 — Chat customization, view-once, disappearing, custom client

**What I built.** Per-chat accent + background (Convex storage), view-once open records, disappearing TTL from `windows.json`, a headless custom-client demo script, and sample-50 actor-id → handle mapping.

**Fought me.** Expo Router `Stack` plus RN-web `StyleSheet.absoluteFill` overlays intercepted Settings clicks; switching the root to `Slot` and a native `<button>` unblocked it. Metro served a stale bundle with two `sm-chatsettings-background-preview` nodes until `expo start --clear`. Optional disappearing is still fail-closed in the harness, so I had to wait the real 180s TTL. `userByHandle` after `profile-set` broke sample-50 until I fell back to `{actor}@example.com`.

**Vs other backends.** Live accent/background sync is the Convex win. File upload + `getUrl` is three calls and no CDN config. Queries do not tick, so expiry is visible only on the next read — I filter `expired` on the client and wait the real TTL rather than inventing a clock subscription.

## M6 — Replay adapter, offline queue, scale

**What I built.** A headless ConvexHttpClient adapter covering every action-log verb, sample-50 on the dev instance, an offline composer queue with pending receipts, and a **fresh** anonymous Convex on 55503/55504 for `scale.log`.

**Easy.** Once actor ids mapped to current handles (and `{actor}@example.com` as a fallback), sample-50 was one HTTP loop. Web offline flush choreography passed on the first try after the navigator.onLine poll.

**Fought me.** Anonymous agent mode wants one deployment name (`anonymous-agent`). A second instance needed its own project directory and generated admin key — copying the first instance’s key 401’d. Scale is ~167k settled mutations including bcrypt signups and media uploads; it is a wall-clock job, not a schema job.

**Vs other backends.** Convex local is “a binary + a sqlite file,” which made a fresh instance cheap compared to provisioning a second hosted project. There is no bulk import: the brief forbids it, and the HTTP mutation path is the whole load test. Compared with a SQL backend I would have indexed in one migration, here every follow/post/message is a round trip with occupancy of the single-threaded mutation queue.

## M8 — Insights, digest, multi-device

**What I built.** Server-computed lifetime totals and a 7-day UTC breakdown, trending top-10 by likes in 24h, a 2-minute digest cron writing `pushLogs`, and two-browser same-account live messages, unread-clear, and dual-offline convergence.

**Easy.** Convex subscriptions made Alice-device-2 see Alice-device-1’s send without a refresh. Digest is an `interval` cron plus `isReplayMode` so scale does not emit 100k notifications.

**Fought me.** RN-web Image avatars did not expose `aria-valuetext`/`data-value` for the author’s handle, so Bob could not target an Alice post to like. Native `data-value` on Avatar unblocked it. Apple simulators are unavailable; I recorded `pass: null` rather than treating a Hermes `.hbc` as native proof.

**Vs other backends.** Scheduled work is a first-class Convex cron, closer to a worker than to “check on read.” Multi-device is just two clients on one token — no extra presence fabric. Insights counters I maintained on write (`dailyStats`, `likesReceived`) because paging 50k posts in the query would violate the degradation rule; that is the same shape I would use on any backend, Convex just made the write-time bump a mutation.
