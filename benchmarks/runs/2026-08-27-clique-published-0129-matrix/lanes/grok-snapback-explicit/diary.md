# Clique lane diary — grok-snapback-explicit

## M1 — Accounts and profiles (green)

Built password sessions on Snapback's built-in auth, a public `users` profile table with unique handles, avatar upload via a generated intent + command, Expo Router screens using the frozen UI kit, starter-m1 replay through signup/profile-set, a Playwright suite, and two-client choreography.

Easy: scaffolding `expo-chat` already had sessions, live queries, and asset upload; unique handle indexes and `ctx.refuse('HANDLE_TAKEN')` mapped cleanly onto visible errors.

Fought: supervised Expo web wants stdin detached or the owner dies on pipe EOF; Metro's inner port escaped 4287–4387 until `--port-range 48100-48119`; `babel.config.js` under `"type": "module"` broke the transformer; choreography setup-identity is picky (relative in-tree paths, `process.execPath`, no `../` escape); instrument choreography dir is read-only so the harness had to be copied; `useSnapbackAssetImage` stays empty without `maxWidth`.

Explicit profile saved: generated `api.me` / `userByHandle` / `upsertProfile` references and the saveProfile command. Cost: inline-handler free-identifier rules (`HANDLE_RE` as a const is refused), write-policy advisories, and identity/receipt ceremony around choreography.

Missing docs: the start packet never says `snapback dev` over a pipe EOF stops the owner; setup-identity relative-path rules aren't in the start packet; asset image hook needs `maxWidth` called out next to the first Image example more loudly (it is in the assets page).

## M2 — Posts and follow graph (green)

Added posts/follows/likes/reposts as an additive successor in the running lifecycle (schema 86c478a7 → de47bcf1). Seeded starter-m2 through the write path. Following/Global composition is client-side over live tables. Composer file input is a DOM file input because RN-web Image cannot preview MP4 bytes (choreography still asks the attachment thumbnail to load as an img).

Easy: unique indexes + set/clear mutations with mutationId idempotency. Live feed updates for text posts fell out of `allPosts`.

Fought: Expo Router hid feed tabs on profile until they lived in chrome; compose attachments needed a real HTML file input plus a data-URI poster for video previews; RN-web accessibilityValue needed an observability bridge for aria-valuetext.

Explicit profile: generated live queries for four new tables were enough to compose feeds without a custom join IR. Cost: no multi-asset command (defineCommand is one asset), so uploads are a separate intent + mutate.

Missing: a documented “HTML file input on web for Expo” recipe; video poster vs player contract in the kit vs choreography waitForLoadedMedia(image).

## M3 — Messaging core (green)

Built conversations/memberships/messages plus typing ephemeral, quoted replies, and receipt rows. starter-m3 replayed through the write path. Suite m3-a03–a15 passed. Two-client choreography went green after scoped `messagesByConversation` (limit 80), optimistic `flushSync` pending sends, and a layout-level network-recovery reload so Bob could `markDelivered` after Playwright `setOffline`.

Easy: `ensureDm` pairKey uniqueness; `createGroup` clientKey idempotency; typing via `useSnapbackActivityPresence` (v2 boundary passed on the first green choreography sitting).

Fought: an unscoped `allMessages` live query went silent on the 179-row Alice–Bob thread; positional `visibleMessages` crashed when membership was still loading; Playwright `setOffline` immediately after `goto('/')` left Bob on the boot/auth gate so ReceiptSync never mounted; sequential `await markDelivered` hung in-flight across the offline window.

Explicit profile saved generated `api.sendMessage` / `api.markDelivered` / `api.messagesByConversation` references. Cost: inline handlers only; `recipientIds` as a CSV string; HostPlan `limit` is documented in package types, not the start packet.

Missing: a recipe for “Playwright `setOffline` + Snapback web client reconnect” that does not require a full document reload.

## M4 — Media, reactions, edit/delete (green)

Photo/video message uploads, one-reaction-per-user set/clear, 15-minute edit window, 60-minute delete tombstone. Suite and two-client choreography both green.

Easy: same asset-upload + mutate path as posts; live reaction chips.

Fought: action buttons had to wrap the kit bubble because `sm-convo-quote` must be a descendant of `sm-convo-bubble`.

Explicit profile: one asset per command still, so media send is upload then mutate.

## M5 — Ephemeral, config, search (suite green, choreography not green)

View-once opens, disappearing TTL from shortened windows, chat color/background, client-side NFC word-prefix search. Suite passed. Required choreography failed on Carol’s background preview (kit Image host is a div without `src`; a debug sitting *did* upload and live-sync the chat-variant URL) and warm-offline search for “Coffee after work?”. Optional disappearing purge also failed after relaunch.

Easy: kit ChatSettingsForm + settled `updateChat`.

Fought: Playwright `setFileThroughControl` vs a Pressable; RN-web Image `observableState`; retainable `allMessages` still empty on the search surface after `goto('/search')` + `setOffline`.

## M6 — Offline, push seam, custom-client API (suite green, choreography not green)

Push rows on send, `API.md` + `custom-client-demo.mjs`, sample-50 adapter replay (50/50 after mapping actor IDs to profile handles). Native iOS/Hermes environment-null. Web offline-queue choreography failed (send control while offline).

Easy: sample-50 once follow targets used mapping.users[actor].handle.

Fought: headless `liveQuery` wants a connectionId; `{queue:true}` vs settled mutations.

## M8 — Insights, digest, multi-device (suite green, choreography not green)

Insights totals and 7-day bars from live tables; trending tab; digestCron declared. Suite passed. Choreography failed insights-like-refresh (no unliked Alice post) and chats-list `dm:bob` identity plus dual-offline.

Native M8 queue-across-restart environment-null.

Easy: InsightsSummary/InsightsBarList composition.

Fought: client-derived totals vs “server-computed” brief; defineJsQuery elevatedReads refused on inline handlers.

## Native environment

iOS Simulator / Xcode / Hermes export is environment-null on this web-only host, recorded as such, not as failed product proof.
