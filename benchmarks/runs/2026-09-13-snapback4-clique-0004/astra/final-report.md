# Clique — Snapback 4 cold build

Lane astra-clique-snapback4-full-20260913; gpt-6-astra, medium effort.

M1, M2, M3, M4, M5, M6 and M8 are green under ENVIRONMENT.md: every final suite and required choreography check passes. M7 was not run, as instructed. All seven milestones produced iOS Hermes exports; no simulator execution is claimed. Replay invariants pass. The strict Insights and Trending midpoint performance checks fail; the earlier cold-start timeout is retained.

Start=1789324245; end=1789333808; total wall=9563 seconds. Published package pins resolve to snapback4@0.2.6 and snapback4-expo@0.2.1. No Snapback source repository or other lane was inspected. Backend authoring is Quarry; the small push consumer is the external effect seam.

## Milestone clocks and final evidence

| Milestone | Start epoch | Finalization epoch | Wall seconds | First green epoch (ISO receipt) | Seconds to first green | Status | Suite / choreography |
|---|---:|---:|---:|---|---:|---|---|
| M1 | 1789324245 | 1789324717 | 472 | 1789324717 (2026-09-13T18:38:37.544Z) | 472 | green | 7/7; 3/3 (3 required) |
| M2 | 1789324743 | 1789325395 | 652 | 1789325395 (2026-09-13T18:49:55.313Z) | 652 | green | 22/22; 9/9 (9 required) |
| M3 | 1789325437 | 1789326291 | 854 | 1789326291 (2026-09-13T19:04:51.598Z) | 854 | green | 7/7; 7/7 (5 required) |
| M4 | 1789326349 | 1789326687 | 338 | 1789326687 (2026-09-13T19:11:27.771Z) | 338 | green | 6/6; 5/5 (5 required) |
| M5 | 1789326737 | 1789327692 | 955 | 1789327325 (2026-09-13T19:22:05.700Z) | 588 | green | 7/7; 4/4 (2 required) |
| M6 | 1789327705 | 1789328614 | 909 | 1789328488 (2026-09-13T19:41:28.738Z) | 783 | green | 5/5; 1/1 (1 required) |
| M8 | 1789328651 | 1789333719 | 5068 | 1789329455 (2026-09-13T19:57:35.379Z) | 804 | green | 6/6; 5/5 (5 required) |
| M7 | — | — | — | — | — | not-run | Separate fresh session requested |

First-green times are the earliest retained green segment-summary timestamps. Finalization includes subsequent verification/hardening; M8 finalization overlaps the separate scale clock. The original M5 first-green summary survives but its referenced suite bytes were overwritten before archival. Its final passing suite is hash-bound and retained. Every other first-green suite was located by its recorded SHA-256. All final suite hashes match their choreography summaries. See [milestones.json](milestones.json), [run-log.md](run-log.md), and evidence/suite-mN.json, evidence/coverage-mN.json, evidence/choreo-mN.jsonl.

## Scale replay

Fresh instance on 49303, starter segments applied before the scale clock; application auth, mutations and real media uploads used throughout. Fixture timestamps never backdated writes.

- Bootstrap start: 1789329847; replay start: 1789329848; end: 1789333417.
- Raw wall: 3569s; excluded probe wall: 87.819s; replay wall: 3481.181s; own cap: 14400s.
- Replay status: **passed**; settled scale actions: 167157.
- Invariant verification: all local per-user/per-chat/group/named fixture invariants passed; hidden grader sample remains external. Full entity-count verification: true.
- Initial 50% browser startup timed out; the failed clock and receipt are retained. The replay resumed on the same store and original clock after removing unnecessary original-post counters from the replicated repost aggregate.
- Performance degradation checks: false; hidden grader probes and absolute calibrated ceilings are not claimed. The implementation changed after the 10% checkpoint, so these measurements are diagnostic and do not certify a uniform-code O5 score.

Evidence: [clock](evidence/scale-clock.json), scale-settle.jsonl, scale-verify-10pct.json, scale-verify-50pct.json, scale-verify-final.json, [entity totals](evidence/scale-entity-totals.json), and [performance](evidence/scale-performance-summary.json). Mutation probes use a consistent isolated copy of the verified corpus, preserving the invariant instance. Authentication admission was allowed to throttle real registrations; it was not bypassed.

## Corrections and limitations

Explicit correction-loop records: {"snapback-defect":2,"agent-error":23,"environment":0,"ambiguous":0}. These are counts of explicitly logged correction loops, not an inferred count of every failed tool call. Full timestamped details and evidence pointers are in [correction-loops.json](evidence/correction-loops.json). Taxonomy maps run-log snapback4-defect to the protocol's snapback-defect. Recorded errors, retries, lookups and workarounds remain in the raw log. The original auth backoff helper did not log each automatic retry; its aggregate throttling episode is recorded, and subsequent helper invocations now log retry diagnostics.

