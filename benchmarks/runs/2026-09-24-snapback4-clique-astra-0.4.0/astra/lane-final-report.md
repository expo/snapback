# Clique — final lane report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort medium. Cold, alone build confined to this lane; no sibling lanes, previous implementations, or Snapback source checkouts inspected. Public pins: snapback4 **0.4.0**, snapback4-expo **0.4.0**. Nothing struck from scope. M7 reserved for a separate fresh session.

start=1790251097
report-generated=1790257816.469

## Milestones

Green means the frozen suite coverage and every required implemented choreography check passed. First-green timestamps below come directly from hash-bound segment summaries, rather than later prose log entries. M1 starts at delivery so orientation is included. Gaps between a milestone's first green and the next logged start are retained in total wall, not hidden inside another milestone.

|Milestone|Status|Start epoch|First-green/end epoch|Wall seconds|Suite tests/assertions|Choreography passed/total|
|---|---|---:|---:|---:|---:|---:|
|M1|green|1790251097|1790251511.627|414.627|5/7|3/3|
|M2|green|1790251537|1790251996.763|459.763|6/22|9/9|
|M3|green|1790252066|1790252435.074|369.074|4/7|7/7|
|M4|green|1790252486|1790252602.109|116.109|4/5|5/5|
|M5|green|1790252659|1790253091.368|432.368|3/6|4/4|
|M6|green|1790253151|1790253438.144|287.144|3/5|1/1|
|M8|green|1790253519|1790254353.865|834.865|2/6|5/5|
|M7|not-run|—|—|—|—|—|

Delivery to M8 first green: 3256.865 seconds. Post-green tuning and a fresh app store were followed by ordered M1–M6–M8 regression suites and choreography; historical first-green times remain unchanged. Final build also passed the later M8 choreography rerun recorded in authoring-evidence.json. No capability failure, abort, blocked milestone, instrument skip, or four-hour cap exhaustion occurred. Native simulator assertions are separate, not claimed; the prompt requires Hermes artifacts. Later regression and tuning work is substantial and is not represented by the historical first-green wall; latest acceptance epochs and final session end are retained separately.

Coverage: coverage-manifest.json and evidence/mN-coverage.json. Suites: evidence/mN-suite.json. Exact first/latest choreography filenames, SHA-256 hashes, and suite custody: authoring-evidence.json. Frozen failed attempts remain retained; only structured diagnostics and segment summaries were used for diagnosis/reporting.

## Native artifacts

- M1: artifacts/m1-ios/_expo/static/js/ios/entry-94db699702159a9f8c9a06bb111c2408.hbc (2833393 bytes, sha256:bf883495f4c97b8b9d0b8552e1b42a5c3835446c3b53b37fbe532e5841b25e0a).
- M2: artifacts/m2-ios/_expo/static/js/ios/entry-010b69d2eccb803c109fc216eb6d8e6f.hbc (2845655 bytes, sha256:e8a576cfc5d11c64056f730b8cf1d0f9e63da15a0cc7ae1dc433bbe3391ff4b4).
- M3: artifacts/m3-ios/_expo/static/js/ios/entry-b7c57a9c1f76bede29fc2604c04bbf85.hbc (2865079 bytes, sha256:4ae93773187eb096ffa34dcecd29f476e4595fcc26438d33f5f6b2530c44eb96).
- M4: artifacts/m4-ios/_expo/static/js/ios/entry-07902b48ef2873a0904685bde797b870.hbc (2881593 bytes, sha256:1b476c1885e86202b26570d168ded681b8026fe87ec4e83bb4926bc22b94c5d8).
- M5: artifacts/m5-ios/_expo/static/js/ios/entry-5b8620a242ab05c8735f25c70eaa09f0.hbc (2889898 bytes, sha256:2da18eb40fb43e39cac7a718f80c1fc21c29ae47a7a2cd2f4d88bb419debdad4).
- M6: artifacts/m6-ios/_expo/static/js/ios/entry-a960651f7b9ad04282067a6030529922.hbc (2842137 bytes, sha256:8950220105bfc1ff04cfb6187d919d7eec4c8924ce7d0000dda109111f0d4ca3).
- M8: artifacts/m8-ios/_expo/static/js/ios/entry-f750c4fc932e609d48aca0e6454428b1.hbc (2851037 bytes, sha256:a7cf57c0bbed88bc19210ee3084f5ed513f7387cac38c1c78a2ee3908c4ed44c).

Historical exports are snapshots produced during each milestone. The final M8 export contains the completed client, native picker URI handling and pull-to-refresh. Hermes export success is not a simulator/device runtime claim.

## Independent scale replay

Fresh backend on 49362, all three starter segments followed by the hash-pinned scale log, through the authenticated write/upload paths. Fixture timestamps were never supplied to writes. Replay mode suppressed new effects and held schedules. Intent and settlement journal: evidence/scale-replay.jsonl.

- start=1790255441.21
- end=1790256323.697
- wall=882.487 seconds
- checkpoint probe wall=8.261 seconds
- replay excluding checkpoint probes=874.226 seconds
- settled actions=167243, including 86 starter actions
- verification=PASS at both checkpoints and final; final verifier end=1790257063.39

