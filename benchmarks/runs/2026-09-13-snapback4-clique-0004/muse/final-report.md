# Final report: Clique on Snapback 4 (lane muse-snapback4)

## Raw clock

- lane start: `1789346454`
- lane end: see `end=<epoch>` trailer.
- backend: `snapback4@0.2.6` dev server on `http://127.0.0.1:49300`
  (PID 84007 until re-bootstrap, then PID 96584 on a fresh store);
  web: static `dist/` export on `http://127.0.0.1:49301` (PID 28867,
  re-exported after the video fix); push worker live against dev.
- scale replay ran on a separate fresh instance on port `49302` (in-memory
  `--fresh` store, killed after the run; no port or data overlap with dev).

## Milestones

| milestone | status | first green | checks |
|---|---|---|---|
| m1 | green | 1789351005 | 10/10 |
| m2 | green | 1789356017 (34/34; 31/31 earlier same day) | 34/34 |
| m3 | green | 1789351171 | 9/9 |
| m4 | green | 1789352119 | 14/14 |
| m5 | green | 1789353072 (15/16 partial at 1789352522) | 16/16 |
| live | green | 1789354061 | 14/14 |
| m6 | green | 1789354831 | 13/13 |
| m7 | not-run | — | out of lane scope (M1–M6+M8 tasked); M7 rulings (fresh-instance base state) honored in scale procedure |
| m8 | green | 1789355969 | 19/19 |

Wall by milestone (start 1789346477 m1-start): m1 ≈ 4.5k s (includes
schema-compile iterations), m2/m3 same session, m4 ≈ +0.9k s, m5 ≈ +1.0k s,
live ≈ +1.0k s, m6 ≈ +0.8k s, m8 ≈ +1.1k s. All greens via
`node tests/accept.mjs --only=m1,m2,m3,m4,m5,live,m6,m8` (133 checks).

Post-green re-runs on the dirty dev instance showed 115/117 twice with the
same two failures, investigated to root cause (not flakes):

