lane id opus-clique-snapback4-ref-20260924
model claude-opus-5-5
effort=high
backend=snapback4-0.4.0
start=1790294902
pins: snapback4@0.4.0 (exact), snapback4-expo@0.4.0 (exact)

2026-09-25T00:08:22Z [1790294902] run start; reading instrument
2026-09-25T00:08:40Z [1790294920] install snapback4@0.4.0 + snapback4-expo@0.4.0 (npm)
2026-09-25T00:11:00Z [1790295060] knowledge: dumped all guide cards to notes/guide (source: package README/guide)
2026-09-25T00:14:10Z [1790295251] M1 start (orientation done: README, CLIENT-AND-OPERATIONS, SERVER skim, all guide cards, brief, contract, assertions, choreography m1-m8)
2026-09-25T00:19:05Z [1790295545] started dev backend: npx pid 20558, snapback4 binary pid 20685, port 49200 (store .snapback4/store.sqlite)
2026-09-25T00:19:35Z [1790295575] vendored UI kit 0.3.3-m8 into src/kit (unmodified copy)
2026-09-25T00:24:21Z [1790295861] started web static server pid 67195 port 49201
2026-09-25T00:25:06Z [1790295906] copied instrument/choreography + instrument/metering (choreography imports ../metering/observations.mjs) into lane; npm install in choreography/
2026-09-25T00:28:29Z [1790296109] M1 suite PASS receipts/suite-m1-1790296105.json (loop: web file-input resolution — Metro picked pick.ts over pick.web.tsx; renamed to pick.web.ts; attribution agent-error; evidence receipts/suite-m1-1790296048.json)
2026-09-25T00:28:46Z [1790296126] M1 GREEN: suite receipts/suite-m1-1790296105.json + choreography receipts/choreo-m1-1790296109.jsonl (green:true)
2026-09-25T00:30:31Z [1790296231] M1 iOS Hermes bundle: artifacts/ios-m1/_expo/static/js/ios/entry-7fca1d2673c0b81b942f116d46c3362f.hbc (Hermes bytecode v98)
2026-09-25T00:30:31Z [1790296231] M2 start
2026-09-25T00:35:55Z [1790296555] M2 suite PASS receipts/suite-m2-1790296550.json (loops: composer cleared text after async submit racing next input -> agent-error, evidence receipts/suite-m2-1790296510.json; FlatList virtualization hid page-2 items -> agent-error)
2026-09-25T00:36:11Z [1790296571] M2 GREEN: suite receipts/suite-m2-1790296550.json + choreography receipts/choreo-m2-1790296555.jsonl (green:true)
2026-09-25T00:36:15Z [1790296575] M2 iOS Hermes bundle: artifacts/ios-m2/_expo/static/js/ios/entry-40cd5c68922f637c426615d18ba9c43d.hbc
2026-09-25T00:36:15Z [1790296575] M3 start
2026-09-25T00:43:30Z [1790297010] M3 suite PASS receipts/suite-m3-1790297007.json
2026-09-25T00:44:17Z [1790297057] M3 GREEN: suite receipts/suite-m3-1790297007.json + choreography receipts/choreo-m3-1790297010.jsonl (green:true; sender-avatar optional check skipped by instrument: kit 1:1 layout does not mount sm-convo-sender-avatar)
2026-09-25T00:44:27Z [1790297067] M3 iOS Hermes bundle: artifacts/ios-m3/_expo/static/js/ios/entry-34a19a7244e24af32b0733102932cccd.hbc
2026-09-25T00:44:27Z [1790297067] M4 start
2026-09-25T00:46:25Z [1790297185] M4 loop: video message sent as caption-only because web picker awaited poster generation before attaching (agent-error; evidence receipts/choreo-m4-1790297*.jsonl first run); fixed by attaching immediately and resolving poster async
2026-09-25T00:48:21Z [1790297301] M4 loop: viewer video testID on the <video> raced the async asset fetch in the harness's root-vs-descendant check (agent-error); wrapped video in a sm-media-viewer-video view
2026-09-25T00:48:21Z [1790297301] M4 GREEN: suite receipts/suite-m4-1790297280.json + choreography receipts/choreo-m4-1790297280.jsonl (green:true)
2026-09-25T00:48:31Z [1790297311] M4 iOS Hermes bundle: artifacts/ios-m4/_expo/static/js/ios/entry-c442c36491e59e2ec4167938f3d2dd54.hbc
2026-09-25T00:48:31Z [1790297311] M5 start
2026-09-25T00:52:56Z [1790297576] M6-prep loop: snapback/server.ts E_SERVER_TYPECHECK (node types not visible under expo tsconfig; import.meta refused as CJS) — fixed with snapback/package.json type:module + /// <reference types="node" />; attribution ambiguous (docs say install @types/node; diagnostic accurate); evidence: check output. Dev kept serving previous generation meanwhile.
2026-09-25T00:52:56Z [1790297576] dev supervised worker (snapback/server.ts) pid 47264 (child of dev pid 20685; restarts on adoption)
2026-09-25T01:02:03Z [1790298123] M5 loop: suite grouped-headers assertion compared case-sensitively against CSS-uppercased headers (agent-error, test bug; evidence receipts/suite-m5-1790297724.json)
2026-09-25T01:02:03Z [1790298123] M5 GREEN: suite receipts/suite-m5-1790297740.json + choreography receipts/choreo-m5-1790297740.jsonl (green:true; includes real 300s disappearing wait)
2026-09-25T01:02:09Z [1790298129] M5 iOS Hermes bundle: artifacts/ios-m5/_expo/static/js/ios/entry-78e71bbc0908058bb5d2dee79006c5b3.hbc
2026-09-25T01:02:09Z [1790298129] M6 start (push seam worker, API.md, demo, replay adapter already drafted during M5 wait)
2026-09-25T01:02:30Z [1790298150] M6 loop: custom-client demo lingered 30s on an uncleared race timer (agent-error)
2026-09-25T01:02:30Z [1790298150] M6 GREEN (web authoring green): suite receipts/suite-m6-1790298136.json + choreography receipts/choreo-m6-1790298136.jsonl (green:true). Native/O4 simulator artifacts (m6-a01..a07) not produced (not required by this run's instructions; greenRequired:false)
2026-09-25T01:02:34Z [1790298154] M6 iOS Hermes bundle: artifacts/ios-m6/_expo/static/js/ios/entry-78e71bbc0908058bb5d2dee79006c5b3.hbc
2026-09-25T01:02:34Z [1790298154] M8 start
2026-09-25T01:05:00Z [1790298300] started fresh scale-replay instance: replay-instance/ snapback4 dev --port 49202 --replay (binary pid 68707, launcher pid 68705, worker child 68816)
2026-09-25T01:05:20Z [1790298320] SCALE REPLAY started (own clock), runner pid 70250; log logs/scale-replay.log
2026-09-25T01:06:30Z [1790298390] restarted dev backend to reset dev-clock offset accumulated by suite clock advances: killed my pids 20558/20685; new launcher pid 87437, binary pid 87513
2026-09-25T01:08:13Z [1790298493] M8 choreo a02 failed: 'no observably unliked Alice post' in Bob's first Global page — dev instance polluted by suite-created posts (attribution: environment/agent test ordering). Precondition restored by creating one Alice post via API; rerun
2026-09-25T01:08:26Z [1790298506] M8 GREEN (web authoring green): suite receipts/suite-m8-1790298459.json + choreography receipts/choreo-m8-1790298493.jsonl (green:true). m8-a17/a18 native restart artifacts not produced (not required; greenRequired:false)
2026-09-25T01:08:33Z [1790298513] M8 iOS Hermes bundle: artifacts/ios-m8/_expo/static/js/ios/entry-6db91e3902904edf6f76bac0281fcaf2.hbc
2026-09-25T01:08:53Z [1790298533] scale runner loop: checkpoint prefix hash computed excluding the marker line (manifest defines prefix including the marker) — agent-error; runner fixed for future runs; this run's receipt checkpoint hashes will be recomputed post-hoc from scale.log (verified both match manifest when including marker)
2026-09-25T01:25:05Z [1790299505] SCALE REPLAY clock: start epoch 1790298300, end epoch 1790299242; replay wall 932.2 s (probe wall excluded 10.4 s); settled 167157/167157 scale actions (+86 starter actions first); cap 14400 s (6.5% used)
2026-09-25T01:25:05Z [1790299505] SCALE REPLAY verification vs invariant-manifest-combined.json: 10% CONFORMS, 50% CONFORMS, final CONFORMS (per-entity counts, per-user following/conversation counts, per-chat message counts, per-group member counts, named O5 fixtures incl. full API paging of g0001=10000, spot profiles/posts/messages/conversations). Receipts: receipts/scale-replay-receipt.json, receipts/scale-replay-evidence.json, logs/scale-replay.log
2026-09-25T01:25:05Z [1790299505] SCALE degradation rules: 7/8 pass; FAIL celebrity post-create p95 (u0900 606.6 ms vs u0005 17.3 ms, measured first right after replay). Diagnostic follow-up: host load average 79 (18 cores, shared machine); later bursts showed u0005 ~750 ms and a fresh 0-follower author p95 424 ms while u0900 measured 4-5 ms — latency tracks host contention/burst timing, not follower count (engine metered work identical: 6 rows written for both). Attribution: environment (ambiguous). Recorded result stands as measured.
2026-09-25T01:25:05Z [1790299505] scale receipts: checkpoint prefixSha256 recomputed post-hoc including the marker line (now equal to manifest)
2026-09-25T01:25:48Z [1790299548] final regression pass start (all suites, dev restart, choreography all)
2026-09-25T01:28:52Z [1790299732] regression loop (M8/M2): with server clock ahead of browser clock, (a) Trending ran on the device (api.ts said runs: device) so its 24h window used the device clock, contrary to 'server time' — fixed by making trending read an online-only aggregate so it runs on the server; (b) a pending thread reply sorted by device time before confirmed replies — pending replies now render last. Attribution: agent-error (the runs: device fact was documented). Evidence receipts/suite-m2-1790299574.json, receipts/suite-m8-1790299626.json; fixed receipts suite-m2-1790299712, suite-m8-1790299722
2026-09-25T01:29:08Z [1790299748] restarted dev backend (reset dev clock) killed my pids 87437/87513; new launcher 7202 binary 7377
2026-09-25T01:29:46Z [1790299786] (retro-log) M4 loop: suite reaction assertion compared JSON with key order (agent-error, test bug; evidence receipts/suite-m4-1790297192.json)
2026-09-25T01:31:05Z [1790299865] regression choreography m2 live-post checks failed: 96 suite posts created while the dev clock was advanced carry at up to ~1064 s in the future, so after the dev restart they occupy Global's first page and hide fresh posts (agent-error: test-induced dev clock skew; no product change). Will rerun affected segments after max(at) passes (≈ epoch 1790300923)
2026-09-25T01:41:46Z [1790300506] regression choreography-all receipts/choreo-all-1790299753.jsonl: m1,m3,m4,m5,m6 green; m2 + m8(a02) failed due to future-dated posts on Global (see previous line); rerunning m2,m8 after epoch 1790300923
2026-09-25T01:49:29Z [1790300969] regression rerun m2,m8: both green (receipts/choreo-m2,m8-1790300939.jsonl). Final regression pass complete: all suites PASS (m1 1790299558, m2 1790299712, m3 1790299584, m4 1790299597, m5 1790299610, m6 1790299614, m8 1790299722) and all choreography segments green (choreo-all-1790299753 for m1,m3,m4,m5,m6; receipts/choreo-m2,m8-1790300939.jsonl for m2,m8)
2026-09-25T01:50:55Z [1790301055] CORRECTION to celebrity-probe attribution: at host load ~20 a diagnostic re-measure still showed u0900 burst p50 7-943 ms / p95 2020-2449 ms vs u0005 p50 6 ms / p95 26-602 ms. 'snapback4 why createPost' states the insert is 4 writes independent of follower count, with Following delivery in background chunks (<=256 copies) that share the engine; back-to-back celebrity posts wait behind the previous post's ~900-copy delivery. Attribution revised: ambiguous (platform fan-out-on-write-in-background characteristic of the declared timeline, amplified by shared-host contention); not changeable from app code without abandoning the declared timeline. Evidence: receipts/scale-replay-evidence.json + this diagnostic.
2026-09-25T01:51:32Z [1790301092] shutdown: killed only my pids — web 67195; dev 49200 launcher 7202 + binary 7377 (wrapper 7327 and worker 7573 exited with them); replay instance launcher 68705 + binary 68707 (worker 68816 exited). No listeners remain on 49200-49202.
2026-09-25T01:51:32Z [1790301092] run complete; final-report.md written
end=1790301092