Final exact counts include 1008 users/profiles, 50228 posts, 100015 messages, 910 media messages, 1002 conversations, and 2053 memberships. The verifier checks every manifest per-user following/conversation count, per-chat message count, per-group membership count, named fixture lists, named content/reactions/quotes and complete busy-group paging. Final named avatars/post/message assets are compared byte-for-byte by SHA-256. Users are also evidenced by the authenticated registration settlement ledger and one owned profile per registered principal.

Checkpoint JSON and final count proof: evidence/scale-replay-verify-{10pct,50pct,final}.json. The initial full replay also passed invariants, but exposed unread-meter and celebrity-write failures. It is preserved under scale-initial-instance and evidence/scale-initial. After changing the representation, the entire fresh replay ran again; the clock above is this second replay, not a replacement for the retained first-attempt clock. Mutating performance probes ran against a separate copied store on 49364; the original verified scale store remains intact. Cold replica acquisition: 12582.320 ms, 100 conversations, device RSS 50176 KiB.

Read diagnostic p95 ratios: deep page50/page1=0.895, Following500/5=1.499. Celebrity write/ordinary5-follower write=2.608, celebrity-follower read/5-follow reader=0.942. Growth endpoint and midpoint results are retained in evidence/scale-growth.json. The strict Trending midpoint test missed: 50% p95 1.770334 ms versus interpolated ceiling 1.759148 ms. Its endpoint ratio passed, but this run does not claim a full O5 pass; no variance explanation or favorable-sample rerun is substituted. No unpublished absolute threshold or independent O5 score is asserted.

## Supplemental behavior proofs

- evidence/m5-no-client-expiry.json: server expiry and asset refusal with probe clients closed through the deadline.
- evidence/digest-proof.json and evidence/digest-restart.json: actual shortened schedule, exact authorized counts, tombstone/private-chat exclusion, no-client execution, quiet-period suppression, repeated jobs and backend restart without duplicate emission.
- evidence/offline-restart-proof.json: two queued web messages retained across an offline reload and settled exactly once after reconnect.
- evidence/sample-conformance.json: all 13 fixture verbs, actual sample readback; custom-client-demo.json: documented external API history/send path.
- evidence/final-typecheck.log: TypeScript passes; evidence/final-web.log and evidence/m8-ios-final.log: final exports.

## Corrections and attribution

1. **agent-error** — Post-green scale inbox read exceeded the 8192-row meter; replaced message scanning with maintained ordinary receipt counts plus a separate expiring-receipt source, tombstone visibility, and matching message deadlines. The first expiry retest caught stale receipt counts; copying the deadline fixed it. Repeated cold acquisition and ordered regressions. Evidence: evidence/probe-backend.log; evidence/scale-inbox-why.txt; evidence/scale-inbox-why-2.txt.
2. **ambiguous** — The published materialized Following plan failed the celebrity acknowledgement ratio. A compiled read-time alternative required fresh stores after E_TIMELINE_REDEFINE. Its wide-row scan hit the heap meter at 50%; a compact public feedEvents table, bounded backfill, and adaptive indexed merge/scan plan addressed the full-envelope read meters. Preserved initial artifacts, resumed the authenticated journal, and repeated regressions. Initial numeric results remain retained. Evidence: evidence/scale-extra-probes-initial.json; evidence/probe-backend-tuned.log; evidence/scale-initial/.
3. **environment** — Copied frozen harness retained read-only modes; made lane copies writable for npm installation. Evidence: evidence/choreo-install.log.
4. **agent-error** — Feed tabs were unavailable after profile navigation; moved them to the shell. One loop, plus adapter fixture path correction. Evidence: evidence/m2-choreo.log.
5. **agent-error** — Concurrent suite and choreography writes displaced the first live feed post; isolated mutating verification runs. Evidence: evidence/m2-choreo.log.
6. **ambiguous** — Paging encountered incomplete null snapshots during navigation in M3 and M8. Explicit subscriptions and provisional-page retention fixed the UI. Root package-versus-adapter attribution remains unresolved; multiple iterations of one observation-state issue. Evidence: evidence/ui-diagnostics.jsonl; evidence/m3-acceptance.log; src/usePaged.ts.
7. **agent-error** — Empty matching query omitted member candidates; added explicit directory browsing. Evidence: evidence/m3-choreo.log.
8. **agent-error** — Bubble action scope did not match frozen observability wrapper; corrected shell-owned boundary. Evidence: evidence/m3-choreo.log.
9. **agent-error** — Presence guard enclosed fallible/read work, preventing send prediction; hoisted payload computation so presence controls only the effect. Evidence: evidence/m6-send-why.txt; evidence/m6-send-why-2.txt.
10. **agent-error** — Home lacked inbox rows required for cross-device read-state observation; added inbox to home. Evidence: evidence/m8-choreo.log.
11. **agent-error** — Detached shell ended the fresh scale listener before first replay action; restarted in persistent exec and resumed journal. Evidence: evidence/scale-replay.jsonl; run-log.md.

