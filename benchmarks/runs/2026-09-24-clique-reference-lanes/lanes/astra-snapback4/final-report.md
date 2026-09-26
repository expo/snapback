# Clique — final report

Lane astra-clique-snapback4-ref-20260924; model gpt-6-astra; effort medium.

start=1790272699

All requested milestones are green under the installed suite/choreography bar. M7 was not run. The final full replay passed independent invariant verification and all recorded diagnostic probes without meter cuts. Native evidence is Hermes bundle export, not simulator execution.

| Milestone | Start epoch | Boundary end epoch | Wall seconds | First retained green epoch | Status | Suite-required assertions | Choreography passed |
|---|---:|---:|---:|---:|---|---:|---:|
| M1 | 1790272699 | 1790273313 | 614 | 1790273289.995 | green | 7 | 3/3 |
| M2 | 1790273327 | 1790274211 | 884 | 1790274168.087 | green | 22 | 9/9 |
| M3 | 1790274211 | 1790274715 | 504 | 1790274668.623 | green | 7 | 7/7 |
| M4 | 1790274715 | 1790275186 | 471 | 1790274977.405 | green | 5 | 5/5 |
| M5 | 1790275186 | 1790275916 | 730 | 1790275899.922 | green | 6 | 4/4 |
| M6 | 1790275916 | 1790276422 | 506 | 1790276325.408 | green | 5 | 1/1 |
| M8 | 1790276532 | 1790277024 | 492 | 1790276752.898 | green | 6 | 5/5 |
| M7 | — | — | — | — | not-run | — | — |

Boundary clocks are the milestone completion entries in run-log.md. First retained green is the earliest preserved suite-backed choreography summary. M1 had an earlier passing rehearsal whose receipt was overwritten; its exact first-green time is unavailable. Later scale-driven corrections and their revalidation are recorded below and in the log, rather than silently moved into earlier milestone walls. The final run ends at 1790280353; total wall is 7654 seconds, including orientation, replay attempts, diagnosis, and reporting.

## Evidence and native artifacts

- M1: [suite](evidence/suite-m1.json), [latest green choreography](evidence/choreo-m1.jsonl); Hermes: [entry-1e158e12d599e46ac7841dd0b03228fb.hbc](artifacts/m1-ios/_expo/static/js/ios/entry-1e158e12d599e46ac7841dd0b03228fb.hbc).
- M2: [suite](evidence/suite-m2.json), [latest green choreography](evidence/choreo-m2-1790277291685.jsonl); Hermes: [entry-1f9959314b46e2cc6b66be0c28ca7455.hbc](artifacts/m2-ios/_expo/static/js/ios/entry-1f9959314b46e2cc6b66be0c28ca7455.hbc).
- M3: [suite](evidence/suite-m3.json), [latest green choreography](evidence/choreo-m3-1790280168452.jsonl); Hermes: [entry-96110a2709b977fabc380f37767be3f9.hbc](artifacts/m3-ios/_expo/static/js/ios/entry-96110a2709b977fabc380f37767be3f9.hbc).
- M4: [suite](evidence/suite-m4.json), [latest green choreography](evidence/choreo-m4-1790278154293.jsonl); Hermes: [entry-89c5cfa363a69928873b5b591f88dafe.hbc](artifacts/m4-ios/_expo/static/js/ios/entry-89c5cfa363a69928873b5b591f88dafe.hbc).
- M5: [suite](evidence/suite-m5.json), [latest green choreography](evidence/choreo-m5-1790275565353.jsonl); Hermes: [entry-e035f9a972ca1d478aa97c7e7c1a7af1.hbc](artifacts/m5-ios/_expo/static/js/ios/entry-e035f9a972ca1d478aa97c7e7c1a7af1.hbc).
- M6: [suite](evidence/suite-m6.json), [latest green choreography](evidence/choreo-m6-1790276389374.jsonl); Hermes: [entry-47ef8dbbab512fb62636e168ac3aa219.hbc](artifacts/m6-ios/_expo/static/js/ios/entry-47ef8dbbab512fb62636e168ac3aa219.hbc).
- M8: [suite](evidence/suite-m8.json), [latest green choreography](evidence/choreo-m8-1790278078971.jsonl); Hermes: [entry-f69be9975a7ec94f00533d9ee7d019de.hbc](artifacts/m8-ios/_expo/static/js/ios/entry-f69be9975a7ec94f00533d9ee7d019de.hbc).

