# Clique familiar-profile diary

## M1 — Accounts and profiles

**Built.** Sessions-mode Snapback app on `snapback-familiar-ts-v1`: `schema.ts` + top-level `profiles.ts`/`media.ts`, password `defineAuth` with `durable-required` custody, Expo Router shell, frozen UI kit, starter-m1 seed through signup+`setProfile`+asset upload, suite `npm run acceptance -- --milestone m1`, two-client choreography green.

**Easy.** Familiar constructors (`query`/`mutation`/`useQuery`/`useMutation`) mapped cleanly onto Clique's profile read/write. Unique handle index plus `ctx.refuse("HANDLE_TAKEN")` was the right shape. Lifecycle `snapback dev --expo --expo-platform web` issued `snapback.application-ready.v1` and activated additive function successors without dropping sessions.

**Fought.** Published 0.1.29 refuses `_generated/` (prompt said that spelling; codegen emits `generated/`). Asset fields require `ctx.assets.attach`, not a raw id. Optional asset fields still must serialize as `null` in document results. Metro/`type: module` rejected `babel.config.js` until `.cjs`. Profile edit raced empty form state against `getMine` and broke live choreography until the form waited for hydration.

**Familiar saved.** Convex-like `ctx.db.query().withIndex().take().collect()`, namespaced `api.profiles.*`, and React `useQuery`/`useMutation` meant no declarative IR plans for M1. Auth still needed Snapback's `defineAuth` program (password-v1 is not implicit).

**Still Snapback-specific.** Sessions bootstrap, asset attach admission, application-ready binding, supervised Expo rendezvous (no hand-authored `.env`), durable IndexedDB custody via fake-indexeddb in Node.

**Docs missing.** The familiar-profile page never showed a complete password `defineAuth` example; `entryMechanisms: []` until we copied the explicit program. Result-contract null vs optional for `v.optional(v.assetRef())` was learned from a runtime refusal, not the Guide.

## M2 — Posts and follow graph

**Built.** Additive schema successor (follows/posts/likes/reposts + feeds.page). Composer, FeedTabs, live like/repost/reply, follow graph. Suite 22 IDs plus frozen two-client choreography green.

**Easy.** Familiar `query`/`mutation` plus live `useQuery` made Global-feed delivery and like counts feel Convex-like. Additive function successors did not drop M1 sessions.

**Fought.** Expo Router `Stack` + `router.push("/")` on tab change left hidden `sm-feed-item` nodes that Playwright `.first()` treated as not visible. RN-web does not map `accessibilityValue.text` to `aria-valuetext`; the vendored kit needed a web semantic shim. Video compose preview used an MP4 blob in RN `Image`, so the hidden `<img>` never loaded.

**Familiar saved.** Feed assembly stayed in TypeScript handlers (`withIndex`/`take`/`collect`) instead of IR. `useMutation` settled likes/reposts without an outbox API.

**Still Snapback-specific.** Asset attach for post images/video, result-contract nulls, lifecycle-owned Metro reload, and the fact that Expo Router stacking is a client problem Snapback cannot see.

**Docs missing.** No first-party note that RN-web drops `accessibilityValue={{ text }}`; the Guide's React presence page was not needed until M3.

## M3 — Messaging core

**Built.** Additive chats/members/messages/receipts/typing tables, DM reuse, groups, quoted replies, live list, typing via durable rows + clearTyping, delivery ack, Expo conversation routes. Suite m3-a03..a15 green. Two-client choreography: live DM + typing green; receipts, group-aggregate read, and member-cutoff bubbles not green.

**Easy.** Familiar mutations/queries mapped onto WhatsApp-shaped verbs (`ensureDm`, `send`, `addMember`). Idempotent `messageKey`/`chatKey` was the right seed shape.

**Fought.** `v.union([v.null(), v.string()])` is opaque JSON and cannot be indexed; optional scalars plus `null` in returned documents are required. Expo conversation screens raced empty `chatKey` so `onSend` no-op'd. Receipt ticks did not advance to `delivered` after the other client came online — InboxAck/live invalidation never became trustworthy under Playwright offline. Group roster from starter-m3 includes Dave, which fights M3 choreography's "add Dave" / trio-receipt assumptions.

**Familiar saved.** Same `query`/`mutation`/`useQuery` loop as M2; no IR. Live message lists worked once `chatKey` was resolved inside `onSend`.

**Still Snapback-specific.** Result-contract `requiredField` on optional document columns, additive schema successors, and the lack of an obvious "mark delivered when this principal's live query fetches" primitive (we had to client-ack).