Repeated attempts at the same observation-state problem are one loop. First-pass syntax/import mistakes, CLI spelling fixes, and the Python report keyword typo are recorded as errors in run-log.md but are not inflated into completed-work correction loops. A migrated chat briefly retained an unread count after expiry; the fresh isolated-group proof passed with zero unread, and both artifacts remain retained. No confirmed snapback4-defect was established; the null observation transition and initial materialized-feed acknowledgement cost remain ambiguous. The final adaptive read uses keyed merges for up to 100 actors and a compact scan above that threshold. Lane discovery reads up to 10,000 follows; the verified envelope is 500. Its compiler warnings remain retained, and larger graphs are not claimed. Ephemeral unread groups still use live-source counting and may encounter the published read meter at very high disappearing-message volume; the 10,000-message scale fixture explicitly has disappearing settings off.

## Limits and remaining external work

All requested product areas were implemented; none was struck from scope. The diagnostic Trending midpoint rule missed, so scale performance is not reported as a complete O5 pass. The initial adapter was authored and sample-validated during M6; its checkpoint-resume correction was made during the later replay and is explicitly retained rather than hidden inside the original first-green time. The retained evidence establishes this run's suite/choreography bar, not an independent security audit or a production operating history. The deployment is a local development binary, and notifications terminate at the requested logged seam. Real-provider credentials, production TLS deployment, monitoring/backups, and physical-device runtime validation are not claimed.

Harness-native token events and exact driver phase/orientation custody were not exposed within the authorized lane directory. Tokens and phase splits are null; no estimate or efficiency score is substituted. run-record.json validates the base record schema; the fully composed social-messenger record needs external grading and native driver custody and is explicitly pending. No holdout grader, rubric score, variance claim, or cross-backend speed ranking is fabricated. The comparative essay is architectural and candid about the absence of fresh competitor or earlier-generation runs.

The app's source is deliberately compact from the timed build. Physical line counts below are a ceremony measure, not a maintainability or effort score. Generated types/config, frozen kit/harness, dependencies, fixtures, exports, and narrative reports are excluded.

## Hand-authored lines by file

|File|Lines|
|---|---:|
|.gitignore|14|
|App.tsx|1|
|app.json|27|
|app/[...path].tsx|1|
|app/_layout.tsx|4|
|app/index.tsx|1|
|choreo-adapter.json|1|
|package.json|46|
|scripts/accept-m2.mjs|12|
|scripts/accept-m3.mjs|7|
|scripts/accept-m4.mjs|7|
|scripts/accept-m5.mjs|6|
|scripts/accept-m6.mjs|5|
|scripts/accept-m8.mjs|9|
|scripts/acceptance.mjs|19|
|scripts/choreo.mjs|1|
|scripts/closing-regression.mjs|2|
|scripts/common.mjs|10|
|scripts/configure.mjs|2|
|scripts/custom-client-demo.mjs|3|
|scripts/debug-home.mjs|8|
|scripts/debug-local.mjs|1|
|scripts/debug-ui.mjs|1|
|scripts/digest-proof.mjs|16|
|scripts/expiry-proof.mjs|1|
|scripts/final-evidence.mjs|8|
|scripts/finalize-scale.sh|4|
|scripts/offline-restart-proof.mjs|8|
|scripts/push-worker.mjs|5|
|scripts/regression.mjs|3|
|scripts/replay.mjs|39|
|scripts/report.mjs|25|
|scripts/scale-extra-probes.mjs|12|
|scripts/seed.mjs|27|
|scripts/serve.mjs|3|
|scripts/setup.mjs|2|
|scripts/validate-record.py|13|
|scripts/verify-sample.mjs|8|
|scripts/verify-scale.mjs|25|
|snapback/chat.q|283|
|snapback/insights.q|38|
|snapback/schema.q|160|
|src/Auth.tsx|17|
|src/Chat.tsx|31|
|src/Insights.tsx|4|
|src/Media.tsx|4|
|src/Shell.tsx|31|
|src/Social.tsx|25|
|src/client.ts|9|
|src/refresh.ts|1|
|src/usePaged.ts|46|

Total: 1036 lines across 51 files. Resolved pins and artifact hashes are retained in authoring-evidence.json.

## Final custody and shutdown

The initial replay clock was start=1790254199.801, end=1790255076.842, wall=877.041 seconds. Its invariant success and performance failures remain in evidence/scale-initial/clock.json and the preserved store. The second replay clock above includes the checkpoint failure/correction gap; only measured checkpoint verification time is subtracted. Later read-plan and receipt corrections, final verification, and cold/write probes are separately timestamped.

Last retained proof epoch: 1790257647.802. Full delivery-to-shutdown session wall: 6844.461 seconds. This includes reporting, repeated verification, and post-green tuning; it is not the shorter historical first-green statistic.

Stopped only owned PIDs verified by their exact working directories: 20404, 21162, 21926, 37480, 51285. No listener remains on assigned ports 49360–49379. evidence/shutdown.json retains the commands and verification. No pattern kills were used.

end=1790257941.4614909

