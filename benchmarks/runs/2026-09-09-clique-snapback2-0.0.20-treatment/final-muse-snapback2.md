# Final report — lane muse-clique-snapback2 (Clique on Snapback 2)

## Cap-enforced continuation disclosure

The original continuous builder (Muse Spark 1.3, effort xhigh) was stopped by
the orchestrator at the preregistered M5 four-hour wall, measured from M4
green at epoch 1788978535 to epoch 1788992935 (2026-09-09 15:28:55 PDT). This
report, `essay.md`, and the closing entries of `diary.md`/`run-log.md` were
written by a fresh same-family continuation session starting 1788993052. The
continuation preserved the app, owner database, suite/choreography receipts,
failed-attempt forensics, diary, and run-log; made no source change, attempted
no M5 repair, started no server, and claims no post-mutation M5 choreography
receipt as frozen-harness green. The lane-local `choreography/choreography.mjs`
differs from the untouched root instrument (settlePage/rewarmSettings harness
helpers added mid-M5, file mtime 1788986409, +351 diff lines): M1–M4 retain
their previously recorded frozen-harness standing; M5 is recorded
`capability-failure`. Consecutive-failure count stands at one (M5); M6/M8 are
blocks, which do not count. M7 was not run (separate fresh session per brief).

## Raw epochs and wall by milestone

- Lane start: 1788960929. Lane end: 1788993273 (owner PID 59621 stopped with plain kill at close; port 50700 confirmed closed).
- M1: start 1788960929 → first-green 1788969190. Wall 8261s (~2.3h).
- M2: phase after M1 green; suite receipt startEpoch 1788969605; custom smoke
  green @ 1788966595 (diary). No separate frozen-green epoch timestamped in
  run-log (gap noted below). Bounded wall ≈ 1788969190 → 1788971099 ≈ 1909s.
- M3: suite receipt startEpoch 1788971099; green bounded before M4 suite green
  1788973184 (no separate green epoch timestamped; gap noted). Bounded wall ≈
  2085s.
- M4: suite green 1788973184 → first-green 1788978535 (frozen choreo m4
  recorded 18:28:11 UTC, run-log line +44s). Phase wall 5351s (~1.5h);
  cumulative start→M4-green 27606s (~7.7h).
- M5: start 1788978535 → cap 1788992935. Wall 14400s (full 4h cap, exhausted).
  Status `capability-failure`. No first-green.
- M6: `blocked-by-M5`, no wall, no attempt (continuation determination
  1788993179).
- M8: `blocked-by-M5` (via M6; transitive failed set {M5}), no wall, no
  attempt.
- M7: `not-run` (out of scope for this session by brief).
- Scale replay: `not-run` (gated on M6 green); no replay start/end epochs.

## Milestone statuses

| Milestone | Status | Basis |
|---|---|---|
| M1 | green | suite 6/6 + frozen choreo m1 green (runId 37b46af3, 3/3 assertions) |
| M2 | green | suite 9/9; previously recorded frozen-harness standing retained per continuation order (in-lane receipt gap noted below) |
| M3 | green | suite 5/5; standing retained likewise (no preserved segment receipt; gap noted) |
| M4 | green | suite 4/4 + frozen choreo m4 green 5/5 (runId 27e102f8) |
| M5 | capability-failure | 4h wall exhausted; suite 5/5 but frozen segment green:false 1/4 (runId 96584b9b) |
| M6 | blocked-by-M5 | DAG: M6 requires M2,M3,M4,M5; failed set {M5} |
| M8 | blocked-by-M5 | DAG: M8 requires M6; transitive failed set {M5} |
| M7 | not-run | separate fresh session; never attempted here |

## First-green times

M1 1788969190; M2 suite-evidenced ~1788969605 (smoke 1788966595); M3 bounded
(1788971099, 1788973184]; M4 1788978535; M5/M6/M8 none.

## Correction loops and attribution