**Docs missing.** No familiar-profile example of optional indexed scalars vs `v.union(null, …)`. Ephemeral presence recipe exists, but membership-scoped `allow.members()` was too expensive to adopt in-budget; we used a durable typing table instead.

## M4 — Media, reactions, edit/delete

**Built.** Message image/video fields, reactions table, edit/delete mutations (shortened 60s/120s windows), conversation attach via `sm-convo-file`, long-press react/edit/delete, media viewer. Suite m4-a01..a09 green through the app write path.

**Easy.** Familiar `setReaction` as idempotent set-state (`none` clears) matched the brief. Edit/delete live choreography passed on the first harness run.

**Fought.** Photo/video two-client delivery did not green: `useSnapbackAssetUpload` in the conversation screen blocked send long enough that Bob never saw the caption, then video bytes never became observable in the kit `Image`/`sm-convo-media` path. Splitting text-then-media still left photo live-render red. Native iOS not in this lane.

**Familiar saved.** Same mutation/query loop as M3; no IR.

**Still Snapback-specific.** Asset attach + public-immutable delivery; sessions-mode img warning in the React package; Expo bootstrap exchange going 503 whenever `application-ready` vanished mid-generate.

**Docs missing.** No familiar-profile recipe for conversation media uploads that is distinct from feed compose.

## M5 — Ephemeral, chat config, search

**Built.** View-once open-once mutation, people/in-chat/global search, chat accent/disappearing/background `setAppearance`, client-side disappearing TTL (queries cannot use `ctx.runtime.now()`). Suite m5-a04..a11 green. Choreography: disappearing optional purge passed; required color-sync and warm-offline search failed.

**Easy.** Search people prefix filter and `messages.search` grouping by `chatKey` were ordinary TypeScript handlers.

**Fought.** Codegen refused `Date` and clock-dependent query visibility (`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`) on insights and message list. Carol never observed the selected accent live. Offline search over synced messages did not surface `Coffee after work?` plus `sm-search-offline` under Playwright `setOffline`.

**Familiar saved.** `query`/`mutation` still enough; no IR.

**Still Snapback-specific.** Query results cannot depend on `RuntimeNow`, so disappearing expiry cannot be a server query filter without a scheduled purge. Bootstrap remint after generate.

**Docs missing.** Clock-dependent visibility is a runtime refusal, not a familiar-profile example.

## M6 — Offline writes, push seam, custom client, sample-50

**Built.** `pushEvents` on send, `listPush`, `scripts/custom-client-demo.mjs`, `replay-adapter.mjs` over `replayLog`, sample-50 suite m6-a13. Suite green including custom-client and 50-action conformance. Web choreography: Playwright offline made `sm-convo-send` unclickable (provider/bootstrap). Native simulator environment-null.

**Easy.** Familiar headless client made the custom-client demo and sample-50 a thin script. Push preview `"Photo"` for view-once was one branch in `messages.send`.

**Fought.** Warm-offline compose depends on the Snapback web provider remaining mounted with the network cut; it did not. Application-ready file deleted during generate broke Expo boot until remint.

**Familiar saved.** Headless `mutate`/`query` against generated `api.*` was enough for m6-a10/a11/a13.

**Still Snapback-specific.** Supervised Expo bootstrap; push is a table we invented, not a provider seam.

**Docs missing.** No documented web-offline mutation queue for familiar React.

## M8 — Insights, digest, multi-device

**Built.** `insights.summary` (7 UTC-day buckets via integer day math, no `Date`) and `trending`, Insights kit screen, trending feed tab, unread counts on `listMine`. Suite m8-a01..a07 green. Choreography: same-account live message (m8-a13) passed; insights like-refresh, cross-device unread, dual-offline failed. Digest grader items not suite-required. Native durable-queue restart environment-null.

**Easy.** Lifetime totals from existing post/follow rows. Suite trending sort was a JS sort.

**Fought.** `Date` in summary failed codegen. Insights like-refresh found no unliked Alice post in Global for Bob (FeedTabs/live like state). `sm-chats-item` `dm:bob` not found when Alice was sent to `/` instead of `/chats`. Dual-offline same as M6.

**Familiar saved.** Aggregate reads stayed TypeScript.

**Still Snapback-specific.** No `Date` in handlers; integer epoch math only.

**Docs missing.** Trusted-runtime-values page exists; the familiar profile does not show a 7-day UTC bucket example.
