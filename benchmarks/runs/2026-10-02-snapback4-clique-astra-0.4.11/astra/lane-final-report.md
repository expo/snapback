# Clique final report

Lane astra-clique-snapback4-full-20260913. Model gpt-6-astra, effort medium. Public npm pins snapback4@0.4.11 and snapback4-expo@0.4.11, verified by evidence/resolved-pins.json and package-lock.json.

Raw run start=1790960962; end=1790972805; session wall=11843s. The milestone and scale clocks overlap as recorded; do not add them to infer session wall. Initial orientation before the first explicit M1 boundary is 44s and remains inside the session clock. Essay was written before this tally.

| Milestone | Status | Start epoch | First green logged epoch | Logged first-green wall (s) | Final verified epoch | Suite tests / assertions | Choreo required / passed |
|---|---|---:|---:|---:|---:|---:|---:|
| M1 | green | 1790961006 | 1790961706 | 700 | 1790961706 | 5 / 7 | 3 / 3 |
| M2 | green | 1790961706 | 1790962307 | 601 | 1790962307 | 7 / 22 | 9 / 9 |
| M3 | green | 1790962307 | 1790963033 | 726 | 1790972733 | 5 / 7 | 5 / 7 |
| M4 | green | 1790963033 | 1790963896 | 863 | 1790963896 | 3 / 5 | 5 / 5 |
| M5 | green | 1790963896 | 1790964851 | 955 | 1790964851 | 4 / 6 | 2 / 4 |
| M6 | green | 1790964851 | 1790965644 | 793 | 1790972733 | 3 / 5 | 1 / 1 |
| M8 | green | 1790965703 | 1790966718 | 1015 | 1790972733 | 3 / 6 | 5 / 5 |
| M7 | not-run (explicit separate-session scope) | — | — | — | — | — | — |

Boundaries in the table are raw run-log events. The actual final suite/choreography/native evidence timestamp is also retained per milestone in run-record.json as finalEvidenceEpoch. M8 functional first green preceded a final suite rerun; its final verified boundary refreshes the frozen choreography suite hash linkage. Every retained final suite hash matches its choreography receipt. Coverage: coverage-manifest.json. Per-milestone JSONL receipts and bounded retry logs are in evidence/. No required implemented choreography check is skipped. M6/M8 simulator supplements say exactly “not-recorded”; their reason is “M6/M8 simulator evidence is recorded separately from web green.” They are not required for green under ENVIRONMENT.md. Browser restart/queue and cold-media/search proofs are separate artifacts, not simulator evidence.

An earlier diagnostic replay ran from 1790965401 to 1790967783 and was deliberately interrupted after its 50% checkpoint because it overlapped M8 adoption and had imported an earlier probe module. Its failed pending-write result followed the recorded server stop, not a platform refusal. Raw receipts, clocks, verification, and store are preserved under evidence/diagnostic-scale-attempt1 and diagnostic-scale-instance1. The following replay began on the fresh full-app store. Its final query checkpoint exposed a raw unread scan exceeding the shape meter; the published row-keyed unread count fixed it. All actions had settled, no fixture action was omitted or replayed, and full invariants were re-verified after schema adoption. The correction time is included in the reported clock. Original failure and source hashes are preserved in evidence/scale-result-before-unread-fix.json and evidence/scale-source-before-unread-fix.json. This is not a frozen-generation performance growth curve.

Scale replay: start=1790967870, end=1790972220; pass=true; settled actions=167243 (includes starter actions); wall excluding checkpoint work=4333.096s; excluded checkpoint time=16.904s. Fresh store: scale-instance/.snapback4/store.sqlite, port 49363, --replay. Scale web: dist-scale at port 49362. Initial source hashes: evidence/scale-frozen-source.json; corrected source hashes: evidence/scale-source-final.json. The fixture leaves its calibrated cap unspecified; a conservative 14,400s safety cap was recorded, not an official O5 calibration. See evidence/scale-result.json, scale-settle-receipts.jsonl, and scale-10pct/50pct/final-verification.json. Independent SQL counts and grouped counts cover the invariant manifest; named O5 fixtures and busy-chat full paging are checked through public client queries. Diagnostic checkpoint query timings are not the secret rotated grader probe set.

Recorded correction-loop attribution: {"agent-error":25}. These are logged author correction events, not a claim of harness-derived semantic-action or ratchet accounting. Full summaries and evidence pointers are in run-record.json and run-log.md. No confirmed snapback4 platform capability gap was established by the milestone work.