snapback2-defect — (1) signup returns no replay grant, login does; fix:
auto-login after signup, ensureWritable on onboard/composer/send (diary M1).
(2) tokenless `/api/asset/<id>` 404s E_ASSET_NOT_READY for plain media tags;
fix: useWebBlobUrl blob choke point + retry (diary M4 media). (3) serial
drain + ~15s live-push clustering + cold coverage sync stalls; fixes: chained
marks, conversation-wide queries, WarmSyncBeat 618ms observer sync (diary
latency/M4). agent-error — (4) double-Pressable ChatListRow killing list nav
(diary M2). (5) action buttons outside bubble scope (diary M4).
(6) setReaction updating immutable `at` (diary M4). (7) notify effect real
fetch to https://api.example.com black-holing drains (diary latency).
(8) concurrent markFetched/markRead → E_OFFLINE_CONFLICT (diary latency).
(9) per-message subscriptions melting 40-msg threads (diary M4). (10) choreo
launched without CHOREO_ADAPTER → ENOENT (diary attempt-8). (11) op-aware
paging gate re-introducing diary-refuted starvation, reverted (diary
attempt-11). (12) setWindows probe scare from extra `name` arg (diary M4).
environment — (13) RNW version drops accessibilityValue/selected mappings;
rewrote 20 uses to aria-valuetext/aria-pressed (diary M2/M3 + attempt-4).
(14) box load 9–13 with neighbor lanes across M5 attempts 4–13 (diary M5).
ambiguous — (15) disappearing mode-vs-send owner-application race (diary
attempt-6). (16) post-delete Bearer-URL residual resolvability (diary M4).
Full evidence pointers are the diary sections named above.

## Suite results per milestone

- M1 acceptance/m1/receipt.json: pass, 6/6, required
  m1-a01,a02,a03,a04,a08,a10,a11, startEpoch 1788969000.
- M2 acceptance/m2/receipt.json: pass, 9/9, 22 required ids incl.
  a01–a03,a06,a08–a13,a15–a18,a20,a21–a27, startEpoch 1788969605.
- M3 acceptance/m3/receipt.json: pass, 5/5, required
  m3-a03,a04,a05,a10,a11,a14,a15, startEpoch 1788971099.
- M4 acceptance/m4/receipt.json: pass, 4/4, required
  m4-a01,a03,a06,a07,a09, startEpoch 1788972602.
- M5 acceptance/m5/receipt.json: pass, 5/5, required
  m5-a04,a05,a08,a09,a10,a11, startEpoch 1788978749.
- M6: suite authored (a08 push payload, a09 view-once "Photo" preview, a10/a11
  custom-client demo, a13 sample-50 replay) with coverage.json; never executed
  (blocked). No receipt.json. M8: no suite authored. M7: not-run.

## Choreography results per milestone

- M1: segment-summary green:true, 3/3 required assertions passed
  (profile-edit-live-visibility, session-persists-on-relaunch,
  logout-remains-signed-out-on-relaunch), runId 37b46af3.
- M2: only preserved in-lane segment receipt is green:false 0/9 (runId
  ffda91f7, pre-aria-fix diagnostic); post-fix rerun receipt not preserved
  in-lane — gap, standing retained per continuation order.
- M3: no segment receipt preserved in-lane — gap, standing retained likewise.
- M4: segment-summary green:true, 5/5 (photo 3/3, video, reaction 3/3, edit
  3/3, delete), runId 27e102f8, settlement 57.5s of 110.2s.
- M5: segment-summary green:false, 1/4 (warm-offline-search passed;
  chat-color-background-sync, view-once-single-view-and-refusal,
  disappearing-message-expiry-and-purge failed), runId 96584b9b, plus
  attempts 1–13 forensics in diary.md. Thirteen attempts: best 2/4
  (attempt-5: search + disappearing). No post-mutation receipt is claimed as
  canonical green.
- M6/M8: choreography never launched (blocked). M7: not-run.

## Native artifacts

- native/m1: ios Hermes .hbc
  (_expo/static/js/ios/index-21778bae32dba28fbd58668d95181039.hbc) + 27
  assets + expo metadata.json. Produced at M1 green.
- native/m4: ios Hermes .hbc
  (_expo/static/js/ios/index-7297e18f12459e695cb63526278f10e8.hbc) + assets +
  metadata {milestone m4, exportedAt 1788978535}. Produced at M4 green.
- M2/M3/M5 exports: absent (gap; not fabricated retroactively).
- M6/M8 simulator proofs (cold-start offline a01–a04; offline-restart
  durability): never attempted (blocked); absence never gated web green per
  brief, and none is claimed.

## Scale disposition