Additional evidence: [closed-client scheduled digest and restart](evidence/digest-proof.json), [cold offline history/search/queue](evidence/offline-web-proof.json), [ordinary media/view-once/offline reaction](evidence/media-offline-proof.json), [auth regression](evidence/auth-regression.json), [50-action conformance](evidence/sample-50-result.json), [coverage manifest](coverage-manifest.json). The frozen UI kit and choreography source were retained unchanged. Latest segments report zero skipped or unimplemented checks.

## Replay clocks and verification

- [evidence/preliminary-scale-result.json](evidence/preliminary-scale-result.json): start=1790276422; end=1790276466; wall=44s; acknowledged actions=11978; invariant result=false; probe time=not separated milliseconds; wall excluding probes=not separated seconds. Error: {"state":"pending","id":"00WVTQMN9MMARYW72NS78HETZW"}
- [evidence/replay-before-feed-fix/scale-result.json](evidence/replay-before-feed-fix/scale-result.json): start=1790277036; end=1790277494; wall=458s; acknowledged actions=167243; invariant result=true; probe time=5217 milliseconds; wall excluding probes=452.783 seconds. 
- [evidence/replay-before-unread-fix/scale-result.json](evidence/replay-before-unread-fix/scale-result.json): start=1790277567; end=1790278124; wall=557s; acknowledged actions=97542; invariant result=false; probe time=2883 milliseconds; wall excluding probes=554.117 seconds. Error: {"state":"pending","id":"188E4TV3HGAN7J07DC84MFMJ8R"}
- [evidence/scale-result.json](evidence/scale-result.json): start=1790278150; end=1790280065; wall=1915s; acknowledged actions=167243; invariant result=true; probe time=2390 milliseconds; wall excluding probes=1912.61 seconds. 

The preliminary attempt stopped for sequencing; the first complete attempt verified the corpus but exposed sparse-feed and busy-chat meter cuts; the next attempt retained two verified checkpoints before the unread-query correction. None is hidden or relabeled as a final green replay. The final attempt began with an empty persistent store, applied 86 starter actions and 167,157 scale actions sequentially, and verified actual server data at 10%, 50%, and completion. Verification covers every per-entity count, every user’s follow/conversation counts, every chat’s message count, every group’s membership count, and named entities/fixtures. The final store remains under `scale-instance/.snapback4/`. Push effects and schedules were suppressed by `--replay`. Diagnostic probes used three warm-ups and twenty sequential samples, with a thirty-second timeout. These are not the hidden scored probe set, and no O5 score is claimed.

## Resolved packages

- snapback4@0.4.0
- snapback4-expo@0.4.0
- snapback4-darwin-arm64@0.4.0

Exact package pins were written before installation. Public npm tarball hashes, binary/wrapper hashes, and toolchain identity are in [setup-identity.json](setup-identity.json). No Snapback source checkout, sibling lane, prior implementation, or prior run was inspected.

## Corrections and attribution

