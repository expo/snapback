# Clique — final report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`, effort `medium`. Built alone from the pinned public packages and frozen instrument. **M1, M2, M3, M4, M5, M6 and M8 are green. M7 is not-run by instruction.**

Run start `1789520404`; final milestone boundary `1789524531`; report/cleanup end `1789524796`. Proof wall: **4127 seconds**. Total through this report: **4392 seconds**. The first 31 seconds precede the logged M1 start and are orientation inside the run, not excluded. There are 19 seconds of scale-instance setup between M6 and M8.

## Milestones

| Milestone | Raw start | Boundary end | Wall seconds | First green epoch | First green from start (s) | Suite / choreography |
|---|---:|---:|---:|---:|---:|---|
| M1 | 1789520435 | 1789520880 | 445 | 1789520856.410 | 421.41 | green; 5 suite cases; 3/3 required choreography |
| M2 | 1789520880 | 1789521342 | 462 | 1789521289.398 | 409.398 | green; 8 suite cases; 9/9 required choreography |
| M3 | 1789521342 | 1789521753 | 411 | 1789521702.013 | 360.013 | green; 5 suite cases; 7/5 required choreography |
| M4 | 1789521753 | 1789522047 | 294 | 1789521994.637 | 241.637 | green; 4 suite cases; 5/5 required choreography |
| M5 | 1789522047 | 1789522874 | 827 | 1789522824.169 | 777.169 | green; 6 suite cases; 4/2 required choreography |
| M6 | 1789522874 | 1789523552 | 678 | 1789523507.166 | 633.166 | green; 4 suite cases; 1/1 required choreography |
| M7 | — | — | — | — | — | not-run |
| M8 | 1789523571 | 1789524531 | 960 | 1789523932.788 | 361.788 | green; 5 suite cases; 5/5 required choreography |

First-green epochs come from the earliest passing frozen segment summary with a passing suite. Boundary ends are the timestamped decisions in `run-log.md`; later verification and implementation hardening explain the gap at M8. M1 charged wall including initial orientation is 476 seconds. No milestone hit its four-hour limit. No capability-failure, abort, or blocked milestone occurred.

## Evidence and native artifacts

- M1: [evidence/m1-suite.json](evidence/m1-suite.json); [m1-choreo.jsonl](evidence/m1-choreo.jsonl); [Hermes bundle](artifacts/m1-ios-final/_expo/static/js/ios/entry-e4b8f3af1df9f6835ee4fddfff38a2ac.hbc) (2,673,444 bytes).
- M2: [evidence/m2-suite.json](evidence/m2-suite.json); [m2-choreo-1789521306931.jsonl](evidence/m2-choreo-1789521306931.jsonl); [Hermes bundle](artifacts/m2-ios-final/_expo/static/js/ios/entry-323765a3d64ca67a8140b462f0045bc4.hbc) (2,685,813 bytes).
- M3: [evidence/m3-suite.json](evidence/m3-suite.json); [m3-choreo-1789521659191.jsonl](evidence/m3-choreo-1789521659191.jsonl); [Hermes bundle](artifacts/m3-ios-final/_expo/static/js/ios/entry-f344aae68e3ad65e7fef7491785f3f2d.hbc) (2,707,421 bytes).
- M4: [evidence/m4-suite.json](evidence/m4-suite.json); [m4-choreo-1789521974657.jsonl](evidence/m4-choreo-1789521974657.jsonl); [Hermes bundle](artifacts/m4-ios-final/_expo/static/js/ios/entry-4abb1f3a3ddbd6b2bfc786dbb67362c4.hbc) (2,725,602 bytes).
- M5: [evidence/m5-suite.json](evidence/m5-suite.json); [m5-choreo-1789522486529.jsonl](evidence/m5-choreo-1789522486529.jsonl); [Hermes bundle](artifacts/m5-ios-final/_expo/static/js/ios/entry-110040f6fbfbd7671f62d2dff2f25a69.hbc) (2,734,760 bytes).
- M6: [evidence/m6-suite.json](evidence/m6-suite.json); [m6-choreo-1789523503924.jsonl](evidence/m6-choreo-1789523503924.jsonl); [Hermes bundle](artifacts/m6-ios-final/_expo/static/js/ios/entry-110040f6fbfbd7671f62d2dff2f25a69.hbc) (2,734,758 bytes).
- M8: [evidence/m8-suite.json](evidence/m8-suite.json); [m8-choreo-1789524448023.jsonl](evidence/m8-choreo-1789524448023.jsonl); [Hermes bundle](artifacts/m8-ios-final/_expo/static/js/ios/entry-858904e932dd7852cccfcdb119c0de3c.hbc) (2,740,934 bytes).

All suite-required IDs are mapped in [coverage-manifest.json](coverage-manifest.json), independently checked by [coverage-verification.json](evidence/coverage-verification.json). `npm run acceptance -- --milestone mN` and idempotent starter commands `npm run seed -- --segment m1|m2|m3` are implemented. Artifact hashes are in `run-record.json`. Exported web app: `artifacts/web/`; compiled token-only backend: `release/`. No simulator proof or signed native app is claimed.