| Native artifact | Bytes | SHA-256 |
|---|---:|---|
| artifacts/m1-ios/_expo/static/js/ios/entry-4aa4e091d84e1ef0c44873fe75f522c4.hbc | 3554704 | b7f149de063460639a2c42d93436aaba06de41f3f69d9c7c80eef8bc267cebe3 |
| artifacts/m1-ios/_expo/static/js/ios/web-worker-entry-7b23b1ea120123c9025b5d187c1a052b.hbc | 211212 | 597916ef47f5d0d151f2ba2008dc8e825a7f983efd6588cd3e5db8409965aa7b |
| artifacts/m2-ios/_expo/static/js/ios/entry-eb164137c5e3d97906e9f55ef66bfe50.hbc | 3587736 | 83b668adef1c90c639f2bd3d2403484b796898d54d4a92bcdba21f6caf0e6121 |
| artifacts/m2-ios/_expo/static/js/ios/web-worker-entry-a337ee3a32aa562089b7541895f89822.hbc | 211212 | 51b7596c899fc509d0240e6b4759b8f6d75029db9aa387b018ed41c00498c0b3 |
| artifacts/m3-ios/_expo/static/js/ios/entry-2de564eb18822ff5410b3239af8d7884.hbc | 3631655 | 665e094d2be85b851389ca04f9911ffa314211c964c705a68e9e5b154b91e7b9 |
| artifacts/m3-ios/_expo/static/js/ios/web-worker-entry-e89187055edda6981bb8995ac93e3d34.hbc | 211211 | b2eb1426d7231b53c1cced29dfff1a6c464c9e6848f3ea016c9b3fba8d6914c4 |
| artifacts/m4-ios/_expo/static/js/ios/entry-9abbe2a555e7aef20b12b1a6fa81bf95.hbc | 3642049 | b35511ea1c567641b10e209b5560e20e48f5d69bd5b74c76b90b2e873672c1df |
| artifacts/m4-ios/_expo/static/js/ios/web-worker-entry-9bda2b91aa14816905507aa8daff3fab.hbc | 211213 | f753e87b47e26c80b482e5de0ada769906ee9c6bea15f8e75f72cf6e35c88d12 |
| artifacts/m5-ios/_expo/static/js/ios/entry-dbff7403737e0eb02ee04c590a29e3f1.hbc | 3656860 | 037f01531f99fd01a4afdccd7e913b3e7c72233244caba54df896ad7a6e24c1f |
| artifacts/m5-ios/_expo/static/js/ios/web-worker-entry-641e09aa74f81bc3989a689f2aa6f4a8.hbc | 211212 | 3b84fbe9bfbbb823799a01880469a304073985cb9b9496c5b4b26dce1c4ea220 |
| artifacts/m6-ios/_expo/static/js/ios/entry-09ff9dcd11ca70a0153617f3334a970c.hbc | 3657476 | 10fa973e8f1143748e50a05d23e1019264f1702863a3a6683fd51b9226818271 |
| artifacts/m6-ios/_expo/static/js/ios/web-worker-entry-641e09aa74f81bc3989a689f2aa6f4a8.hbc | 211212 | cfba41b60c2a180359485911f1035f06db2766d322b332414fdd53bac16557b4 |
| artifacts/m8-ios/_expo/static/js/ios/entry-d155857a781d2a80d384e48bbea9f680.hbc | 3671963 | 6398a17d3ce4d96bef5148802ec8dae2e6fad4fd1086c75676f3461335a98888 |
| artifacts/m8-ios/_expo/static/js/ios/web-worker-entry-3f3af306e97db92dcba07577f2aaeadd.hbc | 211212 | 2bfd8870722d92115b323d89703a4a5bd37dc3473b036a3abe45580953eb2d1b |

Additional proofs: evidence/m4-window-proof.txt (real elapsed edit/delete refusal), evidence/m5-expiry-proof.txt (closed recipients, message/asset/search purge), evidence/m6-conformance.json and m6-sample-receipts.jsonl (all 50 actions), evidence/m6-api-demo.log, evidence/m6-offline-proof.log and evidence/m8-durable-restart-proof.log (pending survives reload, ordered flush reaches read), evidence/offline-media-search-proof.log, evidence/digest-proof.json (scheduled exact counts, no-activity next period, isolated restart recorded in run-log), and evidence/auth-revocation-proof.json. Final UI captures are evidence/final-home.png and final-insights.png. Full-corpus browser checks and captures are evidence/scale-web-proof.json, scale-insights.png and scale-trending.png; final server inspection is evidence/scale-doctor-final.json. The post-correction durable queue proof is evidence/post-scale-offline-proof.log.