- **environment** — 1790272887 error/retry attribution=environment: shell rejected rm -f of generated unused starter files; retry using exact pathlib unlink. No files changed by rejected command.
- **agent-error** — 1790272971 error attribution=agent-error evidence=evidence/typecheck-m1.log: assets option belongs to createLocalClient, not createApp; removed for M1.
- **agent-error** — 1790273123 correction-loop attribution=agent-error evidence=evidence/acceptance-m1.log: profile input patch used captured state, changed to functional update; test now waits for heading convergence.
- **environment** — 1790273202 error attribution=environment evidence=evidence/choreo-m1.log: copied choreography requires adjacent metering/observability/schema; copied frozen dependencies. Discovered shell Node is v25.9.0 despite ENVIRONMENT; switching explicitly to supplied Node24.
- **agent-error** — 1790273221 correction-loop attribution=agent-error evidence=evidence/acceptance-m1-retry2.log: pending writes needed terminal receipt navigation; duplicate Stack profile nodes exposed by repeated replacement. Use Router Slot and one terminal navigation path.
- **ambiguous** — 1790273599 suite-pass M2 evidence=evidence/suite-m2.json; browser logged nonfatal _dispatchEvent error during reload; investigate before green attribution=ambiguous
- **environment** — 1790273634 error/retry attribution=environment evidence=evidence/choreo-m2.log: frozen default fixture path assumes original repository layout; configured supported adapter fixtures.directory=instrument/fixtures.
- **agent-error** — 1790273685 correction-loop attribution=agent-error evidence=evidence/choreo-m2.log: choreography invokes feed tabs directly from profiles; moved feed navigation tabs to shared shell. Environment ffmpeg dylib unavailable; generated poster from frozen MP4 through browser decoder evidence=scripts/poster.mjs.
- **ambiguous** — 1790273796 diagnosis attribution=ambiguous evidence=evidence/choreo-m2-1790273687111.jsonl: eight assertions passed; final reply refers to earlier post after enough generated events to exceed first page. Added one-page-ahead prefetch to feed scroll list, retaining 20-row backend pagination.
- **agent-error** — 1790273830 correction-loop attribution=agent-error evidence=evidence/acceptance-m2-final.log: detached Linking.openURL callback loses receiver on RN Web; wrapped method call.
- **agent-error** — 1790273893 correction-loop attribution=agent-error evidence=evidence/choreo-m2-final.log: Following baseline briefly empty during route remount; retained both live feed subscriptions above routes so tab switching renders acquired data immediately.
- **ambiguous** — 1790273966 workaround attribution=ambiguous evidence=evidence/choreo-m2-retry3.log,evidence/guide-feeds.txt,evidence/check-m2-direct.log: harness takes an immediate baseline for a just-created post, while materialized Following delivers asynchronously. Home now filters public activity directly; sparse-read note retained as scale risk to verify M6. Materialized declaration retained because populated timeline cannot be removed.
- **agent-error** — 1790274017 diagnosis correction attribution=agent-error evidence=app/_layout.tsx: route-based tab clicks retain old Global DOM during navigation, permitting harness to read original plus repost before Following renders. Use synchronous React tab state; reverted speculative direct-query workaround to documented materialized Following.
- **ambiguous** — 1790274131 diagnosis source=diagnostic attribution=ambiguous evidence=evidence/debug-feed.log,scripts/debug-feed.mjs: direct Following plus server-confirmed publish makes new original present in immediate baseline. Previous tab-only fix insufficient.
- **agent-error** — 1790274545 authoring-errors attribution=agent-error evidence=evidence/why-syntax.txt,evidence/why-rule-comparison.txt,evidence/why-sync.txt: one sync line per table; monotonic comparison belongs in mutation; aggregate group key reordered to match synced chat prefix. All resolved by published diagnostics.
- **agent-error** — 1790274628 correction-loop attribution=agent-error evidence=evidence/choreo-m3.log: member picker reused empty word-prefix search; added explicit browse path when query is empty. Six other choreography checks passed.
- **agent-error** — 1790275487 M5 correction-loop attribution=agent-error evidence=evidence/check-m5.log: bounded text declaration and exact UI accent palette corrected; expiring receipt scan replaced with bounded membership/key deletion after E_STRUCTURAL_FANOUT. Knowledge lookup source=package README/guide evidence=evidence/guide-effects.txt,evidence/guide-jobs.txt,node_modules/snapback4/CLIENT-AND-OPERATIONS.md
- **agent-error** — 1790275671 M5 review correction attribution=agent-error evidence=src/Chat.tsx,scripts/acceptance-m5.mjs: added in-chat search continuation and visible disappearance setting; narrowed future suite coverage for no-client API test to a01, since a02/a03 require client purge verification. Existing receipt overmapped these grader assertions; no suite-required coverage affected.
- **agent-error** — 1790276218 M6 correction-loop attribution=agent-error evidence=evidence/acceptance-m6.log: push test expected stale fixture display name after choreography profile edits; compare current server profile. Knowledge lookup source=package README/guide evidence=evidence/guide-maintains.txt,evidence/token-help.txt,node_modules/snapback4/CLIENT-AND-OPERATIONS.md; local-client auth composed to expose published assets retention option.
- **agent-error** — 1790276321 M6 correction-loop attribution=agent-error evidence=evidence/choreo-m6.log,evidence/why-send-m6.txt: profile lookup inside presence arm prevented message prediction. Hoist profile lookup before presence guard. Remove redundant unscoped reaction uniqueness to admit prediction while chat-scoped uniqueness enforces same semantic identity.
- **agent-error** — 1790276466 scale preliminary attempt stopped pid=11523 attribution=agent-error: full replay must include M8 Insights probes; preserve attempt and rerun finished schema after M8.
- **agent-error** — 1790276881 M8 correction-loop attribution=agent-error evidence=evidence/check-m8.log,scripts/digest-config.mjs: schedules require m/h/d units; inline per-recipient job loops rather than helper carrying cross-sweep locals; narrow optional receipt state. Worker logged expected socket closure during intentional restart and remains running.
- **agent-error** — 1790277198 scale-10pct invariant verification passed; correction-loop attribution=agent-error evidence=evidence/replay-probes-10pct.json: sparse direct Following exhausts read heap (cut=meter, data=null, heap about16MiB). Replace direct sparse scan with union of direct own activity and materialized following excluding own actor; verify M2 choreography again and replay final schema.
- **agent-error** — 1790277481 scale replay final preparation attribution=agent-error correction: documented materialized Following restored; author composer now waits terminal write and sync. M2 choreography passed evidence=evidence/choreo-m2-scale-fix.log. Fresh persistent instance prepared under scale-instance to preserve grading data; copied own Quarry only.
- **environment** — 1790277550 error/retry attribution=environment evidence=evidence/scale-backend-persistent.log: old scale process had not released 49502 at immediate restart (os error48); wait for owned process exit before retry.
- **agent-error** — 1790277702 correction-loop attribution=agent-error evidence=evidence/media-offline-proof.log: selecting the same file twice did not re-trigger the retained HTML input. Clear file-input value after capturing file; applies to message, post and background pickers.
- **ambiguous** — 1790278071 correction-loop attribution=ambiguous evidence=evidence/media-offline-diagnosis.log,evidence/media-offline-committed-fetch.log: sender optimistic image fetch preceded placement and did not retain bytes (E_OFFLINE: no retained ordinary media). Post-commit fetch passes cold offline image proof. Gate ordinary bubble asset fetch on !pending; no custom cache or test-only retention path retained. Temporary diagnostic hook removed.
- **agent-error** — 1790278071 scale correction attribution=agent-error evidence=evidence/replay-before-feed-fix/replay-probes-final.json: exact unread count over expiring receipts causes 8193-row cut in busy chat. Chat cards now use indexed unread existence; UI shows an unread dot, as required, without a fabricated count.
- **agent-error** — 1790278124 server-stop scale-backend pid=94862; replay attempt interrupted after both checkpoints to adopt already-verified unread existence correction before final clean run. attribution=agent-error evidence=evidence/replay-before-feed-fix/replay-probes-final.json,evidence/choreo-m8-unread-dot.log
- **agent-error** — 1790278512 final UI correction attribution=agent-error evidence=src/Chat.tsx,app/conversation/chat/[id]/index.tsx: stable-ID group navigation prevents same-name and rename ambiguity; narrow-screen header wraps. Backend schema unchanged during final replay.
- **agent-error** — 1790279553 final UI correction attribution=agent-error evidence=src/Chat.tsx: quoted-message jump retains target through pagination and avoids auto-scroll back to latest while reading history; DM creation guard keys by counterpart.
- **ambiguous** — 1790279790 diagnosis correction attribution=ambiguous evidence=evidence/typing-diagnostic.log,evidence/guide-clock.txt: typing mutation and read take6ms, but freshly written expiresAt is623329ms behind client wall clock. Dev uses monotonic process clock; observed clock divergence, not proven load latency. Restart only owned main backend pid=77298 per documented offset-reset behavior; scale instance unchanged.
- **agent-error** — 1790280165 correction attribution=agent-error evidence=src/Chat.tsx,evidence/choreo-m3-final-retry.log: coalesce typing announcements to at most one per750ms with no delayed trailing write; per-keystroke durable outbox work needlessly extended expiry under load. Server TTL and replay schema remain unchanged. Fixed final-report generator string syntax.
- **agent-error** — 1790280248 final regression green M3 attribution=agent-error evidence=evidence/choreo-m3-coalesced.log,evidence/typecheck-final.log: coalesced typing passes complete frozen chat segment; TypeScript passes. Final scale result verified=true with all strict diagnostic probes passing.
- **agent-error** — 1790280268 reporting correction attribution=agent-error evidence=scripts/final-report.mjs: report parser encountered an empty interrupted choreography receipt; skip empty lines without claiming a completed segment. Final M8 Hermes export passed evidence=evidence/ios-m8-final.log.

