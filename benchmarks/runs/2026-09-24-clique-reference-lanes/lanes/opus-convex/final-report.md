# Final report — opus-clique-convex-ref-20260924

- lane id: `opus-clique-convex-ref-20260924` · model `claude-opus-5-5` · effort=high
- backend: **Convex** `convex@1.46.0` (exact pin), anonymous/local posture: `convex-local-backend`
  binary `precompiled-2026-09-21-0cf49cb`, run directly on 127.0.0.1 inside ports 49300–49319
  (dev 49301/49302, scale 49305/49306, static web 49310, Expo dev 49311). No hosted Convex project.
- lane start: `start=1790294903`
- Instrument pin: `social-messenger@0.3.8-m8` (choreography copied to `./choreography`, metering to `./metering`).

## Milestones

| Milestone | Start epoch | First-green epoch | Wall (s) | Status | Suite (tests / coverage) | Choreography (green receipt) |
|---|---|---|---|---|---|---|
| M1 Accounts & profiles | 1790294903 | 1790297156 | 2253 | **green** | 8/8, 7/7 suite-required mapped | `evidence/choreo-m1-green.jsonl` (3/3 checks) |
| M2 Posts & follow graph | 1790297156 | 1790297559 | 403 | **green** | 10/10, 22/22 | `evidence/choreo-m2-green.jsonl` (9/9) |
| M3 Messaging core | 1790297559 | 1790297846 | 287 | **green** | 5/5, 7/7 | `evidence/choreo-m3-green4.jsonl` (7/7; green/green2 failed, see loops) |
| M4 Media, reactions, edit/delete | 1790297846 | 1790298066 | 220 | **green** | 6/6, 5/5 | `evidence/choreo-m4-green.jsonl` (5/5) |
| M5 Ephemeral, chat config, search | 1790298066 | 1790299405 | 1339 | **green** | 7/7, 6/6 | `evidence/choreo-m5-green.jsonl` (4/4 incl. 5-min disappearing wait) |
| M6 Offline writes, push, API | 1790299405 | 1790299740 | 335 | **green** | 5/5, 5/5 | `evidence/choreo-m6-green.jsonl` (1/1 web; simulator status not recorded) |
| M7 Day-2 evolution | — | — | — | **not-run** (separate fresh session by design) | — | — |
| M8 Insights, digest, multi-device | 1790299947 | 1790300256 | 309 | **green** | 5/5, 6/6 | `evidence/choreo-m8-green2.jsonl` (5/5 web; green attempt 1 failed on a precondition, see loops) |

Wall between M6 green (1790299740) and M8 start (1790299947) was spent on the M6-scoped
scale-replay tooling (verifier, orchestration) and launching the replay.

Final regression on the final build (after all post-M8 hardening): every suite passes
(`npm run acceptance -- --milestone m1…m8`) and the full continuous choreography `all`
(M1, M2, M3, M4, M5, M6, M8) is green in one run: `evidence/choreo-all-final.jsonl`.

Suite evidence per milestone: `evidence/suite-mN.json` (+ `evidence/coverage-mN.json` coverage
manifests; `evidence/suite-status.json` links them into the choreography). Beyond the required
assertions the suites also exercise several grader items: server-side edit-window rejection (waits
out the 60 s shortened window), delete revoking the media URL, view-once asset refusal, disappearing
expiry with no client open (waits out the 3-min TTL), logout revoking the token, token refresh, and
a real scheduled digest (one payload, correct counts, unauthorised chat excluded, quiet user gets
none). Seed idempotency (m3-a15) re-runs in every suite from M3 on.

Native/simulator artifacts (M6 a01–a07, M8 a17–a18): **not recorded** (not required for this run);
they never gate web green. `npm run seed -- --segment m1|m2|m3` installs starter segments
(cumulative, idempotent).

## Native artifacts produced (iOS Hermes bundle exports)

`artifacts/ios-<milestone>-entry-<hash>.hbc` — Hermes JavaScript bytecode v98 via
`npx expo export --platform ios`: m1, m2, m3 (two builds), m4, m5, m6, m8, final
(`ios-final-entry-276afd50967d4573a12e6df94f8fc1e9.hbc`, sha256 `74159eef…f7e8b7`). No simulator runs.

## Scale replay (own clock)

- Driver: `scripts/scale-replay.sh` → `scripts/replay.mjs` (adapter `scripts/lib/replay.mjs`, every
  one of the 13 verbs, each action settled before the next), fresh instance `.instances/scale`
  seeded with starter m1–m3, replay mode on (push seam + digests disabled).
