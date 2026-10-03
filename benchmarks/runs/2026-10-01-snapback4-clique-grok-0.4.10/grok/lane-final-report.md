# Clique / snapback4@0.4.10 — final report

lane id: grok-clique-snapback4-full-20260913
model: grok-4.6
effort: xhigh
backend: snapback4-0.4.10
pins: snapback4@0.4.10 snapback4-expo@0.4.10
host: macOS arm64 (Apple M5 Max), Node 24.18.0
ports: backend 49360, web 49361, scale-replay 49362 (range 49360–49379)

## Raw clock

start=1790830364
scale-replay start=1790838359
scale-replay end=1790839547
scale-replay wallSeconds=1188.567

First-green (passing choreography segment-summary `recordedAt`, unix):

| milestone | first-green epoch | seconds from lane start | seconds from previous green |
| --- | --- | --- | --- |
| M1 | 1790832098 | 1734 | 1734 |
| M2 | 1790836088 | 5724 | 3990 |
| M3 | 1790836427 | 6063 | 339 |
| M4 | 1790837197 | 6833 | 770 |
| M5 | 1790837750 | 7386 | 553 |
| M6 | 1790837766 | 7402 | 16 |
| M8 | 1790838252 | 7888 | 486 |

Wall by milestone is the delta to the previous first-green (M1 from `start`). Scale replay is a separate clock, not folded into M6’s 16s choreography green.

Tokens: null. This session has no harness-native per-turn meter exposed to the agent; protocol forbids reconstructing counts from prose.

## Milestone status

| milestone | status | suite | choreography | notes |
| --- | --- | --- | --- | --- |
| M1 | green | `acceptance ok m1` | receipts-m1.jsonl green | first session |
| M2 | green | `acceptance ok m2` | receipts-m2.jsonl green | follow own-keys + planned home |
| M3 | green | `acceptance ok m3` | receipts-m3.jsonl green | retain history after remove |
| M4 | green | `acceptance ok m4` | receipts-m4.jsonl green | await upload; video asset id |
| M5 | green | `acceptance ok m5` | receipts-m5.jsonl green | settings route; offline snippets |
| M6 | green | `acceptance ok m6` | receipts-m6.jsonl green | sample-50 in suite; full scale.log separate |
| M7 | not-run | — | — | ENVIRONMENT: separate later session |
| M8 | green | `acceptance ok m8` | receipts-m8.jsonl green | insights wait-for-data; freeze DM id |

No capability-failure, aborted, or blocked-by milestones. Two consecutive capability-failure stop condition was not hit.

## Correction loops (attribution)

| loop | attribution | evidence |
| --- | --- | --- |
| M1 logout/relogin missing feed tabs | agent-error | chrome FeedTabs always mounted; run-log / diary M1 |
| M2 follow-unfollow not live | agent-error | `follows` were `online only`; `setFollow predicts: never`; switched to own-key sync + planned `home` |
| M2 profile cards in Following projection | agent-error | `sm-profile-post` testID; hide chrome feed off `/` |
| M2 reply count / thread | agent-error | `/post/[id]` composer with `parentId` |
| M2 unrepost not leaving Alice’s global | agent-error | optimistic `setRepost`; `keep: false` on `globalFeed` |
| M3 quoted excerpt | agent-error | excerpt from in-memory history row |
| M3 dave candidate | agent-error | directory ∪ `profileByHandle("dave")`; kit `data-value` |
| M3 group read receipt | agent-error | client `receipt()` from `membersOf` + runs (query horizon is messages-only) |
| M3 live cutoff lost history | agent-error | hold `namedGroup` id + last history page |
| M3 DM progress marker | agent-error | deterministic `idFrom(clique:dm:sorted pair)` |
| M4 photo/video send without media | agent-error | await in-flight `client.upload` on send |
| M4 video poster used as playback src | agent-error | separate `useAsset(video.id)` |
| M4 ConversationView crash | agent-error | never `useQuery(..., principal: "none")` |
| M5 settings controls missing | agent-error | `/conversation/c/[id]/settings`; `[group]/index.tsx` |
| M5 warm offline search empty | agent-error / platform horizon | `inboxSnippets` + client word-prefix; `N_SYNC_ORDER` on `search` |
| M8 insights 0/0 | agent-error | do not render totals until `insights` has `data` |
| M8 dual-offline alice2 missing | agent-error | freeze OpenDirect conversation id so a late pair query cannot remount and drop the outbox |