Not-run. scripts/replay.mjs (464 lines, idempotent via clientKeys) and the
sample-50 conformance test exist but were never executed green; no fresh
instance was created, no scale.log replay ran, no invariant-manifest
verification exists. No replay epochs to record.

## Resolved package pins (lockfile v3)

snapback2 0.0.20 (exact brief pin) + snapback2-darwin-arm64 0.0.20; expo
54.0.37; expo-router 6.0.24; react 19.1.0; react-dom 19.1.0; react-native
0.81.5; react-native-web 0.21.2; playwright 1.62.1; typescript 5.9.2. Toolchain
per setup-identity.json: node v24.18.0 (volta absolute path), npm 11.16.0,
bun 1.3.12, chromium, instrument pin social-messenger@0.3.6-m8.

## Hand-authored line counts by file (wc -l)

Quarry backend: access.q 9, config.q 26, conversations.q 103, feeds.q 51,
follows.q 22, groups.q 58, messages.q 226, notifications.q 7, posts.q 117,
profiles.q 43, push.q 7, schema.q 358. TS backend: delivery.ts 18,
notifications.d.ts 18, seed.ts 75. Client app/: _layout 62, auth 58, chats
102, compose 131, index 260, new-chat 117, onboard 64, search 196, settings
51, viewer 129, insights 13 (stub), conversation/[handle] 58 + settings 35,
conversation/group/[group] 35 + settings 27, c/[id] 29, post/[id] 140,
profile/[handle] 144, profile/edit 116. components/: Conversation 830,
ChatSettings 218, PostCard 138, FeedComposer 106, TabBar 40. lib/: session
121, data 225, ensure 28, viewerCache 20, threadStash 176, json-schema.mjs
(unlisted size, harness helper). Scripts: acceptance 73, custom-client-demo
88, probe-signup 22, replay 464, seed 59, serve-dist 60. Suites: m1 173, m2
367, m3 204, m4 221, m5 199, m6 148. API.md 108; app.json 13; app.config.js 9;
index.js 1; metro.config.js 6; tsconfig.json 27. vendor/social-ui (frozen kit
+ lane fixes, e.g. aria-valuetext): 18 files, ~3596 lines total (largest:
FeedCard 342, ChatSettingsForm 477, ProfileForm 408, MessageBubble 358).
Excluded from counts: node_modules, dist, .snapback, lane-local choreography
(copied instrument + debug scripts), fixtures.

## Candid gap list

1. M5 realtime choreography never green: observer-side media-fetch/commit
   latency under serial-drain contention (color-background second half,
   view-once viewer, disappearing cold reopen). Product state sync was proven;
   observer timing was not.
2. In-lane frozen receipts missing/failed for M2 (pre-fix failed diagnostic
   only) and M3 (none) — standing retained per continuation order, evidence
   gap admitted.
3. M2/M3/M5 iOS Hermes exports never produced.
4. M6 blocked: push seam, offline queue UI states, custom-client demo, and
   sample-50 replay all authored but never executed; simulator cold-start
   proofs absent.
5. M8 unbuilt: insights aggregates, trending ranking, scheduled digest
   emission, multi-device sync, durable offline queue (13-line stub route
   only).
6. Scale envelope entirely unverified (no replay, no degradation-rule
   measurement).
7. Platform gaps carried forward: no substr primitive; RNW
   accessibilityValue/selected unmapped; tokenless asset URLs unusable from
   plain media tags; 15s live-push clustering; cold coverage-sync cost;
   signup/login grant asymmetry; post-delete Bearer-URL residual risk.
8. M2/M3 phase walls and first-green epochs reconstructed from bounds, not
   timestamped phase lines (run-log recorded only M1/M4 greens).
9. Web tier disposable: serve-dist exited with the prior session (port 50710
   closed at handover); owner/database durable (PID 59621, HTTP 200).
10. Lane-local harness mutation (settlePage/rewarmSettings, +351 lines) means
    future M5 work must re-sync the frozen instrument before any receipt can
    count.

## Close-out actions

Health-checked at 1788993179 (owner 200/113ms; web down; load 5.9). No code
changed, no servers started, no milestones attempted beyond the blocking
determination. Lane-owned owner PID 59621 killed with plain `kill <pid>` at
close; dead web PID 37175 needed no action; wedged renderer PID 51472 and the
orchestrator's cap-closeout processes left untouched (not lane-owned; never
pattern-killed).

end=1788993273