These are timestamped correction/diagnosis records, not an inferred count of every compiler invocation. Some working logs were overwritten by successful retries; [preserved diagnostic excerpts](evidence/diagnostic-corrections.md) and the tool transcript retain the named errors. No confirmed snapback4-defect is claimed. The optimistic unplaced-media retention interaction remains ambiguous; the application workaround gates media fetches until placement is committed.

## Hand-authored line counts

Physical source/test/config lines are a ceremony measure, not normalized complexity: several files use compact formatting. Generated Quarry configs, generated API/types, copied kit/harness, package locks, bundles, assets, database state, and generated reports are excluded. The scale-instance Quarry files are copies, not additional hand-authored code.

| File | Lines | Bytes |
|---|---:|---:|
| app.json | 27 | 515 |
| app/_layout.tsx | 18 | 2628 |
| app/chat-settings/[id].tsx | 1 | 436 |
| app/chats.tsx | 1 | 119 |
| app/conversation/[handle].tsx | 1 | 244 |
| app/conversation/chat/[id]/index.tsx | 1 | 491 |
| app/conversation/group/[group]/index.tsx | 1 | 242 |
| app/conversation/group/[group]/settings.tsx | 1 | 254 |
| app/index.tsx | 1 | 428 |
| app/insights.tsx | 2 | 1352 |
| app/new-chat.tsx | 2 | 1695 |
| app/post/[id].tsx | 1 | 752 |
| app/profile/[handle].tsx | 2 | 929 |
| app/profile/edit.tsx | 1 | 375 |
| app/search.tsx | 2 | 1940 |
| app/settings.tsx | 2 | 469 |
| babel.config.js | 4 | 101 |
| choreography-adapter.json | 1 | 108 |
| metro-wasm-transformer.cjs | 10 | 579 |
| metro.config.js | 8 | 543 |
| package.json | 43 | 1361 |
| scripts/acceptance-m2.mjs | 18 | 7983 |
| scripts/acceptance-m3.mjs | 14 | 4046 |
| scripts/acceptance-m4.mjs | 12 | 4853 |
| scripts/acceptance-m5.mjs | 11 | 4741 |
| scripts/acceptance-m6.mjs | 8 | 3833 |
| scripts/acceptance-m8.mjs | 8 | 5542 |
| scripts/acceptance.mjs | 21 | 6191 |
| scripts/auth-regression.mjs | 1 | 1140 |
| scripts/choreo.mjs | 3 | 838 |
| scripts/config.mjs | 2 | 623 |
| scripts/custom-client-demo.mjs | 3 | 1864 |
| scripts/debug-feed.mjs | 2 | 1554 |
| scripts/digest-config.mjs | 29 | 2110 |
| scripts/digest-proof.mjs | 1 | 3796 |
| scripts/final-report.mjs | 17 | 13987 |
| scripts/m5-client.py | 26 | 6450 |
| scripts/m5-schema.py | 45 | 3536 |
| scripts/media-offline-proof.mjs | 3 | 3994 |
| scripts/offline-web-proof.mjs | 1 | 2219 |
| scripts/poster.mjs | 2 | 768 |
| scripts/push-worker.mjs | 1 | 686 |
| scripts/replay-adapter.mjs | 38 | 6640 |
| scripts/scale-replay.mjs | 2 | 1893 |
| scripts/seed.mjs | 23 | 4245 |
| scripts/serve.mjs | 4 | 1038 |
| scripts/setup-identity.mjs | 4 | 1236 |
| scripts/typing-diagnostic.mjs | 1 | 1009 |
| scripts/verify-replay.mjs | 9 | 6582 |
| snapback/schema.q | 447 | 20005 |
| src/Auth.tsx | 3 | 525 |
| src/Chat.tsx | 23 | 15550 |
| src/client.ts | 7 | 2478 |
| src/Posts.tsx | 15 | 6633 |
| src/Profile.tsx | 13 | 3174 |
| src/VideoPlayer.tsx | 1 | 288 |
| tsconfig.json | 16 | 304 |