Knowledge lookups: ENVIRONMENT.md and fixtures (source: fixture); snapback4 README/`guide feeds`/`guide receipts`/`why setFollow`/`why home` (source: published docs / package README/guide / diagnostic). No Snapback source repository was read.

## Suite and choreography per milestone

All implemented required choreography checks passed on the green run. Sender-avatar M3 skipped (instrument: kit default 1:1 layout). M5 disappearing and view-once implemented and passed. M8 simulator supplemental not-recorded (simulator proofs not required).

Coverage: `coverage/manifest.json`, `coverage/suite-status-m{1,2,3,4,5,6,8}.json`, receipts JSONL in-lane.

## Native artifacts

iOS Hermes export (`expo export --platform ios`) with `.hbc` bundles:

- `artifacts/ios-m1` (first session)
- `artifacts/ios-m2` … `artifacts/ios-m6`, `artifacts/ios-m8` (same current bundle copied after the M8 export; `.hbc` present under `_expo/static/js/ios/`)

Simulator proofs were not required and were not run.

## Scale replay

Fresh `snapback4 dev --port 49362 --fresh`. Starter m1–m3 seeded, then `fixtures/scale.log` through `scripts/scale-replay.mjs` (same auth/mutation adapter as the app).

- start=1790838359 end=1790839547 wallSeconds=1188.567
- actions settled 167157 / 167157
- failedActions 0
- actionLog sha256 `sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9` matches `invariant-manifest-combined.json` artifacts.scale.log.sha256
- checkpoints: 10% settledPrefix 24777, 50% settledPrefix 88057 — equal to manifest `scaleActionsApplied`
- verification: alice `followCounts.following = 2`, u0001 `followCounts.following = 5` (manifest `perUserFollowingCounts`); receipt `coverage/scale-replay-receipt.json` pass=true

## Resolved package pins

- snapback4@0.4.10 (platform binary optional dep; `npx snapback4` after install)
- snapback4-expo@0.4.10
- expo 57.0.22, react 19.2.3, react-native 0.86.3

## Hand-authored line counts (unique files, 62 files, 4539 lines)

Largest: `snapback/schema.q` 597; `scripts/acceptance.mjs` 548; `src/ConversationView.tsx` 453; `scripts/lib/actions.mjs` 271; `src/Conversation.tsx` 190 (social-template leftover); `src/FeedScreen.tsx` 174; `src/ProfileScreen.tsx` 160; `src/PostCard.tsx` 156; `src/ChatSettingsScreen.tsx` 139; `app/_layout.tsx` 122; `diary.md` 113; `src/ChatSidebar.tsx` 104; `scripts/scale-replay.mjs` 100. Remaining app/src/scripts/config/docs as listed by `wc` in the lane (kit and choreography are vendored instrument copies, not counted).

## Candid gap list

1. **Follow live projection** needs own-key `follows` and a planned `home`; materialized `view following` plus `online only` follows did not overlay unfollow on the device in 0.4.10 (`setFollow predicts: never`).
2. **`N_SYNC_ORDER`** on `search` / `people` / `home` / `globalFeed`: compiler says the client needs the server; warm offline search required a second device query over inbox history.
3. **`useQuery` throws** on an ill-typed principal; empty typing used `"none"` and crashed the conversation tree.
4. **Uploads are online-only**; Playwright send-immediately races `client.upload` unless the lane awaits the in-flight promise.
5. **Membership removal replaces history** even with `retain delivered-history`; the screen must hold the last page.
6. **`messageReceipts` horizon is messages-only**; live `seen` updates needed a client `receipt()` over `membersOf`.
7. **Insights tiles rendered 0 while loading**; choreography read the placeholder.
8. **OpenDirect remount** on a late pair query dropped the other device’s offline outbox until the conversation id was frozen.
9. **Expo Router** `[group].tsx` vs `[group]/settings.tsx` and UUID settings URLs were client routing, not Quarry.
10. No harness-native token meter in this session.

Platform gaps that were not fatal: `N_SPARSE_FILTER` on planned home; `insert if absent queues without a row` for follows/reposts; digest and trending compiled and ran.

M7 was not attempted.
end=1790839684