- Attempt 1: start 1790299870, failed at action 67 (`Function execution timed out (maximum duration: 1s)`
  in Convex Auth's signup mutation under host load avg ~160). Instance discarded.
- **Attempt 2: start=1790299941, last action settled ≈1790303425, driver end=1790303427.**
  Wall 3486 s including the two checkpoint pauses; pause-excluded replay time 3392 s (sum of
  per-action settle deltas in `evidence/replay-scale.jsonl`). **167,157 / 167,157 actions settled**
  (fully acknowledged). Checkpoints: 10 % after 24,777 actions, 50 % after 88,057 actions.
- **Verification against `invariant-manifest-combined.json`: PASS at 10 %, 50 % and final**
  (`evidence/scale-verify-{10,50,final}.json`): all 18 per-entity counts, follow-edge count, all
  1,008 per-user following and conversation counts, all 1,002 per-chat message counts, all 101
  per-group member counts, and the named O5 fixtures via the app API (u0500 = 500 following /
  100 conversations, u0005 = 5, u0900 = 900 followers / 200 posts, u0901's exact 5-account list,
  g0001 = exact 50-member roster and 10,000 messages by full paging). Final check re-run after the
  code changes below: PASS.
- Seeded deterministic API sample (every action class; seeds 20260924 and 7): PASS
  (`evidence/scale-sample-verify-seed*.json`). The driver's own post-replay sampled verification
  crashed on a 4,096-read limit (my verifier paged 500 messages at a time), so the driver exited 1
  after the replay had fully settled; the sample was re-run with the fixed code.
- Diagnostic probes (sequential, 3 warm-ups, k=20, ms): `evidence/scale-probes-*.json`.
  At 10 %/50 % (pre-fix code): following u0500/u0005 p95 ratio 7.73 / 2.87; page 50/page 1 n/a / 0.96.
  At final with pre-fix code: following 6.43, celebrity write 15.0 (fails). **Final after the fixes
  (`scale-probes-final-v3.json`)**: busy-chat page 50/page 1 p95 0.87, following 500-follow/5-follow
  2.56, celebrity-follower/5-follow 1.04, celebrity post-create/small-author 0.45; trending p95 36.7,
  insights p95 7.8, global search p95 3.9, u0500 cold chat list 100 conversations. The fixes were
  deployed to the scale instance after the replay with a one-time data migration (logged); the
  10 %/50 % probes therefore reflect older code and the full-vs-10 % curve rules were not re-measured.

## Correction loops (attribution, evidence)

1. **Dashboard outside port range** — anonymous `convex dev` watch mode auto-starts a dashboard on
   127.0.0.1:6790 with no flag; switched to running the backend binary directly. *convex-defect
   (knowledge-gap)*; run-log 1790296041.
2. **M2 follow backfill miss** — scheduled backfill didn't land once in a full run; concurrent OCC on
   `follows` logged; not reproducible. First page moved into the follow mutation. *ambiguous*;
   backend.log 00:48:14.
3. **M3 member removal lost on navigation** — harness reloads right after tapping Remove; routed
   admin/settings writes through the durable outbox; restored the starter group after the aborted run.
   *agent-error*; `choreo-m3-green.jsonl`.
4. **M4 test helper key-order equality** — *agent-error*.
5. **M5 view-once viewer node + offline search window** — viewer rendered after async fetch; cache
   held only 50 newest messages. *agent-error*; `choreo-m5-dry1.jsonl`.
6. **M6 `InvalidCursor`** — history query range bounded by a moving `lastSeq`. *agent-error* (the
   error named the cause exactly).
7. **Scale signup timeout** — Scrypt inside Convex Auth's 1 s-limited mutation under host load;
   bounded idempotent retries. *convex-defect (defect)*, aggravated by *environment*.
8. **M8 choreography precondition** — suite posts pushed Alice's posts off Bob's first Global page;
   one fresh Alice post before the run (`scripts/alice-fresh-post.mjs`, logged). *agent-error*.
9. **Read-limit overruns at the envelope** — 500-message pages, hub (1,000-chat) chat list, hub global
   search. Page clamp 200, top-100 chat list, unfiltered-index search for hubs. *agent-error*.
10. **O5 degradation rules** — following/trending cost scaled with index-range size; celebrity fan-out
    backlog slowed later acks. Timeline cap 400, trending candidate table, deferred large fan-out.
    *agent-error (design)*; the range-size cost itself is a platform characteristic (*ambiguous*).
11. **M2 suite pagination wait** — after async fan-out became batched, the test waited for endpoints
    only. *agent-error* (test).

Also: Convex Auth `signUp` with an existing email and correct password signs in instead of failing;
worked around by wrapping the provider's `authorize` (found in package source before any done-claim).

## Resolved package pins

convex 1.46.0 · @convex-dev/auth 0.0.95 · @auth/core 0.41.1 · expo 57.0.25 · expo-router 57.0.23 ·
react 19.2.3 · react-native 0.86.3 · react-native-web 0.21.2 · typescript 6.0.3 ·
playwright 1.62.1 (choreography) · Node v24.18.0 · convex-local-backend precompiled-2026-09-21-0cf49cb ·
UI kit vendored from the instrument (0.3.3-m8) in `ui-kit/`.

## Hand-authored line counts

Backend `convex/` (excl. `_generated`): 3,239 — schema 247, social 558, chats 531, messages 508,
testSupport 313 (operator-only), users 184, search 166, digest 142, profiles lib 134, push 82,
insights 80, chatAccess 63, auth 56, config 43, session 31, media 21, viewOnceHttp 19, idempotency 17,
crons 13, authHelpers 13, http 10, auth.config 8.
Client `src/`: 2,864 — ConversationView 540, session 171, media 161, outbox 152, search 123,
ChatSettingsView 122, FeedPanel 115, cache 109, PostComposer 103, AuthScreen 101, profile/[handle] 88,
Shell 88, kv 88, PostCard 85, _layout 81, new-chat 80, ChatsPanel 71, web 64, profile/edit 63,
insights 54, ChatRoutes 50, online 40, MediaViewer 38, settings 37, post/[id] 36, index 29,
feedData 26, ErrorBoundary 24, feedTab 21, convex 19, format 16, route stubs 6–9 each, NativeVideo 9.
Scripts `scripts/`: 1,515 — replay lib 314, verify lib 271, scale-verify 141, instance 129,
custom-client-demo 126, replay 91, choreo 90, scale-probes 84, clique-client 65, seed 39, serve-web 36,
setup-env 33, scale-replay.sh 25, scale-sample-verify 23, restore-starter-group 15, backend.sh 12,
build.sh 12, alice-fresh-post 9.
Tests `tests/`: 1,362 — m2 275, m8 180, m5 157, m1 144, m4 140, context 132, m6 106, acceptance 102,
m3 97, seedcheck 29.
Docs: API.md 182, essay.md 115, diary.md ~220. **Total code ≈ 8,980 lines.**

## Candid gap list

- **Native proofs absent.** No iOS simulator runs; native offline cold start, durable queue across
  app kill (M8 a17/a18) and native media playback are implemented but unverified.
- **Web cold-start offline** (reloading with no network) is not supported — no service worker; the
  durable store and queue survive reloads only when the bundle can load.
- **Following timeline is capped** at each user's newest 400 materialised items (older posts remain
  on profiles and in Global); a newly followed account backfills at most its newest 500 items.
