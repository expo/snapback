# Final report — opus-clique-snapback4-ref-20260924

- model: claude-opus-5-5, effort=high
- backend: snapback4-0.4.0 (published npm, exact pin); native arm: snapback4-expo@0.4.0 (published, exact pin)
- host: macOS arm64 (Apple M5 Max, 18 cores), shared; Node 24.18.0, npm 11.16.0, Bun 1.4.2
- ports used: 49200 (dev backend), 49201 (web client static server), 49202 (fresh scale-replay instance)
- start=1790294902 (2026-09-25T00:08:22Z)

## Milestones: raw epochs, wall, status

Boundaries are the lane-global terminal sequence: each milestone starts at the
previous milestone's terminal (green) boundary; M1 starts at run start, so
orientation (reading the README, CLIENT-AND-OPERATIONS.md, SERVER.md, all 29
guide cards, the brief, contract, assertions and the choreography source) is
inside M1. First-green = the later of the suite pass and the choreography pass.

| Milestone | Start epoch | First-green epoch | Wall (s) | Status | Suite receipt | Choreography receipt |
|---|---|---|---|---|---|---|
| M1 | 1790294902 | 1790296126 | 1224 | green | receipts/suite-m1-1790296105.json | receipts/choreo-m1-1790296109.jsonl |
| M2 | 1790296126 | 1790296571 | 445 | green | receipts/suite-m2-1790296550.json | receipts/choreo-m2-1790296555.jsonl |
| M3 | 1790296571 | 1790297057 | 486 | green | receipts/suite-m3-1790297007.json | receipts/choreo-m3-1790297010.jsonl |
| M4 | 1790297057 | 1790297301 | 244 | green | receipts/suite-m4-1790297280.json | receipts/choreo-m4-1790297280.jsonl |
| M5 | 1790297301 | 1790298123 | 822 | green | receipts/suite-m5-1790297740.json | receipts/choreo-m5-1790297740.jsonl |
| M6 | 1790298123 | 1790298150 | 27 | green (web authoring green) | receipts/suite-m6-1790298136.json | receipts/choreo-m6-1790298136.jsonl |
| M7 | — | — | — | not-run (separate fresh session by design) | — | — |
| M8 | 1790298150 | 1790298506 | 356 | green (web authoring green) | receipts/suite-m8-1790298459.json | receipts/choreo-m8-1790298493.jsonl |

Notes on the clock:
- Milestone "start" markers in run-log.md (M1 1790295251 after orientation, M2 1790296231, …)
  are later than the boundaries above because each green was followed by its iOS export.
- M5's wall includes two real 300 s disappearing-message waits in its choreography. Most
  M6 authoring (push-seam worker, API.md, the custom-client demo, the replay adapter and the
  sample-50 conformance check) was done during those waits, from ≈1790297576; M6's 27 s
  boundary-to-boundary wall therefore understates M6 effort. M8 backend authoring overlapped
  the scale replay's own clock.
- Total M1–M8 wall (run start → M8 green): 3604 s (≈60 min). Last evidence (final regression
  pass, see below) extends the session; `end` is at the bottom.

Per-milestone suite results (suite-required assertions, all mapped in tests/coverage.json):
M1 7/7, M2 22/22, M3 7/7, M4 5/5, M5 6/6, M6 5/5, M8 6/6 — every suite also re-runs the
seed-idempotency check over the segments installed so far.

Per-milestone choreography (first green run): M1 3/3; M2 9/9; M3 6/6 required + 1 optional
instrument skip (`sender-avatar-identity-when-rendered`: the kit's 1:1 layout does not mount
`sm-convo-sender-avatar`; group bubbles do); M4 5/5; M5 4/4; M6 web 1/1; M8 web 5/5.
Simulator/native-artifact assertions (m6-a01..a07, m8-a17/a18) were not produced (not
required in this run; `greenRequired:false`), so native/O4 evidence is absent, not passed.

## Correction loops and attribution