The copied frozen choreography passed every required implemented check with zero required skips. The snapshot omitted its neighboring JSON-schema helper; `tools/lib/json-schema.mjs` supplies AJV validation without changing harness outcomes. The copied metering dependency was also included. Earlier failed and suite-placeholder attempts remain in evidence; green receipts above are the completed attempts. Original package-identity receipts hashed package metadata; final identity uses downloaded registry tarball hashes, and this correction is explicit in the log.

## Scale replay

**Pass against the combined invariant manifest.** Fresh instance on port 49362; start `1789523571`, end `1789523985`, raw wall **414 seconds**. Checkpoint verification consumed 25.018 seconds, leaving 388.982 execution seconds. All 167,243 starter-plus-scale actions settled through real auth/mutations, with media uploads; no privileged table writes. The 10% and 50% checkpoints and final state passed independent read-only checks. Replay effects were suppressed and schedules held. Its own clock overlaps M8 authoring, so its wall must not be added to the lane wall.

Final state: 1,008 profiles, 5,921 follows, 50,228 posts (48,224 originals and 2,004 replies), 5,008 active likes, 1,004 reposts, 1,002 conversations, 2,053 memberships, 100,015 messages (910 media), 2,736 quoted replies, and 2,000 reactions. Every manifest per-user/per-chat/group map matched, including the 900-follower celebrity, the 500-follow/100-conversation user, and the exact 50-person busy group with 10,000 messages. See [verification](evidence/scale-verification-final.json) and [settlement receipts](evidence/scale-replay.jsonl).

M8 aggregates/ranking were added to that store after replay completion and backfilled in a separate job; this work is outside the replay clock. Supplementary warm HTTP probes passed; their p95 values ranged from roughly 0.29 ms for one Insights query to 2.35 ms for busy-chat history. These are local warm-query observations, not hidden-grader scores, cold-sync measurements, or production latency promises.

## Additional proofs

- [Digest](evidence/digest-verification.json): real two-minute schedule, every user client closed, mid-period backend restart, exact three active-user payloads, no inactive-user payload, no quiet-next-period payload, private/tombstone exclusions.
- [Cold exported web](evidence/cold-web-verification.json): full browser-process restart offline, durable history, viewed ordinary media, search, pending messages, ordered nonduplicating flush, read receipts. This supplements rather than impersonates native simulator evidence.
- M5 frozen choreography waited for expiry with no clients open; the server inspection and reconnect/search checks passed. View-once repeats returned HTTP 410; deleted assets were revoked.
- [Custom client](evidence/custom-client-demo.json): authenticate/use token, list, page history, send, poll receipt with the documented message field manifest. Sample replay combines the frozen fixture syntax/schema validator with independent state conformance checks across all 13 action verbs.

## Pins and corrections

Resolved public packages: **snapback4 0.2.23**, **snapback4-expo 0.2.14**, and optional host binary **snapback4-darwin-arm64 0.2.23**. Expo 57.0.22. [Resolved tree](evidence/resolved-package-pins.json); [registry tarballs](evidence/package-artifacts/). The environment overlay said Node 24 was first on PATH; the observed default was 25.9.0. The harness and persistent servers used the explicit Node 24.18.0 path where recorded.

Logged correction/remediation entries: **19**; attribution counts `{"agent-error": 14, "ambiguous": 1, "environment": 4}`. No confirmed Snapback defect is asserted. These counts include explicit environment workarounds and authoring error fixes, not just failed end-to-end reruns. Full entries and evidence pointers are in `run-record.json` and `run-log.md`.

Notable agent corrections: hidden Router screens, missing cross-screen feed navigation, concurrent test writes, a lazy web device import, draft-clearing races, fixture filename and JSX errors, seed-ledger credential retention (replaced with SHA256 action keys), generated-config duration syntax, and identity artifact hashes. Environment corrections: read-only copied modes, the missing harness helper/dependency, and Metro restart after directory relocation. The scale host returned `E_GENERATION` after a local schema-adopting job; restarting the owned engine resolved it. That interaction is attributed ambiguous rather than declared a platform defect.

## Candid gaps and proof limits