- **Search ordering** is exact newest-first only within the candidate window Convex's relevance-ranked
  text index returns (256 per chat; 1,024 globally for 100+-chat accounts); multi-term queries rely on
  the index's last-term prefix plus my post-filter.
- **Media sends are not queued offline** (text, likes, reposts, reactions, follows, chat-admin ops are).
- **Video ≤60 s** is not validated server-side (type and size are).
- **Normal media URLs are capability URLs** (anyone holding one can fetch until deletion/expiry);
  view-once uses single-use, per-recipient tickets instead.
- **Presence is heartbeat-based** (10 s beats, 30 s TTL), so push suppression lags a closed client by up
  to 30 s unless the page's `pagehide` beat lands.
- **Two choreography preconditions were restored by hand** (starter group roster after an aborted
  run; one fresh Alice post before M8 runs) — both logged; no harness or app change.
- **O5 caveats:** fixes landed after the replay (deployed + migrated, logged); 10 %/50 % probes ran on
  the older code; the Trending fallback for <10 liked posts in 24 h still walks un-liked posts.
- **Operator-only test seams** (`testSupport:*` internal functions, e.g. backdating a post for the
  24 h Trending test) are deployed with the app; they are admin-key only, never client-callable.
- Removed/left members keep server-side read access to history up to their removal (by design).
- UI is functional rather than polished; the web layout is desktop-first.
- Token accounting is left to the harness (not estimated here).

end=1790305355
