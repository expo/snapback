# Final report: Clique on Snapback 4 (lane `muse-clique-snapback4-full-20260913`)

## Raw epochs and wall clock

- `start=1789404464` (lane open, 2026-09-13).
- Lane work spans 2026-09-13 → 2026-09-14 (final sweep `receipts-all5.jsonl`
  closes 1789423684; this report ends below with `end=<epoch>`).
- Wall by milestone (first-green epochs from `run-log.md`; durations are
  start-to-first-green per milestone window, solo timed work):
  - M1: start 1789405023 → green 1789406697 (~28 min)
  - M2: → green 1789408036 (~22 min)
  - M3: → golden 1789412920 (~81 min, incl. typing-v2 boundary + receipt work)
  - M4: → green 1789417327 (~73 min, live-tail follow + threadSig updates)
  - M5: → green 1789417749 (~7 min)
  - M6: → green 1789418171 (~7 min, incl. custom-client demo + API.md)
  - M8: → green 1789423381 (receipt-derived from `receipts-m8.jsonl`
    `recordedAt` 2026-09-14T20:43:01Z; no run-log line was written that night)
  - M7: excluded by the brief (not-run, never started).
- Post-compaction session (2026-09-14 ~1789422xxx–1789423xxx): M5/M3
  red-diagnosis, write-through fix, fresh-store canonical sweep, bundles,
  essay, this report. No milestone exceeded its four-hour cap.

## Milestone status

| Milestone | Status | Suite | Choreography (final sweep) |
|---|---|---|---|
| M1 | green | 8/8 pass (`m1-mu1sjb00`) | 3/3 green |
| M2 | green | 11/11 pass (`m2-mu1sjbuh`) | 9/9 green |
| M3 | green | 11/11 pass (`m3-mu1sjc4p`) | 6/6 green + 1 neutral skip (avatar unrendered) |
| M4 | green | 5/5 pass (`m4-mu1sjinw`) | 5/5 green |
| M5 | green | 6/6 pass (`m5-mu1sjith`) | 4/4 green (see gap 1) |
| M6 | green | 5/5 pass (`m6-mu1sjiza`) | 1/1 green |
| M7 | not-run | — (brief excludes M7) | — |
| M8 | green | 6/6 pass (`m8-mu1sjkas`) | 5/5 green |

Final sweep artifacts: suites `acceptance/{m1-mu1sjb00,…,m8-mu1sjkas}
/receipt.json` (all `pass=true`, `uncovered=[]`), choreography
`receipts-all5.jsonl` (+ `.observations.jsonl`), linkage `suite-status.json`.

## First-green times

M1 1789406697, M2 1789408036, M3 1789412920, M4 1789417327, M5 1789417749,
M6 1789418171, M8 ~1789423381 (receipt-derived). All green again in the final
canonical sweep at 1789423684 after the fixes below (no regressions).

## Correction loops and attribution

1. **M5 warm-offline-search red (required).** Root cause: stale dev store —
   the Alice↔Bob DM had grown to 520 rows of my own choreo spam, pushing the
   seed's oldest row (`sm0001`, "Coffee after work?") outside every sync
   window the app subscribes, so the device honestly didn't hold it at offline
   time while the server did. Attribution: my test pollution, plus a real
   architectural lesson (local-first search requires engineering *what is
   synced*). Fix (operational): backend wipe + `seed --segment m3` to the
   canonical 6-row DM. Verified: standalone m5d search green, sweep green.
   (Same session: persistence switched memory → `indexedDbPersistence`, the
   vendor default, so reloads resume warm; full sweep shows no regressions.)
2. **M3 member-cutoff red (required).** Root cause: genuine app bug —
   fire-and-forget device mutation + instant navigation. Tapping remove-member
   admits locally, but the page dies before the outbox syncs/IDB-flushes, so
   the server never sees the removal and the removed member keeps receiving
   live messages. Attribution: app code. Fix (product): `settingsMutate` in
   `lib/helpers.tsx` — keepalive write-through direct apply when online with
   a session, device queue otherwise — wired for `memberRemove` and
   `setDisappearing` in `app/chat/[id]/settings.tsx`. Verified: m3g segment
   green, server-side membership deterministically correct (re-ran, not luck).
3. **M5 disappearing-expiry analysis (optional, required:false).** Verified
   three links independently: server `expire at` fires (TTL probe row purged
   from the store); the settings UI applies `setDisappearing` end to end
   (live repro, server flag confirmed); the write-through stamps `expiresAt`
   deterministically before send (row `…-m5-expiring` carries a real stamp).
   The letter of the probe (24h option purged within the lane's 45s adapter
   wait) is unsatisfiable under the frozen production grading windows
   (`config/windows.json` is read-only: 24h→86400s). Pass/fail therefore rests
   on the probe's zero-wait post-relaunch snapshot racing device sync —
   timing-sensitive, outside app control. It passed in the final sweep; see
   gap 1. No config was touched (frozen file respected; a live TTL override
   used mid-diagnosis was reverted the same hour).

## Native artifacts produced

- `dist-web/` — clean production export (Expo web), debug instrumentation
  verified absent (`client-timing` string count 0).