| # | When (epoch) | Loop | Attribution | Evidence |
|---|---|---|---|---|
| 1 | 1790296048 | Web file input never mounted: Metro resolved `pick.ts` before `pick.web.tsx` | agent-error | receipts/suite-m1-1790296048.json |
| 2 | 1790296510 | Composer cleared its text after an async submit, wiping the next reply | agent-error | receipts/suite-m2-1790296510.json |
| 3 | 1790296510 | FlatList virtualization hid page-2 items from the pagination test | agent-error | same |
| 4 | ~1790297185 | Video message sent caption-only: web picker awaited poster generation before attaching | agent-error | first receipts/choreo-m4-*.jsonl |
| 5 | 1790297192 | Suite compared reaction JSON with key order | agent-error | receipts/suite-m4-1790297192.json |
| 6 | ~1790297280 | Viewer `<video>` testID raced the async asset fetch in the harness's root/descendant check | agent-error | receipts/choreo-m4 (second run) |
| 7 | 1790297576 | `snapback/server.ts` E_SERVER_TYPECHECK (Node types hidden by Expo tsconfig; `import.meta` refused as CJS); dev kept serving the previous generation | ambiguous (diagnostic accurate; docs say install @types/node but not the ESM/types detail) | run-log line 1790297576 |
| 8 | 1790297724 | Suite compared CSS-uppercased group headers case-sensitively | agent-error | receipts/suite-m5-1790297724.json |
| 9 | ~1790298140 | Custom-client demo lingered 30 s on an uncleared race timer | agent-error | run-log |
| 10 | ~1790298490 | M8 choreography a02: no unliked Alice post on Bob's first Global page (my suites' posts had pushed them off) — precondition re-established with one Alice post | agent-error (instance pollution by my own suite) | receipts/choreo-m8 first failing run |
| 11 | 1790298533 | Scale runner hashed checkpoint prefixes without the marker line; recomputed post-hoc (now equal to the manifest) | agent-error | logs/scale-replay.log "prefix sha DIFFERS" |
| 12 | 1790299626 | Regression under client/server clock skew: Trending ran on the device (so its 24 h window used the device clock, not server time) and a pending thread reply sorted by device time — Trending now reads an online-only aggregate so it runs on the server; pending replies render last | agent-error (`runs: device` was documented in api.ts) | receipts/suite-m2-1790299574.json, suite-m8-1790299626.json |
| 13 | 1790299242+ | Scale probe "celebrity post-create p95 ≤ 3× 5-follower author" failed (606.6 ms vs 17.3 ms); first read as host contention, corrected after a lower-load diagnostic to background timeline delivery (≈900 copies per celebrity post) competing with the next write | ambiguous (platform fan-out characteristic + shared-host contention) | receipts/scale-replay-evidence.json, run-log correction line |

No loop was attributed to a Snapback 4 product defect.

## Scale replay (own clock)

- Instance: fresh `snapback4 dev --port 49202 --replay` in `replay-instance/` (persistent SQLite
  store, push seam and schedules suppressed), seeded with starter-m1/m2/m3 through the same
  adapter, then `scale.log` (sha256 b26bf1ae…abba9 verified) replayed one settled action at a time.
- Clock: start epoch **1790298300** (2026-09-25T01:05:00.287Z), end epoch **1790299242**
  (01:20:42.859Z); replay wall **932.2 s** with 10.4 s of checkpoint probe wall excluded; cap
  14,400 s (6.5% used); 167,157/167,157 actions settled, 0 failed (~180 actions/s).
- Verification against `invariant-manifest-combined.json`: **10% CONFORMS, 50% CONFORMS,
  final CONFORMS** — every per-entity count (users 1008 … messages 100,015, reactions 2,000),
  per-user following and conversation counts, per-chat message counts, per-group member counts,
  the named O5 fixtures (u0500 500 follows / 100 conversations via API paging; u0005 5; u0900
  900 followers / 200 posts via API paging; u0901's exact 5-account list; g0001's 50-member roster
  and 10,000 messages by full API paging) and the named spot profiles/posts/messages/conversations.
