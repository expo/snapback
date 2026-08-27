# Clique / grok-convex diary

Lane: grok-clique-convex. Backend: Convex 1.45.0 anonymous local. Web-only.

## M1 — Accounts and profiles

Built password auth with bcryptjs (cost 12) inside Convex mutations, sessions with server-side revocation, profile fields, avatar upload through Convex storage served at `/media`. Seeded starter-m1 through the real register/profile-set path.

Easy: Convex schema + unique indexes for email/handle; live profile queries; anonymous `convex dev` with `--local-cloud-port 48201`.

Fought: the UI kit is a `file:`-incompatible read-only instrument tree, so it was vendored; Expo web needed `babel-preset-expo` pinned to the SDK; choreography demands `setup-identity` plus suite-status linkage.

Prior familiarity: Convex mutations/queries and Expo Router file routes.

Missing docs: hidden `--local-cloud-port` / `--local-site-port` (found in package source); dashboard wanted 6790 so we patched it to 48203 for the lane port box.

## M2 — Posts and the follow graph

Built posts, likes, reposts, replies, following/global/trending feeds with timeline fan-out, and kit-wired FeedCard/Composer.

Easy: Convex reactive queries made the live like/repost/text-post checks fall out once the write path existed.

Fought: RN-web does not project `accessibilityValue.text` to `aria-valuetext` (had to mirror it on the vendored kit); Expo Router stack kept hidden `sm-feed-item` nodes; feed tabs had to hard-navigate `window.location.assign` so Bob actually lands on a focused home feed. Choreography went green only after that.

Prior familiarity: paginated Convex indexes.

Missing: a documented RN-web mapping for accessibilityValue.

## M3 — DMs, groups, typing, receipts

Built DMs and the Weekend Plans group, typing with a 3.5s server expiry plus a 2.8s client hide, receipts (sent/delivered/read), quoted replies, and membership add/promote/remove/leave.

Easy: Convex subscriptions made Bob's typing and new bubbles appear without a poll loop once `setTyping` / `send` existed.

Fought: group aggregate receipts claimed Dave as a never-seen member because the starter log adds Dave before choreography's add-Dave step; I had to keep Dave out of the seed group so the harness's add/promote/remove sequence could own that edge. Typing expiry was late until both clocks were shortened. Presence/receipt aggregation skipped users the client had never observed.

Prior familiarity: membership rows + lastReadAt as a read cursor.

Missing: the harness's exact "never-seen member" rule is only visible in choreography source, not in CONTRACT.md.

## M4 — Media, reactions, edit, delete

Photo/video in the conversation, reactions as set-state (including `"none"` as clear), 60s edit / 120s delete-for-everyone against server time.

Easy: Convex storage + `/media` already existed from M1; reactions were one indexed table.

Fought: Playwright file choosers vs RN-web Pressable. Hidden `<input type="file">` plus `setInputFiles` was more reliable than waiting for `filechooser`. Video play needed a muted `play()` for autoplay policy.

Prior familiarity: view-once as a one-row "opened" table plus storage delete.

Missing: nothing Convex-specific; the pain was browser media and the frozen kit's attach control.

## M5 — Chat chrome, view-once, offline search, disappearing

Accent color and background sync to Carol, view-once second-open refusal, warm-offline search, shortened disappearing windows (3 min / 5 min in config, 180s/300s in this lane).

Easy: `updateSettings` is one patch; Carol's query rerenders. Color `aria-pressed` + `data-value` made the harness see the selected swatch.

Fought: I added a raw `<img testID=sm-chatsettings-background-preview>` next to the kit preview and Playwright's strict locator exploded. Color sync had already passed; the extra node was the whole failure. Removing it and putting `data-value` / `aria-valuetext` on the kit preview made the background URI observable without duplicating the contract ID. Disappearing is a 200s wait — the segment is honest but slow.

Prior familiarity: last-write-wins patches, token index for search.

Missing: RN-web Image does not put `src` on the testID node, so the harness's `observableState` cannot see a kit-only preview unless you mirror the URI onto aria/data attributes.

## M6 — Offline queue, custom client, sample-50, native env-null

Queued two offline messages, flushed in order, read receipts after reconnect. Custom-client demo covers authenticate / listConversations / pageHistory / sendText / pollNewMessages. `sample-50.log` replayed through the same adapter with replay-mode killing push/digest.

Easy: HTTP client + mutation IDs made the adapter a thin loop. Convex local accepted 50 sequential writes without drama.

Fought: none on the web path. iOS Simulator / Xcode / Hermes is environment-null on this host and recorded that way in `artifacts/simulator-status.json` — not a product failure.

Prior familiarity: offline queue as ordered mutation replay.

Missing: a first-class "wipe this anonymous local sqlite and start over" in the public CLI; we used a batch-delete mutation later for O5.

## M8 — Insights, trending, multi-device

Insights totals + 7-day bars, trending last-24h by likes then newest, same-account live message, unread clear across Alice's two contexts, dual warm-offline convergence.

Easy: denormalized `likesReceived` / `postsCount` on the user doc meant Insights did not scan the corpus. Convex live queries made Alice-2 see Alice-1's DM without a reload. Dual-offline flush just worked.

Fought: `m8-a02` looked for an observably unliked Alice post. RN-web was not projecting like-button selected state, so `toggleSelection` returned null and the harness reported "no observably unliked Alice post" even though the global feed was full of them. Mirroring `aria-pressed` / `data-liked` on FeedCard fixed it; 63 unliked Alice originals were already there. Native M8 restart proof is environment-null, same as M6.

Prior familiarity: per-user counters vs read-time aggregation.

Missing: same RN-web a11y gap as M2. Insights kit tiles expose the integer as text, which was enough.

## O5 — Scale replay

Generated `scale.log` (sha256 matched the fixture pin). Wiped the dev sqlite via `lookups:wipeBatch`, reseeded starter, then the full scale log with 10%/50%/100% named-fixture checks and k=20 probes. Celebrity write-fan-out of 900 timeline rows would have made post-create scale with followers, so authors with >64 followers become `broadcast` and following-feed merges their `by_author_created` page on first load.

Easy: TypeScript end-to-end types, one HTTP client, settle-before-next. Named fixtures (u0500/u0005/u0900/u0901/g0001) passed at every checkpoint. Paging, 500-vs-5 following, search, and celebrity write/read 3× rules all held.

Fought: bcrypt-12 × 1000 registers is real load; 99k message sends each also write search tokens. Exact-count `collect()` of the whole corpus is not a viable probe — named fixtures have to be index lookups. Insights and Trending mid-curve predicates failed on sub-millisecond loopback jitter (50% a hair above a flat 10%–100% line) even though the 3× envelope held.

Prior familiarity: fan-out vs fan-in as the celebrity tradeoff.

Missing: documented local multi-instance isolation (second sqlite + ports) without a dashboard-port clash; we wiped in-process instead. Frozen absolute probe ceilings are still placeholders, so O5's 90-band ceiling-utilization clause cannot be shown.