- The frozen choreography snapshot omitted lib/json-schema.mjs. A loader supplies AJV validation of the frozen schema; browser assertions are unchanged. No required browser check was relabeled or silently skipped.
- The host's default Node was 25.9.0 despite the environment's Node 24 expectation. Choreography explicitly used the installed Node 24.18.0 binary; application/Expo/replay commands used the observed default.
- Local decorated message queries do not preserve pending metadata as needed by the UI. A raw-row query carries durable queued writes alongside decorated history. Upload mutations pass the full published asset metadata so the replica can predict them.
- A public repost maintain initially replicated an unnecessary counter for every original post. A dedicated repost-edge source removed that growth; its derived data was backfilled through a server job. The attempted read-filter shortcut produced E_SYNC and was replaced.
- Policy-filtered Following queries retain compiler N_NEVER_COMPLETE diagnostics. A constant-work pending lane and resumable reader materialization avoid synchronous celebrity fan-out; scale measurements, not the small milestone fixtures, determine the performance result.
- Ordinary media uses a persisted authorized cache plus online revocation validation. Once-photo bytes are never added to that cache. An offline device cannot learn a new remote revocation until it reconnects.
- A provider delivery service is not configured. The transactional push/digest outbox and idempotent worker receipt seam are implemented and tested.
- Native evidence is Hermes bundle export only, as requested; runtime behavior was exercised on web, not a simulator/device.
- Native token counters, driver terminal/first-edit custody, exact compaction timestamps and independent grading are unavailable inside the permitted lane. [run-record.pending.json](run-record.pending.json) preserves known values and explicit nulls; [schema diagnostics](evidence/run-record-validation.json) lists the missing driver/grader fields. It is not a schema-valid scored record. No token usage, dollar cost or comparative benchmark score was estimated.
- M5 earliest suite custody gap described above; later verification passes.

The supplementary proofs cover closed-client timed edit/delete refusal and expiry, protected asset revocation, cold offline media/search, queued writes across browser restart, reactions and multi-device edits, all-image gallery rendering, member search, a restarted scheduled digest, and synthetic isolated Trending aging. Exact methods and limitations are in their evidence JSON files.

## Native artifacts

| Milestone | Artifact | Bytes | SHA-256 |
|---|---|---:|---|
| M1 | [Hermes bundle](artifacts/m1-ios/_expo/static/js/ios/entry-437356f8040b50dc729edeb4ba79b81b.hbc) | 2587886 | dc2e1eebddf336ac47ab1157b829c7613c53cf0d9ed0d1041cd0e1f4ea4ebdd3 |
| M2 | [Hermes bundle](artifacts/m2-ios/_expo/static/js/ios/entry-c159edece9adcc1c3f54e4b2e29c5176.hbc) | 2677756 | 0b6a6b172d50d00977fd3b97accdaf8f552eeca3e184330a4e3595e3bdd1e6b5 |
| M3 | [Hermes bundle](artifacts/m3-ios/_expo/static/js/ios/entry-ba7974d98088827fa08dab52e999734a.hbc) | 2703367 | cbe998f89520aaf17a9525ffac1480c148e53204aa5e1b00f0c0162373cdb903 |
| M4 | [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-e54ec434a18a6ee67e0cf8b6010d6829.hbc) | 2710985 | a29956ae217d9549b504b2cae9ecab68e5c534c0ef172fb8e3a83a0d4a5d5a90 |
| M5 | [Hermes bundle](artifacts/m5-ios/_expo/static/js/ios/entry-e67fd219c6a7b9276be80b9ca58bad2d.hbc) | 2718787 | 5ca35b59752d0e3b69828adfdb100e530a50a2f26ce3a91e5da2dfc3fd45557e |
| M6 | [Hermes bundle](artifacts/m6-ios/_expo/static/js/ios/entry-710a0655d0e499d4655a92a5685a0ed4.hbc) | 2780146 | c0a9836cd7bcd7c308b69d991239185e0c4c4004bf5f38c7e536566ba80a2135 |
| M8 | [Hermes bundle](artifacts/m8-ios/_expo/static/js/ios/entry-565881964ec53d3696b484f2110196d4.hbc) | 2789855 | a2c3e4fe5f1659a42c00a55bc4873879732263073a9473786765a63148267cb6 |

## Hand-authored source/test/config lines

Physical lines; generated files, dependencies, copied UI/harness, fixture/instance copies, lockfiles, evidence and exports excluded. Formatting is included. Total: 6757 lines in 93 files.