Hand-authored source/test lines below use a fresh published init scaffold as the baseline. New files count physical lines; modified scaffold files count added/replacement lines. Dense formatting makes this a ceremony measure, not a complexity score. Copied UI/choreography/fixtures, generated files and artifacts, lockfiles, prose, and the guide-derived once-media hook are excluded. Full physical counts and origins are in evidence/hand-authored-loc.json.

| File | Hand-authored lines |
|---|---:|
| app/_layout.tsx | 5 |
| app/chat/[id]/index.tsx | 1 |
| app/chat/[id]/settings.tsx | 1 |
| app/chats.tsx | 1 |
| app/conversation/[handle].tsx | 1 |
| app/conversation/group/[group]/index.tsx | 1 |
| app/conversation/group/[group]/settings.tsx | 1 |
| app/index.tsx | 2 |
| app/insights.tsx | 1 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 4 |
| app/profile/[handle].tsx | 3 |
| app/search.tsx | 1 |
| app/settings.tsx | 2 |
| src/Video.tsx | 5 |
| src/chat.tsx | 46 |
| src/client.ts | 2 |
| src/insights.tsx | 11 |
| src/screens.tsx | 29 |
| src/search.tsx | 2 |
| src/social.tsx | 34 |
| scripts/acceptance.mjs | 20 |
| scripts/auth-revocation-proof.mjs | 1 |
| scripts/capture-ui.mjs | 1 |
| scripts/choreo.mjs | 8 |
| scripts/configure.mjs | 6 |
| scripts/custom-client-demo.mjs | 4 |
| scripts/custom-client.mjs | 10 |
| scripts/debug-history.mjs | 1 |
| scripts/debug-live.mjs | 6 |
| scripts/debug-m8.mjs | 1 |
| scripts/debug-reaction.mjs | 2 |
| scripts/debug-reactions-live.mjs | 2 |
| scripts/digest-proof.mjs | 5 |
| scripts/dual-offline-debug.mjs | 1 |
| scripts/expiry-proof.mjs | 2 |
| scripts/finalize-report.mjs | 10 |
| scripts/inspect-receipts.mjs | 1 |
| scripts/log.mjs | 2 |
| scripts/offline-media-search-proof.mjs | 2 |
| scripts/offline-proof.mjs | 2 |
| scripts/replay-adapter.mjs | 33 |
| scripts/scale-replay.mjs | 3 |
| scripts/scale-reverify.mjs | 3 |
| scripts/scale-verify.mjs | 15 |
| scripts/scale-web-debug.mjs | 1 |
| scripts/scale-web-proof.mjs | 2 |
| scripts/seed.mjs | 23 |
| scripts/serve.mjs | 5 |
| scripts/stop-servers.mjs | 3 |
| scripts/test-helpers.mjs | 7 |
| scripts/test-m2.mjs | 26 |
| scripts/test-m3.mjs | 7 |
| scripts/test-m4.mjs | 6 |
| scripts/test-m5.mjs | 6 |
| scripts/test-m6.mjs | 6 |
| scripts/test-m8.mjs | 7 |
| scripts/trending-proof.mjs | 2 |
| scripts/window-proof.mjs | 2 |
| snapback/schema.q | 382 |
| snapback/workers/push.mjs | 10 |
| package.json | 21 |
| app.json | 12 |

Total: 823 lines across 63 files.

Candid limits and gaps:

- This is a local production-shaped app, not a deployed production service. TLS, operational backups, hosted deployment and APNs/FCM delivery were outside this local proof. The push seam is a durable log provider.
- Native Hermes bundles were exported for every milestone; simulator execution is not claimed. Durable restart, offline media/search and ordering have browser evidence.
- The public fixture validator validates log grammar; the builder additionally checked sample final semantics through the app API. Independent hidden grader sampling and rotated performance/trust probes remain external, and no O/B score or cross-backend performance ranking is claimed.
- The base run-record schema validates. A composed grader/efficiency record cannot honestly be completed without external driver-stamped metering/orientation custody and grading results. Token counts, phase token splits and tool counts remain null for the harness-native join.
- Exact root milestone boundaries and recorded corrections are preserved, but a transcript-derived phase split is unavailable. No prior implementation or source checkout was used. An accidental empty file outside the lane (/tmp/nope) was immediately removed and logged.
- Historical choreography setup metadata hard-coded npm 11.13.0; the actual invoked npm was 11.16.0. Original receipts and setup bytes are preserved, with evidence/setup-identity-erratum.json recording the correction. Future runs derive npm dynamically and retain versioned setup artifacts.
- M7 was deliberately not attempted. Stores and source remain available for the separate session; acceptance residue is separate from the scale store.

Server shutdowns are recorded in run-log.md; only recorded lane-owned PIDs were targeted.

end=1790972805