- Receipts: receipts/scale-replay-receipt.json (`snapback.full-journey-scale-replay-receipt.v1`) and
  receipts/scale-replay-evidence.json, validated with the instrument's own
  `validateScaleReplayEvidence` (fixture path patched to this lane's instrument copy).
- Probes (k=20 after 3 warm-ups, sequential, p95 ms at 10% / 50% / full): history page 1
  2.9/2.9/2.4, page 50 2.5/2.4/1.5; Following u0500 2.7/2.5/2.2 vs u0005 2.6/2.8/1.9; celebrity-
  follower u0901 2.6/2.9/2.0; global search "coffee" 2.6/2.9/2.2; Insights u0500 1.8/1.9/0.7
  (362-byte answer — no corpus transfer); Trending 2.1/2.3/1.2; busy-group send p95 3.4.
- Degradation rules: 7/8 pass. **Fail:** celebrity post-create p95 606.6 ms (u0900) vs 17.3 ms
  (u0005). Follow-up diagnostics on the same instance: engine-metered work is identical for both
  authors (6 rows written); minutes later u0005 measured ~750 ms per post while u0900 measured
  4–5 ms, and a brand-new author with zero followers measured p95 424 ms in a burst — all while the
  shared host's load average was 79–188 on 18 cores. The latency tracks host contention and burst
  timing rather than follower count, but the recorded rule result stands as measured.
- Correction after a later diagnostic at host load ≈20: u0900 bursts still measured p50 7–943 ms,
  p95 2.0–2.4 s vs u0005 p50 6 ms, p95 26–602 ms. `snapback4 why createPost` explains the shape:
  the post-create transaction is 4 writes independent of follower count, but the declared
  timeline then delivers one inbox copy per follower in background chunks (≤256) on the same
  single-writer engine, so back-to-back celebrity posts queue behind the previous post's
  ~900-copy delivery. So the failure is a platform fan-out characteristic amplified by host
  contention, not purely contention (attribution: ambiguous).

## Native artifacts

iOS Hermes bytecode bundles (`npx expo export -p ios`) at every milestone:
artifacts/ios-m1 … ios-m8 (`_expo/static/js/ios/entry-*.hbc`, Hermes bytecode v98, ~2.9 MB).
No simulator witness artifacts (not required this run).

## Resolved package pins

snapback4 0.4.0, snapback4-darwin-arm64 0.4.0, snapback4-expo 0.4.0; expo 57.0.22, react-native
0.86.3, react / react-dom 19.2.3, expo-router 57.0.23, react-native-web 0.21.2, expo-sqlite 57.0.3,
expo-video 57.0.5, expo-image-picker 57.0.20, babel-preset-expo 57.0.11, typescript 6.0.3,
playwright 1.62.1 (lane) / 1.62.1 + ajv 8.20.0 (copied choreography). UI kit 0.3.3-m8 vendored
unmodified in src/kit/; choreography 0.3.8-m8 copied unmodified (plus instrument/metering, which
it imports).

## Hand-authored line counts (non-blank lines)

Excludes the vendored UI kit (src/kit), generated files (snapback/generated, snapback/config.q,
src/config.generated.ts), the copied instrument harness, node_modules and build output.

```
   138  API.md
    15  app.json
   129  app/_layout.tsx
     7  app/c/[id]/index.tsx
     7  app/c/[id]/settings.tsx
     3  app/chats.tsx
    14  app/conversation/[handle]/index.tsx
    11  app/conversation/[handle]/settings.tsx
    12  app/conversation/group/[group]/index.tsx
    11  app/conversation/group/[group]/settings.tsx
    13  app/index.tsx
    44  app/insights.tsx
    52  app/new-chat.tsx
    30  app/post/[id].tsx
    66  app/profile/[handle].tsx
    74  app/profile/edit.tsx
    78  app/search.tsx
    20  app/settings.tsx
    14  choreography-adapter.json
     8  metro.config.js
    78  scripts/acceptance.mjs
    30  scripts/choreo.mjs
   126  scripts/custom-client-demo.mjs
    32  scripts/gen-config.mjs
    23  scripts/gen-coverage.mjs
    37  scripts/lib/actions.mjs
   199  scripts/lib/replay.mjs
    96  scripts/lib/verify-intents.mjs
    86  scripts/lib/wire.mjs
    28  scripts/line-counts.mjs
    58  scripts/replay.mjs
    70  scripts/scale/probes.mjs
   113  scripts/scale/run.mjs
   110  scripts/scale/verify.mjs
    33  scripts/seed.mjs
    29  scripts/serve-web.mjs
    42  scripts/setup-identity.mjs
   508  snapback/schema.q
    20  snapback/server.ts
    34  src/assets.ts
    23  src/Background.tsx
    88  src/chat/ChatSettings.tsx
   326  src/chat/Conversation.tsx
    28  src/chat/model.ts
    42  src/chat/resolve.ts
     9  src/chat/useInbox.ts
    60  src/ChatList.tsx
    20  src/client.ts
    15  src/errors.ts
   107  src/Feed.tsx
    28  src/MediaViewer.tsx
    34  src/Onboarding.tsx
    15  src/pick.ts
    66  src/pick.web.ts
    59  src/PostCard.tsx
    36  src/ProfileExtras.tsx
    11  src/read.ts
    16  src/store.ts
    10  src/time.ts
    27  src/Trending.tsx
    36  src/ui.tsx
    19  src/upload.ts
     6  src/Video.tsx
    13  src/Video.web.ts
   138  tests/coverage.json
   101  tests/lib.mjs
   121  tests/m1.mjs
   253  tests/m2.mjs
   108  tests/m3.mjs
   127  tests/m4.mjs
   132  tests/m5.mjs
    80  tests/m6.mjs
   150  tests/m8.mjs
    21  tests/seed-idempotency.mjs
  4823  TOTAL (non-blank lines)
```

## Gap list (candid)

1. **Offline media retention through `createApp`.** `createApp` has no `assets` option; the
   documented `keep: "viewed"` retention exists only on `createLocalClient`. Previously viewed
   (non-view-once) media therefore does not survive a cold offline start via the paved entry
   point. Platform gap (no diagnostic; the option simply is not on `AppOptions`).
2. **No simulator/native artifacts** for M6 (cold-start offline, pending → read) or M8 (durable
   queue across kill/relaunch). The SDK documents a durable IndexedDB/native outbox and a
   `witness ios` driver; I did not produce either proof, so native/O4 evidence is absent.
3. **Celebrity write-path degradation rule failed** on the recorded probe (see scale section):
   the post-create transaction is constant, but the declared Following timeline fans each
   celebrity post out to ~900 inboxes in background chunks on the single-writer engine, so a
   burst of celebrity posts waits behind that delivery. Not fixable from application code
   without abandoning the declared timeline; shared-host contention made it worse.
4. Receipts are an application design (per-membership delivered/read watermarks); the
   aggregate is computed client-side from the synced roster and server-side in `apiHistory`.
5. Group routes resolve by title client-side (earliest matching group wins); titles are not unique.
6. Typing indicators hide by comparing a server-stamped `expiresAt` with the browser clock (the
   documented pattern); a skewed client clock shifts the hide time.
7. `sync public` social tables mean every device acquires every post/like/repost/follow (≈50k posts
   at the envelope); web cold start at the full envelope was not measured in a browser.
8. Insights "posts" counts original posts (replies are counted as replies received by the parent's
   author); "likes received" includes likes on replies. Documented choice.
9. The digest's "since previous period" is the schedule period itself (`periodStart..periodEnd`);
   unread counts use the reader's read watermark at digest time.
10. M7 not attempted (separate fresh session by design).

## Final regression pass

After M8 every suite and every choreography segment was run again against the
same dev instance (backend restarted first to reset the dev clock):

- Suites: m1 PASS (suite-m1-1790299558), m2 FAIL → fixed → PASS (suite-m2-1790299712),
  m3 PASS (1790299584), m4 PASS (1790299597), m5 PASS (1790299610), m6 PASS (1790299614),
  m8 FAIL → fixed → PASS (suite-m8-1790299722). The two failures were real bugs under
  client/server clock skew (loop 12): Trending now runs on the server; pending replies sort last.
- Choreography `all` (receipts/choreo-all-1790299753.jsonl): m1, m3, m4, m5, m6 green; m2 and
  m8 (a02) failed because 96 suite posts created while the dev clock was advanced (up to
  ~18 min) carried future timestamps and filled Global's first page. After real time passed
  them, `m2,m8` re-ran green (receipts/choreo-m2,m8-1790300939.jsonl).

Net: every milestone M1–M6 and M8 is green at the end of the session on the final code.

- Session end (last evidence + report): 2026-09-25T01:51:32Z, epoch 1790301092; total session wall 6190 s.

end=1790301092
