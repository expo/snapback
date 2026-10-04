# Final report — grok-clique-snapback4-full-20260913

lane id: grok-clique-snapback4-full-20260913  
model: grok-4.6  
effort: xhigh  
backend: snapback4-0.4.12  
host: macOS arm64 Apple M5 Max  
node: 24.18.0  
ports used: 49360 (Expo web), 49361 (snapback dev), 49362 (scale replay, `--replay`)  
CHOREO_BASE_URL: http://127.0.0.1:49360  
CHOREO_LANE_RUN_ID: grok-clique-snapback4-full-20260913  
M7: not-run (separate session; not attempted)

## Raw clock

start=1791049176 (2026-10-03T17:39:36Z)

Methodology: `firstGreenAt` is the later of suite receipt `at` and choreography `segment-summary.recordedAt` (inclusive). Milestone wall is `firstGreenAt(this) − firstGreenAt(previous)` with M1 previous = start. Scale replay has its own clock and overlapped M8 choreography. Run-log M3 stamp 1791053800 is delayed relative to the M3 choreo receipt; this table uses the receipts.

| Milestone | startEpoch | suitePassAt | choreoPassAt | firstGreenAt | wallSeconds | status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| M1 | 1791049176 | 1791050500 | 1791050841 | 1791050848 | 1672 | green |
| M2 | 1791050848 | 1791050908 | 1791052601 | 1791052609 | 1761 | green |
| M3 | 1791052609 | 1791052626 | 1791052882 | 1791052882 | 273 | green |
| M4 | 1791052882 | 1791052891 | 1791053857 | 1791053857 | 975 | green |
| M5 | 1791053857 | 1791053864 | 1791054630 | 1791054630 | 773 | green |
| M6 | 1791054630 | 1791054725 | 1791054738 | 1791054738 | 108 | green |
| M7 | — | — | — | — | — | not-run |
| M8 | 1791054738 | 1791054762 | 1791055082 | 1791055082 | 344 | green |

M1 firstGreenAt uses the run-log stamp 1791050848 (7s after choreo 1791050841). M2 firstGreenAt uses run-log 1791052609 (8s after choreo). Four-hour per-milestone cap was not approached. Two-consecutive-capability-failure rule did not trigger.

Tokens: null. Protocol: Grok advisory lanes record honest nulls; token caps inapplicable. ENVIRONMENT.md: do not estimate tokens in prose. `tokens.source`: null.

## Scale replay clock and verification

- Isolated instance: `scale-run/` (copied `schema.q` + worker, port 49362, `--replay`, store `scale-run/.snapback4/store.sqlite`)
- Seed: starter-m1 + starter-m2 + starter-m3, then `fixtures/scale.log`
- actionLogSha256: sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9 (matches `fixtures/scale-log.sha256` and invariant manifest)
- startEpoch=1791054952 (2026-10-03T19:15:52Z)
- endEpoch=1791055215 (2026-10-03T19:20:15Z)
- wallSeconds=263
- actions settled=167157 (checkpoint markers excluded from the action count)
- checkpoints: 10% atAction=24777 ms=44668; 50% atAction=88057 ms=139762
- users in replay state=1008
- receipt: `receipts/scale-replay.json`
- verification: `receipts/scale-verify.json` via `npx snapback4 sql` on the scale store (read-only, not rule-filtered)
- result: **pass** — every `expectedState.perEntityCounts` value matched; named O5 fixtures matched

| entity | expected | actual |
| --- | ---: | ---: |
| users / profiles | 1008 | 1008 |
| followEdges | 5921 | 5921 |
| posts | 50228 | 50228 |
| topLevelPosts | 48224 | 48224 |
| replies | 2004 | 2004 |
| activeLikes | 5008 | 5008 |
| activeReposts | 1004 | 1004 |
| conversations | 1002 | 1002 |
| dms | 901 | 901 |
| groups | 101 | 101 |
| memberships | 2053 | 2053 |
| messages | 100015 | 100015 |
| textMessages | 99105 | 99105 |
| mediaMessages | 910 | 910 |
| quotedReplies | 2736 | 2736 |
| activeReactions | 2000 | 2000 |
| disappearingSettingsEnabled | 0 | 0 |