- Native Hermes exports exist at every milestone, but native cold-start/media/queue behavior was not run in an iOS simulator. Expo Go without the installed native module is explicitly online-only.
- Public posts, source events, profiles, follows, and likes use broad synchronization. Full cold acquisition at the scale envelope is not measured here and can be expensive. The recipe has explicit finite author/follow/source/inbox/pull-slot caps; this is not an unlimited social network.
- The UI searches the acquired device index. The optional server-wide search merges up to 1,000 memberships and can return a meter cut (`N_WIDE_MERGE`); unscoped server search cannot promise completeness (`N_NEVER_COMPLETE`). The API documents both.
- Immediate ranking uses an online-only table; likes durably queue with a pending indicator but do not predict their count locally. Post creation also queues without prediction after the ranking dependency was added.
- Chat-list unread indication uses the authoritative ordinal minus the account read ordinal. It can count intervening own/tombstoned/expired ordinals until the conversation is opened; the tested cross-device clearing behavior passes, but this is not a separately maintained count of only live unread incoming messages.
- Digest activity aggregation is chunked. The closed-client, restart, authorization, inactive-period, and tombstone scenarios were verified; arbitrary concurrent churn during a very large multi-chunk digest was not exhaustively tested.
- No APNs/FCM transport, public deployment, TLS termination, backup/restore drill, native signing, hidden-grader run, or cross-backend rerun was performed. Production release and provider seam are build artifacts.
- The replay state checker is authored here; the frozen action syntax/schema validator also passed. No separate frozen adapter-state validator executable was supplied in the fixture surface. No instrument skip is invented for that distinction.
- Native Codex token accounting belongs to the outer harness. Local token totals and phase splits are null, never estimated. The snapshot lacked an enclosing git repository, so no commit or PR was produced.

## Hand-authored line counts

**1096 physical hand-owned source/test/config lines across 56 files**; 3835 copied shared-UI lines excluded. This includes blank/comment lines and counts full owned configuration files; generated types, bundles, fixtures, documentation, and unchanged scaffold are excluded. Dense one-line source makes LOC a poor complexity measure. The adapted published feed recipe counts only inserted/replaced lines against a fresh CLI generation; deletion work is not counted. See [line-counts.json](line-counts.json) for physical-versus-owned provenance.

| File | Hand-authored lines |
|---|---:|
| `app.json` | 30 |
| `app/_layout.tsx` | 6 |
| `app/chat-settings/[id].tsx` | 1 |
| `app/chats.tsx` | 1 |
| `app/conversation/[handle].tsx` | 1 |
| `app/conversation/group/[group]/index.tsx` | 1 |
| `app/conversation/group/[group]/settings.tsx` | 1 |
| `app/conversation/id/[id].tsx` | 1 |
| `app/index.tsx` | 9 |
| `app/insights.tsx` | 6 |
| `app/new-chat.tsx` | 1 |
| `app/post/[id].tsx` | 2 |
| `app/profile/[handle].tsx` | 4 |
| `app/search.tsx` | 2 |
| `app/settings.tsx` | 4 |
| `babel.config.js` | 0 |
| `choreo-adapter.json` | 1 |
| `index.js` | 0 |
| `metro-wasm-transformer.cjs` | 0 |
| `metro.config.js` | 0 |
| `package.json` | 53 |
| `scripts/acceptance-m1.mjs` | 22 |
| `scripts/acceptance-m2.mjs` | 24 |
| `scripts/acceptance-m3.mjs` | 12 |
| `scripts/acceptance-m4.mjs` | 11 |
| `scripts/acceptance-m5.mjs` | 12 |
| `scripts/acceptance-m6.mjs` | 9 |
| `scripts/acceptance-m8.mjs` | 12 |
| `scripts/acceptance.mjs` | 2 |
| `scripts/browser-smoke.mjs` | 2 |
| `scripts/choreo.mjs` | 6 |
| `scripts/configure.mjs` | 5 |
| `scripts/custom-client-demo.mjs` | 3 |
| `scripts/finalize.py` | 52 |
| `scripts/push-worker.mjs` | 4 |
| `scripts/replay.mjs` | 35 |
| `scripts/scale-probes.mjs` | 3 |
| `scripts/seed.mjs` | 31 |
| `scripts/serve-web.mjs` | 3 |
| `scripts/verify-cold-web.mjs` | 3 |
| `scripts/verify-digest.mjs` | 5 |
| `scripts/verify-replay.mjs` | 8 |
| `scripts/verify-sample.mjs` | 9 |
| `setup-identity.json` | 49 |
| `snapback/chat.q` | 259 |
| `snapback/config.q` | 0 |
| `snapback/digest.q` | 36 |
| `snapback/feed.q` | 3 |
| `snapback/insights.q` | 50 |
| `snapback/schema.q` | 140 |
| `src/Video.tsx` | 3 |
| `src/Video.web.tsx` | 2 |
| `src/chats.tsx` | 41 |
| `src/client.ts` | 20 |
| `src/device.ts` | 2 |
| `src/device.web.ts` | 2 |
| `src/following.ts` | 0 |
| `src/posts.tsx` | 31 |
| `src/profile.tsx` | 21 |
| `src/session.tsx` | 18 |
| `tools/lib/json-schema.mjs` | 4 |
| `tsconfig.json` | 18 |

## Cleanup and records

All owned live backend, Metro, static-web, and worker PIDs were terminated individually; no pattern kills were used. [Cleanup receipt](evidence/process-cleanup.json). All work and artifacts are inside this lane. The comparison [essay](essay.md) was written before this tally; [diary](diary.md), [run log](run-log.md), and [machine-readable record](run-record.json) retain the audit trail.

end=1789524796