Source/test/config total: 964 lines across 57 files. Copied shared UI: 3694 lines, excluded from that total.

Hand-authored documentation, separately:

| File | Lines | Bytes |
|---|---:|---:|
| API.md | 56 | 5021 |
| README.md | 27 | 3711 |
| diary.md | 29 | 9398 |
| essay.md | 31 | 10580 |
| run-log.md | 121 | 19058 |

## Limits and gaps

- No simulator proof, hidden grader score, real APNs/FCM delivery, or production deployment is claimed. Native exports and the logging provider seam are the requested artifacts.
- Full public social partitions and full private chat history are acquired by a new replica. Cheap page reads do not establish cheap cold acquisition at scale; cold scale acquisition was not measured as a scored probe.
- The package’s published materialized feed has its documented history/cap envelope. The fixture fits it; this report makes no unbounded-feed claim.
- Existing development profiles predate the added creation-time field and read its legacy zero default; fresh fixture installs record server creation time.
- Fixture-compatible named group routes choose the first authorized matching name. Normal app navigation uses stable group IDs, including after rename.
- The developer host admits loopback development capabilities. HTTPS deployment hardening and release operation are not exercised here.
- A later M3 regression exposed development-server/browser clock divergence: a fresh 4.5-second deadline was over ten minutes behind wall time. Restarting the owned main dev process restored a 4.5-second delta. The cause of the clock divergence is unverified; both diagnostics and the failed/passing regression receipts are retained.
- Token/tool counts and fine-grained wall-clock phase splits are unavailable from a trustworthy lane meter and are recorded as null, not estimated.
- Historical evidence limitations include the overwritten M1 rehearsal and an M5 API test that initially overmapped grader-only client-purge assertions. Required suite coverage is intact; the separate choreography and API proofs are reported precisely.

[Essay](essay.md) was written before this numerical tally. [Diary](diary.md) contains milestone-boundary reflections. [Run log](run-log.md) records errors, lookups, retries, server PIDs, and cleanup.

end=1790280353