Named O5:

- u0500 followingCount=500, conversationMembershipCount=100
- u0005 followingCount=5
- u0900 followerCount=900, postCount=200 (top-level)
- u0901 followingCount=5, following=[u0001, u0002, u0003, u0004, u0900]
- g0001 memberCount=50, messageCount=10000, title="Busy Group 0001", members=u0001–u0049 + u0500

## Suite and choreography per milestone

| Milestone | suite | coverage manifest | choreo JSONL | choreo green | notes |
| --- | --- | --- | --- | --- | --- |
| M1 | pass `receipts/m1-suite-receipt.json` | `coverage-m1.json` | `receipts/choreo-m1.jsonl` | true | 3/3 required |
| M2 | pass `receipts/m2-suite-receipt.json` | `coverage-m2.json` | `receipts/choreo-m2.jsonl` | true | 9/9 required |
| M3 | pass `receipts/m3-suite-receipt.json` | `coverage-m3.json` | `receipts/choreo-m3.jsonl` | true | 5 required passed; 1 optional skipped (`sender-avatar-identity-when-rendered`, kit 1:1 layout) |
| M4 | pass `receipts/m4-suite-receipt.json` | `coverage-m4.json` | `receipts/choreo-m4.jsonl` | true | 5/5 required |
| M5 | pass `receipts/m5-suite-receipt.json` | `coverage-m5.json` | `receipts/choreo-m5.jsonl` | true | 2 required + 2 optional implemented passed; disappearing waitMs=200000 |
| M6 | pass `receipts/m6-suite-receipt.json` | `coverage-m6.json` | `receipts/choreo-m6.jsonl` | true | suite-required a08–a11, a13; simulator a01–a07 greenRequired=false, not recorded |
| M8 | pass `receipts/m8-suite-receipt.json` | `coverage-m8.json` | `receipts/choreo-m8.jsonl` | true | suite a01,a03–a07; choreo a02,a13–a16; simulator a17–a18 greenRequired=false; grader digest a08–a12 implemented in schema, not suite-required |

Instrument skips (not relabeled):

- `sender-avatar-identity-when-rendered` — choreography skipped; kit does not render sender avatars in default 1:1 layout
- `ios-simulator-m6` / `ios-simulator-m8` — supplemental external `not-recorded`; ENVIRONMENT.md: simulator proofs not required
- M7 entire — not-run

`suite-status.json` restored to include m1 after a later merge had dropped it.

## Native artifacts

Hermes iOS export (`expo export --platform ios`). Simulator launch not required.

| path | when | notes |
| --- | --- | --- |
| `dist/ios-hermes-m1/` | epoch ~1791050853 | M1 export |
| `dist/ios-hermes-m2/` | epoch ~1791052609 | M2 export |
| `dist/ios-hermes/` | epoch ~1791055092 | full-app export after M8 UI; `entry-25fafec6f75aa85e89402ee8c11d187c.hbc` |
| `dist/ios-hermes-m3/` … `m8/` | copies of the full-app export | same hbc |

## Resolved package pins

Recorded in `run-log.md` before `npm install`:

- snapback4@0.4.12
- snapback4-expo@0.4.12

`package.json` dependencies match exactly. Optional host binary: `snapback4-darwin-arm64` via the published package. Expo 57.0.22, react-native 0.86.3, UI kit `@snapback-bench/social-ui` file:./ui (0.3.3-m8), choreography 0.3.8-m8.

## Correction loops

A loop is a done-claim or tool-success followed by contrary evidence and a revision. Compile errors before a done-claim are excluded.