- `m4-a03-settled` — REAL APP BUG, fixed. The web client's `sendVideo`
  died in the local device replica with `E_FIELD: missing field duration`
  (no wire request at all — proven by request interception). The replica
  validates a video ref's duration before the just-uploaded asset row syncs
  back, so bare `{id}` refs fail; images need no duration and were
  unaffected. The M6 offline work (new local-replica behavior, exported to
  `dist/` at 19:56, after m4's 19:15 green) exposed it. Fix: `uploadVideo()`
  threads the server-probed duration into the clip ref
  (`ConversationView.tsx`, `feed.tsx`, `media.ts`); plus an attach/send race
  guard (fast tap after attach no longer silently drops the message).
  Verified: m4 14/14 alone, direct-wire duration-hint probe accepted.
- `m5-a04-people` — STATE POLLUTION, no code fault. Search `car` pages at
  20 hits; every suite run adds Carol-named fixture users, eventually paging
  the current run's handle out. Direct probe showed `carol` ranked first;
  the app behavior is correct. Fix: re-bootstrapped dev on a fresh store
  (old store + assets preserved under `/tmp/snapback4-backup/`) and
  re-greened everything once, which is also the state handed over.

Clean re-green (fresh store, reseeded m1–m3, worker live): full suite
124/129 — the 5 failures all ran before the push worker was up
(m6-a03 ×2, m8-a04 ×2, m8-a04-empty cascade); m6+m8 re-run with worker live:
32/32. m1–m5+live fully green in the clean run. Sample replay on fresh dev:
50/50 (`coverage/sample-50.json`). Every check is green on the handed-over
state; PIDs/ports unchanged (backend 49300, web 49301).

## Correction loops and attribution

From run-log.md (every entry preserved there):

1. sync-proof failures (agent-pending → resolved in schema).
2. schema-compile errors, 6 iterations, agent-error (self-justifying
   created-members branch; README example was accurate).
3. digest-upsert hidden-row collision, 8 iterations, ambiguous
   (hidden-row upsert refuses; fix = public-read counters).
4. feed unfollow/unrepost purge, 3 iterations, agent-error (purge direct
   hits + retracts job + client pending filter).
5. social sync-blindness (live a04–a06), 4 iterations, agent-error (sync
   public follows/likes/reposts/replies + entryCard counts + onPick prop).
6. fanout double-bump, 1 iteration, agent-error (job skips bucket 0).
7. dedupe-poison wire ids (NOT_FOUND recorded during broken-schema era),
   agent-error (namespace bump sd1).
8. seed shape mismatch, 1 iteration, agent-error (array-shape seed rows).
9. replay target resolution (sample 27/50), agent-error (actor-name-first
   resolution, then handle).
10. replay wire-replay poison, ambiguous (replayed:true on fresh retry;
    fix = per-process nonce retry wire).
11. asset-cache violates one-asset-one-home, agent-error (E_ASSET_PLACED ×
    3113 on scale-run-1; fix = fresh upload per placement + E_ASSET_PLACED
    re-upload recovery).
12. video-send local-replica duration, ambiguous (E_FIELD via request
    interception; fix = duration-hint refs + attach/send race guard).
13. worker token dead after re-bootstrap, environment (mint fresh pusher
    token; worker reframes as infra, not app).
14. verifier paging (`complete` = page-complete, follow `next`), verifier
    login rate limits (10 s backoff), generator fixture leaks (u001 base
    follows, churn clearing u001 edges) — agent-error/ambiguous mix.

Environment workarounds (not loops): host ffmpeg broken (missing x265
dylib) → fixture-PNG poster fallback; auth rate limits → backoff harnesses.

## Suite and choreography results per milestone

Acceptance suite (`tests/accept.mjs`, headless Chromium, two-client
contexts for live/m6/m8): all suites green at the first-green times above.
Two-client behavior is exercised in-lane (DM delivery Alice↔Bob, group
lifecycle with Carol/Dave, second same-account Alice context for M8,
offline queue/flush, digest stranger exclusion).

Instrument choreography harness (`choreo/choreography.mjs`): not executed
in-lane — no receipts artifact was produced here; the harness runs at grade
time. The app implements the frozen contract IDs it consumes. Simulator
statuses: `ios-simulator-m6: null`, `ios-simulator-m8: null`
(recorded separately per simulator.md; absence is not a web-green claim).

## Native artifacts produced

- iOS Hermes bundle export: `app-host/clique/dist-ios`,
  `entry-d0e6db042514d967203b0330f6580997.hbc`, 2,788,000 bytes,
  sha256 `930026f767d40177a7e04b2030ff3d1baff98c6791c5eee8136a0c8ee78d8639`
  (`npx expo export --platform ios`, includes the video fix).
- Web bundle: `app-host/clique/dist` re-exported after the video fix
  (entry-9d21c5…, verified serving `uploadVideo`), + `dist-web`.
- Interactive iOS-simulator offline proofs (m6/m8 screen + receipts):
  not produced — gap (see below).

## Scale replay clock and verification

Generator: `scripts/gen-scale-log.mjs` (mulberry32 seed 20260913,
deterministic). Reduced but structurally complete envelope: 300 users,
celebrity (270 followers, 60 spread posts), celeb-follower (5 follows),
probe (150 follows, 30 conversations), busy group (15 members, 3000
messages), ≈6,060 posts, 12,000 messages, follows/likes/reposts/replies
with set/clear churn, quotes, view-once, reacts incl. clears, checkpoint
markers at 10%/50%. Total: 36,809 actions in `scale.log`.

Adapter: `scripts/replay.mjs` — own auth path, every verb, settle-then-next,
own recorded clock (`startEpoch`/`endEpoch`/`wallMs`), replay-mode pin
(push seam disabled; feeds/receipts normal), checkpoint pause records.

- scale-run-1: actions=36809 ok=33696 failed=3113 wall=702.1 s
  (startEpoch 1789356914 endEpoch 1789357616). All failures E_ASSET_PLACED
  from the (since removed) asset cache. Checkpoints: 10% at 615.1 s
  (registrations: ~300 password hashes + rate-limit backoffs dominate),
  50% at 656.0 s.
- scale-run-2 (final): actions=36804 ok=36804 failed=0 uploads=4328
  wall=713.1 s (startEpoch 1789359831 endEpoch 1789360544), total driver
  time 837.6 s including seed + verify. Checkpoints: 10% (3,680 actions)
  at 616.4 s, 50% (18,402 actions) at 661.0 s — registrations dominate;
  the remaining 90% settles in ~100 s. Two intermediate runs caught and
  fixed real defects (asset cache, paging semantics, fixture leaks);
  evidence in run-log.md.
- Verification: `scripts/verify-replay.mjs` (independent log parse +
  seeded sampling seed 777 + named fixtures exact): 88/88 green —
  celebrity 270 followers / 60 posts, celeb-follower 5 follows,
  probe 150 follows / 30 conversations, busy chat 3000 messages / 15-member
  roster exact; 10 chats full-paged counts, 10 users profiles+counts, 10
  people-search resolutions, 10 posts like/repost/reply counts, 20 follow
  edges present, 5 cleared edges absent, 5 reactions, 5 quotes, 5 group
  rosters. Report: `coverage/scale-verify.json`.

## Resolved package pins

- `snapback4@0.2.6` (lane root), `snapback4-expo@0.2.1` (app-host/clique).
- expo `~57.0.22`, react `19.2.3`, react-native `0.86.3`.

## Hand-authored line counts by file

Schema: `snapback/schema.q` 978. Adapter/tooling: `scripts/replay.mjs`
540, `scripts/verify-replay.mjs` 311, `scripts/gen-scale-log.mjs` 267,
`scripts/scale-run.mjs` 53, `scripts/seed.mjs` 80, `scripts/worker.mjs`
50, `scripts/custom-client-demo.mjs` 119, `scripts/postexport-web.mjs`
68. Tests: accept 42 + m1 114 + m2 183 + m3 95 + m4 160 + m5 180 +
m-live 246 + m6 208 + m8 281 + helpers 184. App: ConversationView 736,
src-api 414, feed 322, ChatSettingsView 221, sb.tsx 179, PostCard 145,
assetCache 150, pending 121, chats 117, search 137, new-chat 102,
insights 56, media 96, AssetImage 80, auth 48, settings 28, index 16,
_layout 10. Essay `essay.md` 156.

## Candid gap list

1. Interactive iOS-simulator proofs (m6 cold-offline, m8 durable queue)
   not produced: no native driver or screen recordings; statuses null.
2. Scale envelope is reduced (≈1:5 users/posts/messages vs the brief's
   1k/50k/100k); full-envelope behavior is projected, not measured.
3. People search has no exact-match ranking; repeated suite runs on one
   instance accumulate same-name users against the 20-cap. Handed-over
   state is clean (one run) and green; graders re-running the suite
   repeatedly on the same backend will re-accumulate.
4. Video poster path depends on host ffmpeg, broken on this machine
   (fixture-PNG fallback pinned and logged). Client poster capture via
   `<video>`+canvas works headless (verified 320×240 PNG in intercept).
5. The real fixture-pack scale log was not present in-lane; the adapter is
   validated against the frozen action schema and a conforming generator,
   not the grader's bytes.
6. Long-lived processes (backend 49300, web 49301, worker) are
   runtime-managed and end with this session; restart commands:
   `snapback4 dev --port 49300` (lane dir), `serve -s dist -l 49301`
   (app-host/clique), `node scripts/worker.mjs --url
   http://127.0.0.1:49300 --log push.log` (fresh token auto-mints).

end=1789363567