- `dist-ios/` — fresh iOS export (Hermes bundle, contains the write-through
  fix), debug verified absent. No `ios/` prebuild dir exists in the lane, so
  no compiled `.app`/simulator install was produced.
- iOS-simulator M6/M8 legs: `not-recorded` in both segment summaries
  (`requiredForGreen:false` per `simulator.md`). The simulator proof demands a
  release Hermes build on a booted sim plus a bespoke record/restart driver
  that does not exist in this lane; web green stands without it by the
  contract's explicit re-scope. Tallied as not-run, not as failure.

## Scale replay clock and verification

M6 suite `m6-mu1sjiza` (`at` 2026-09-14T22:04:48Z, `pass:true`, 0 failures)
includes `m6-a13` "sample-50 action log replays green": the 50-action fixture
log replays through the app's own auth+mutation path (seed v2 request ids,
one action settled before the next) against the live backend. No separate
scale harness was run; store footprints stayed tiny (canonical seed + probe
traffic) and every milestone's wall stayed far under its four-hour cap.

## Resolved package pins

- `snapback4@0.2.10` (exact pin, per brief; verified in
  `node_modules/snapback4/package.json`), `snapback4-expo@0.2.3`.
- Ambient: `expo@57.0.22`, `react-native@0.86.3`, `react@19.2.3`.
- Ports: backend 49340, web 49341 (lane range 49340–49359 respected).
- Only owned PIDs were ever signalled (lane backend/worker/serve); no sibling
  lanes, checkouts, or prior implementations were inspected.

## Hand-authored line counts by file (`wc -l`)

- `app/chat/[id].tsx` 729, `app/chat/[id]/settings.tsx` 214,
  `app/search.tsx` 124, `app/feed.tsx` 123, `app/chats.tsx` 116,
  `app/profile/[handle].tsx` 90, `app/profile/edit.tsx` 84,
  `app/new-chat.tsx` 90, `app/media.tsx` 74, `app/thread/[id].tsx` 50,
  `app/insights.tsx` 46, `app/_layout.tsx` 45, `app/settings.tsx` 37,
  `app/conversation/[handle].tsx` 47,
  `app/conversation/group/[group].tsx` 23,
  `app/conversation/group/[group]/settings.tsx` 23,
  `app/components/FeedItem.tsx` 251, `app/components/PostComposer.tsx` 121,
  `app/compose.tsx` 13, `app/index.tsx` 11.
- `lib/client.tsx` 282, `lib/helpers.tsx` 213, `lib/tracker.tsx` 75,
  `lib/feedtab.tsx` 52.
- `ui-kit/src`: ChatSettingsForm 484, ProfileForm 409, FeedCard 354,
  MessageBubble 366, Composer 249, SearchBar 207, PollCompose 177,
  ChatListRow 156, AuthForm 157, PollDisplay 154, InsightsBarList 133,
  TypingIndicator 101, ReactionPicker 104, QuotedReply 74, FeedTabs 90,
  InsightsSummary 83, Avatar 84, TrendingRow 94, ReceiptTicks 70,
  tokens 76, linkify 36, webSemantics 13.
- `snapback/schema.q` 988, `snapback/worker.mjs` 75
  (`snapback/generated/api.ts` is vendor-generated, not counted).
- `scripts/acceptance.mjs` 807, `scripts/seed.mjs` 218,
  `scripts/smoke.mjs` 100, `scripts/custom-client-demo.mjs` 88,
  `scripts/serve.mjs` 51, `scripts/choreo-link.mjs` 47. `API.md` 95.
- Total hand-authored: ~9.6k lines. Diagnostic scratch scripts lived in
  `/tmp` only and were never committed to the lane.

## Candid gap list

1. **M5 `disappearing-message-expiry-and-purge` is timing-sensitive.**
   Green in the final sweep, red honestly once standalone (message correctly
   visible: 24h TTL). Substance verified independently (server purge, UI
   apply, deterministic stamp); the probe's letter needs shortened grading
   TTLs the lane cannot set. Any future red here should be read as this known
   constraint, not a product regression — unless the stamp regresses to null,
   which would be a real bug (check `expiresAt` on the expiring row).
2. **Simulator legs not run** (M6/M8 native cold-offline). Needs a release
   build + driver that doesn't exist in-lane; explicitly out of web green.
3. **M7 not run** (brief exclusion).
4. **Offline search depth is subscription-bound.** On a long-lived store,
   rows older than every subscribed window won't be on the device for offline
   search. The lane relies on canonical seeding; a production app would need
   an explicit offline-warmth sync (background full-history pull), which I
   deliberately did not bolt on for fear of destabilizing green segments.
5. **Debug branches remain in source** (`EXPO_PUBLIC_DEBUG_DELIVERY` /
   `__sbClient` / timing proxy) behind an unset flag — stripped from both
   shipped bundles, but a future export with the flag set would re-enable
   console chatter. Removing the branches outright is safer than the flag.
6. **Lane adapter choices are mine and load-bearing:** `disappearing.waitMs`
   45000 (vs instrument default 300000) trades probe time for no coverage
   change; route/selector mappings live in `adapter.json`.
7. Two `run-log.md` lines from the final session carry file-mtime-derived
   epochs (corrected same-day after I first wrote estimates); all other
   epochs are observed.

`end=1789423823`