| # | milestone | attribution | subAttribution | summary | evidence |
| ---: | --- | --- | --- | --- | --- |
| 1 | M1 | agent-error | — | Expo group import depth `../../../` vs `../../../../` | metro Unable to resolve ResolveConversation |
| 2 | M1 | agent-error | — | logout left stack on `/settings`; re-login missed feed tabs | choreo-m1 wait for `sm-feed-tab-following` |
| 3 | M2 | agent-error | — | FlatList unmounted live post; Playwright `hasText` failed | choreo-m2 `reply-live-thread-projection`; fix ScrollView |
| 4 | M3 | agent-error | — | replay used a fresh actor map | share `createReplayState()` |
| 5 | M3 | agent-error | — | `sm-chatsettings-member-add` missing | `onPressAddMember={() => {}}` |
| 6 | M3 | agent-error | — | quote control outside `sm-convo-bubble` | choreo-m3 quoted-reply |
| 7 | M4 | agent-error | — | video send raced `client.upload` | wait on `uploadedRef` |
| 8 | M4 | agent-error | — | RN `createElement("video")` is not HTMLVideoElement | `WebVideo` wrapper |
| 9 | M4 | agent-error | — | same-emoji reaction did not remove | `setReaction` toggle |
| 10 | M4 | agent-error | — | history last 20 hid caption | history last 100 + explicit `Text` |
| 11 | M5 | agent-error | — | no DM settings route | `app/conversation/[handle]/settings.tsx` |
| 12 | M5 | agent-error | — | view-once viewer missing img/close | `sm-media-viewer-image` / `close` |
| 13 | M5 | agent-error | — | search defaulted to people; no `sm-search-offline` | SearchScreen |
| 14 | M5 | agent-error | — | disappearing wait shorter than ttl | `choreo-adapter.json` waitMs 200000 |
| 15 | M6 | agent-error | — | Bob still `connected[]` via Expo; no `emit notify` | used Frank |
| 16 | M6 | snapback-defect | knowledge-gap | worker private copy; `import.meta.url` missed lane `data/` | `.snapback4/worker-*/scope/scope/…/notifications.mjs`; cwd workaround |
| 17 | M6 | environment | — | scale-run `node_modules` symlink broke worker copy | `Too many levels of symbolic links`; `--replay` so OK |
| 18 | M8 | agent-error | — | chat identity `dm:unknown` until profile | wait for handle |
| 19 | M8 | agent-error | — | `return null` before `useAsset` | hooks order |
| 20 | M8 | agent-error | — | `/` had no `sm-chats-item` | embed `<Chats />` on Feed |

Counts: agent-error 18, snapback-defect 1 (knowledge-gap), environment 1, ambiguous 0.

## Hand-authored line counts by file

Product, scripts, and config only (unique files). Excludes `node_modules`, `instrument/`, copied `ui/`, `choreography/`, `fixtures/`, `metering/`, `dist/`, `snapback/generated/`. Counts are physical lines after the last product edit, before this report's own files.

| lines | file |
| ---: | --- |
| 502 | snapback/schema.q |
| 403 | scripts/acceptance.mjs |
| 336 | src/Conversation.tsx |
| 292 | scripts/replay-engine.mjs |
| 111 | src/Feed.tsx |
| 91 | src/ChatSettingsScreen.tsx |
| 85 | src/intents.ts |
| 82 | src/PostCard.tsx |
| 81 | src/BoundedConversation.tsx |
| 78 | app/_layout.tsx |
| 76 | src/ProfileScreen.tsx |
| 72 | src/ProfileEdit.tsx |
| 60 | src/Direct.tsx |
| 53 | src/useTyping.ts |
| 53 | scripts/scale-replay.mjs |
| 53 | scripts/ops.mjs |
| 51 | scripts/custom-client-demo.mjs |
| 50 | src/media.tsx |
| 49 | setup-identity.json |
| 46 | package.json |
| 46 | API.md |
| 44 | src/SearchScreen.tsx |
| 43 | src/ResolveConversation.tsx |
| 41 | src/Chats.tsx |
| 41 | scripts/setup-identity.mjs |
| 39 | src/useOnceMedia.ts |
| 39 | src/PageLifetime.ts |
| 38 | src/InsightsScreen.tsx |
| 37 | scripts/seed.mjs |
| 36 | src/Profile.tsx |
| 35 | src/Search.tsx |
| 35 | app/post/[id].tsx |
| 33 | snapback/workers/notifications.mjs |
| 30 | coverage-m2.json |
| 29 | choreo-adapter.json |
| 28 | src/useOnlineArm.ts |
| 26 | src/ui.tsx |
| 24 | src/client.ts |
| 24 | config/windows.json |
| 24 | config/windows.production.json |
| 24 | app.json |
| 23 | scripts/replay.mjs |
| 22 | tsconfig.json |
| 21 | app/search-chat/[id].tsx |
| 18 | src/feed-tab.ts |
| 17 | src/PersistentFeedTabs.tsx |
| 16 | app/conversation/group/[group]/index.tsx |
| 16 | app/conversation/[handle].tsx |
| 15 | coverage-m3.json |
| 15 | coverage-m1.json |
| 14 | coverage-m8.json |
| 14 | coverage-m5.json |
| 14 | app/settings.tsx |
| 14 | app/conversation/group/[group]/settings.tsx |
| 14 | app/conversation/[handle]/settings.tsx |
| 13 | coverage-m6.json |
| 13 | coverage-m4.json |
| 13 | app/(tabs)/profile.tsx |
| 12 | src/native-smoke.ts |
| 12 | app/(tabs)/_layout.tsx |
| 10 | metro.config.js |
| 10 | metro-wasm-transformer.cjs |
| 8 | src/intent-store.native.ts |
| 8 | config/digest.production.json |
| 8 | config/digest.json |
| 7 | src/intent-store.web.ts |
| 7 | app/profile/[handle].tsx |
| 7 | app/dm/[other].tsx |
| 4 | babel.config.js |
| 2 | src/intent-store.ts |
| 1 | app/profile/edit.tsx |
| 1 | app/insights.tsx |
| 1 | app/(tabs)/search.tsx |
| 1 | app/(tabs)/index.tsx |
| 1 | app/(tabs)/chats.tsx |
| **3712** | **product/scripts/config total (75 files)** |