| File | Lines |
|---|---:|
| .gitignore | 7 |
| app.json | 1 |
| app/_layout.tsx | 37 |
| app/chats.tsx | 10 |
| app/conversation/[handle].tsx | 12 |
| app/conversation/group/[group]/index.tsx | 12 |
| app/conversation/group/[group]/settings.tsx | 12 |
| app/index.tsx | 74 |
| app/insights.tsx | 61 |
| app/new-chat.tsx | 101 |
| app/post/[id].tsx | 30 |
| app/profile/[handle].tsx | 84 |
| app/profile/edit.tsx | 71 |
| app/search.tsx | 111 |
| app/settings.tsx | 22 |
| lib/asset-cache.ts | 41 |
| lib/asset-cache.web.ts | 36 |
| lib/cached-media.tsx | 147 |
| lib/chat.tsx | 712 |
| lib/device.ts | 14 |
| lib/device.web.ts | 50 |
| lib/focused.tsx | 12 |
| lib/media.tsx | 44 |
| lib/media.web.tsx | 70 |
| lib/posts.tsx | 267 |
| lib/server-read.ts | 40 |
| lib/state.tsx | 160 |
| package.json | 40 |
| scripts/acceptance-m1.mjs | 148 |
| scripts/acceptance-m2.mjs | 277 |
| scripts/acceptance-m3.mjs | 195 |
| scripts/acceptance-m4.mjs | 164 |
| scripts/acceptance-m5.mjs | 187 |
| scripts/acceptance-m6.mjs | 144 |
| scripts/acceptance-m8.mjs | 191 |
| scripts/acceptance.mjs | 2 |
| scripts/auth-retry.patch.py | 2 |
| scripts/choreo.mjs | 81 |
| scripts/cleanup-servers.mjs | 20 |
| scripts/configure.mjs | 22 |
| scripts/custom-client-demo.mjs | 83 |
| scripts/diagnose-feed-scroll.mjs | 3 |
| scripts/diagnose-scale-startup.mjs | 10 |
| scripts/finalize-report.mjs | 48 |
| scripts/inspect-scale-sync.mjs | 5 |
| scripts/instrument-loader.mjs | 11 |
| scripts/instrument-schema.mjs | 10 |
| scripts/log.mjs | 4 |
| scripts/m4-ui.patch.py | 24 |
| scripts/m5-ui.patch.py | 26 |
| scripts/preserve-receipts.mjs | 13 |
| scripts/probe-cold-media.mjs | 87 |
| scripts/probe-digest.mjs | 173 |
| scripts/probe-gallery.mjs | 24 |
| scripts/probe-member-search.mjs | 1 |
| scripts/probe-multidevice.mjs | 96 |
| scripts/probe-offline-interactions.mjs | 74 |
| scripts/probe-offline.mjs | 25 |
| scripts/probe-receipts-reload.mjs | 53 |
| scripts/probe-receipts.mjs | 44 |
| scripts/probe-scale-group.mjs | 32 |
| scripts/probe-scale-writes.mjs | 85 |
| scripts/probe-signins.mjs | 22 |
| scripts/probe-thread.mjs | 23 |
| scripts/probe-trending-aging.mjs | 82 |
| scripts/probe-ui.mjs | 18 |
| scripts/probe-video.mjs | 27 |
| scripts/probe-windows.mjs | 95 |
| scripts/push-worker.mjs | 30 |
| scripts/record-boundary.mjs | 35 |
| scripts/replay.mjs | 238 |
| scripts/resume-scale.mjs | 19 |
| scripts/run-scale.mjs | 75 |
| scripts/scale-browser-probes.mjs | 57 |
| scripts/scale-performance-summary.mjs | 16 |
| scripts/scale-verify.mjs | 183 |
| scripts/seed-session.patch.py | 5 |
| scripts/seed.mjs | 162 |
| scripts/server.mjs | 23 |
| scripts/start-isolated.mjs | 46 |
| scripts/verify-sample.mjs | 122 |
| scripts/verify-scale-settlements.mjs | 7 |
| scripts/verify-scale-totals.mjs | 31 |
| scripts/wire.mjs | 56 |
| snapback/chat.q | 298 |
| snapback/custom.q | 13 |
| snapback/digest.q | 28 |
| snapback/insights.q | 50 |
| snapback/runtime.q | 2 |
| snapback/schema.q | 296 |
| snapback/search.q | 8 |
| snapback/timeline.q | 47 |
| tsconfig.json | 1 |

Documentation, reported separately: README.md: 19 lines; API.md: 38 lines; diary.md: 78 lines; essay.md: 31 lines.

See [essay.md](essay.md) for the experience comparison, written after M8 and before the final tally. Server lifecycle receipts are retained in evidence/server-pids.jsonl and evidence/server-cleanup.json.

end=1789333808