Narrative files written after verification (not in the 3712): `run-log.md`, `diary.md`, `essay.md`, `final-report.md`, `receipts/scale-verify.json`.

## Candid gap list

1. Worker isolation undocumented: supervised workers run from a nested private copy; relative paths from `import.meta.url` miss the project tree. Diagnostic pointer: process args `.snapback4/worker-*/scope/scope/scope/…/notifications.mjs`. Workaround: `process.cwd()` or `CLIQUE_PUSH_LOG`.
2. Search index pairing: in-chat search cannot combine `matching` with `byConversationOrdinal`. Split query used.
3. `npx snapback4 sql` refuses SQLite catalog (`E_SQL_INTERNAL`); application tables work.
4. `connected[p]` suppresses push while any session for that principal is live, including the builder's Expo tab. Correct product, surprising for M6-a08.
5. Scale-run `node_modules` as a symlink breaks worker materialization (`Too many levels of symbolic links`). Copy or `--replay`.
6. Replica `sync … last 500` is not the server history. Busy-chat 10k messages live in the store; a replica will not hold all of them. Verification used `sql`.
7. RN Web video: kit/testIDs need a DOM `<video>`, not `React.createElement("video")`.
8. Frozen choreography observes `/` for `sm-chats-item` in M8; product chats live on `/chats`. Feed embeds the chat list as a harness seam.
9. Digest assertions m8-a08–a12 are grader-executed. Job `digest` + `schedule … every 2m` + `emit once` is implemented; push-log contained `kind: digest` rows. Suite did not assert per-user counts via `clock advance`.
10. Simulator native proofs (M6-a01–a07, M8-a17–a18) not recorded; ENVIRONMENT.md does not require them. Hermes bundles exist.
11. `suite-status.json` lost `m1` during a later write; restored in wrap-up.
12. No M7 (polls / day-2 evolution), as instructed.

## PIDs recorded (killed at wrap-up, exact PIDs only)

Snapback 49361: 85223 (shell), 85228, 85229, 85265, 85266 (listen), 12306 (worker-watchdog), 12307 (worker node)  
Expo 49360: 74843 (shell), 74848, 74852, 74879 (listen)  
Scale 49362: 11509 (shell), 11518, 11519, 11550, 11551 (listen)

Earlier snapback-dev 72951/72959/72988 was replaced by 85223 after schema restarts.

Kill: SIGTERM on the exact PIDs above at 1791055756; none remained; ports 49360–49362 not listening.

end=1791055758
