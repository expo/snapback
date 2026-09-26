lane id opus-clique-convex-ref-20260924
model claude-opus-5-5
effort=high
backend=convex-1.46.0
start=1790294903
1790294931 pin: convex@1.46.0 (exact, no caret) — recorded before any dependency install
1790294957 scaffold: create-expo-app@latest blank-typescript -> expo ~57.0.25, react 19.2.3, react-native 0.86.3
1790295372 lookup: convex CLI hidden flags --local-cloud-port/--local-site-port (source: package source, node_modules/convex/dist/cli.bundle.cjs)
1790296041 workaround: anonymous 'convex dev' watch mode auto-starts a local dashboard on 127.0.0.1:6790 (outside allowed 49300-49319; no flag to move it; source: package source node_modules/convex/dist/esm/cli/lib/dev.js+dashboard.js). Killed my PIDs 79457/79963/80397 (dashboard ran ~1 min). Switched to running convex-local-backend binary directly on 49301/49302 and pushing code with 'convex dev --once' via CONVEX_SELF_HOSTED_URL. attribution: convex-defect (knowledge-gap: undocumented port)
1790296080 server PID 92036: convex-local-backend dev instance 127.0.0.1:49301/49302 (state .convex/local/default)
1790296344 auth smoke green: Convex Auth Password provider (scrypt) signup/signin/signout; wrapped authorize for dup-email rejection (source: package source @convex-dev/auth/src/providers/Password.ts, ConvexCredentials.ts)
1790296834 server PID 18585: expo start --web (Metro dev server) port 49311
1790296986 stopped PID 92036 (initial dev backend under .convex/local/default); dev instance recreated fresh under .instances/dev for a clean M1-only seed
1790296988 server PID 46487: convex-local-backend instance 'dev' 127.0.0.1:49301/49302
1790296995 M1 start (milestone clock began at lane start=1790294903; orientation + scaffolding inside M1)
1790297133 server PID 71842: static web server (dist-web) 127.0.0.1:49310
1790297156 M1 GREEN (suite evidence/suite-m1.json 8/8, coverage 7/7; choreography evidence/choreo-m1-green.jsonl green:true; iOS Hermes bundle artifacts/ios-m1-entry-*.hbc). wall=2253s
1790297156 M2 start
1790297512 correction loop (M2): follow→Following backfill missed in full suite run once (scheduled backfill; concurrent OCC on follows logged at same ms; failedJobs empty; not reproducible in isolation x3). Fix: first backfill page runs synchronously inside setFollow. attribution: ambiguous. evidence: .instances/dev/backend.log 00:48:14.603 occ error; evidence/suite-m2.json (first run)
1790297559 M2 GREEN (suite evidence/suite-m2.json 10/10, coverage 22/22; choreography evidence/choreo-m2-green.jsonl green:true; artifacts/ios-m2-*.hbc). wall=403s
1790297559 M3 start
1790297726 correction loop (M3): green run failed member-remove live cutoff — harness page.goto right after clicking Remove aborted the in-flight removeMember mutation; Alice's next message reached Dave. Fix: admin/settings writes go through the durable ordered outbox (survives reload, ordered before later sends). attribution: agent-error. evidence: evidence/choreo-m3-green.jsonl
1790297846 M3 GREEN (suite evidence/suite-m3.json 5/5, coverage 7/7; choreography evidence/choreo-m3-green4.jsonl green:true [green3 also green; green/green2 failed — see correction loop]; artifacts/ios-m3-*.hbc). wall=287s
1790297846 M4 start
1790298066 M4 GREEN (suite evidence/suite-m4.json 6/6, coverage 5/5; choreography evidence/choreo-m4-green.jsonl green:true; artifacts/ios-m4-*.hbc). wall=220s
1790298066 correction loop (M4 suite): test helper eq() compared JSON with key order; Convex returns keys sorted. attribution: agent-error. evidence: first evidence/suite-m4.json run
1790298066 M5 start
1790298850 correction loop (M5): view-once viewer node rendered only after async fetch (harness inspects node children) + warm-offline search cache held only newest 50 messages (expected hit is the oldest DM message). Fix: container viewer shown immediately; HistorySync pulls up to 1000 msgs/chat into the durable store (full re-sync purges revoked content). attribution: agent-error. evidence: evidence/choreo-m5-dry1.jsonl
1790299405 M5 GREEN (suite evidence/suite-m5.json 7/7, coverage 6/6; choreography evidence/choreo-m5-green.jsonl green:true; artifacts/ios-m5-*.hbc). wall=1339s
1790299405 M6 start
1790299570 correction loop (M6): custom-client demo subscription threw InvalidCursor — messages.list index range used lte(seq, chat.lastSeq), which moves with every message and invalidates reactive pagination cursors (usePaginatedQuery silently restarts, masking it). Fix: open-ended range for active members. attribution: agent-error (Convex error message named the cause precisely). evidence: demo output
1790299740 M6 GREEN (suite evidence/suite-m6.json 5/5, coverage 5/5; choreography evidence/choreo-m6-green.jsonl green:true; simulator native artifacts not recorded (not required); artifacts/ios-m6-*.hbc). wall=335s
1790299852 server PID 23245: convex-local-backend instance 'scale' 127.0.0.1:49305/49306
1790299870 scale replay START (own clock; fresh instance .instances/scale, starter-seeded; log fixtures/scale.log sha256 b26bf1ae8ccf2d64…)
1790299889 scale replay END rc=1 (wall 19s incl. checkpoint pauses; see evidence/replay-scale.jsonl summary for pause-excluded replayMs)
1790299892 scale replay final invariant verification rc=1 (evidence/scale-verify-final.json)
1790299896 process PID 23068: scripts/scale-replay.sh (scale replay driver)
1790299926 stopped PID 23245 (instance 'scale')
1790299927 correction loop (scale replay): register u0067 failed 'Function execution timed out (maximum duration: 1s)' — Convex Auth hashes passwords (pure-JS Scrypt) inside its store mutation; under shared-host load one exceeded the 1s mutation limit. Fix: adapter retries transient platform errors (timeouts/OCC) up to 6x (all verbs idempotent). Discarded the partial instance; restarting on a fresh one. attribution: convex-defect (subAttribution: defect — password hash inside a 1s-limited mutation) aggravated by environment load. evidence: logs/scale-replay.log
1790299928 server PID 34250: convex-local-backend instance 'scale' 127.0.0.1:49305/49306
1790299929 process PID 34141: scripts/scale-replay.sh (scale replay driver, attempt 2)
1790299941 scale replay START (own clock; fresh instance .instances/scale, starter-seeded; log fixtures/scale.log sha256 b26bf1ae8ccf2d64…)
1790299947 M8 start
1790300245 workaround (M8 choreography precondition): m8-a02 needs an unliked Alice post on page 1 of Bob's Global feed; M8 suite posts pushed older Alice posts off page 1 (green attempt 1 failed: 'Global feed exposed no observably unliked Alice post'). Alice posts one fresh status via the app API (scripts/alice-fresh-post.mjs) before the run. No app/harness change. attribution: agent-error (suite residue). evidence: evidence/choreo-m8-green.jsonl
1790300256 M8 GREEN (suite evidence/suite-m8.json 5/5, coverage 6/6; choreography evidence/choreo-m8-green2.jsonl green:true; native-artifact a17/a18 not recorded; artifacts/ios-m8-*.hbc). wall=309s
1790300356 hardening (post-M8, dev deployment): view-once HTTP ticket is single-use (re-fetch refused before close); former members no longer receive the current roster from chats:settings. Covered by tests/m5.mjs view-once test.
1790300398 essay.md written (before tallying numbers)
1790300584 perf fix (from 10% probe diagnostics: following-feed p95 u0500/u0005 = 7.7x under host load): unfollow prunes timeline rows synchronously (<=1000, rest async) so followingFeed drops its per-row follow-edge read; per-query profile cache in feed rendering. Deployed to dev now (M2 suite re-run 10/10); to be deployed to the scale instance after replay completes, before final probes. attribution: agent-error (design).
1790303427 scale replay END rc=1 (wall 3486s incl. checkpoint pauses; see evidence/replay-scale.jsonl summary for pause-excluded replayMs)
1790303507 scale replay final invariant verification rc=0 (evidence/scale-verify-final.json)
1790303550 scale replay COMPLETE: 167157/167157 actions settled (fully acknowledged; last settle receipt n=167157); final invariant verification PASS (evidence/scale-verify-final.json); 10%/50% checkpoint verifications PASS. Driver rc=1 came from the post-replay sampled API verification (my verifier paged the 10k-msg chat 500/page → 'Too many reads in a single function execution (limit: 4096)'). Fixes (app): messages.list clamps pages to 200; global search candidate budget; digest unread scan bounded to the period (batch 10). attribution: agent-error; error message precise (Convex). evidence: logs/scale-replay.log
1790303563 deployed current app code to the scale instance (post-replay; perf + read-budget fixes) before sampled verification and final probes
1790303605 correction loop (scale): sampled verification hit read limit in chats:myChats for hub user u0001 (1000 conversations). Fix: myChats renders top-100 by activity after sorting on chat rows; allChats search uses unfiltered index + membership filter for >100 chats. Deployed to dev + scale. attribution: agent-error. evidence: scale-sample-verify first run
1790304275 scale instance: deployed timeline-cap (400) + trendingCandidates + deferred large-audience fan-out; ran one-time migration testSupport:migrateAll (trending candidates from likes; trimmed timelines to newest 400/owner). Post-replay posture change, recorded; replay itself and invariant verification unchanged.
1790304296 final regression start (final build; all suites + choreography 'all')
1790305257 final regression GREEN: suites m1-m6,m8 all PASS (evidence/suite-*.json), choreography 'all' green for m1,m2,m3,m4,m5,m6,m8 (evidence/choreo-all-final.jsonl); artifacts/ios-final-*.hbc
1790305273 stopped PID 46487 (instance 'dev')
1790305273 stopped PID 34250 (instance 'scale')
1790305276 stopped my server PIDs: 18648+18585 (expo dev server :49311), 71842 (static web :49310), 46487 (dev backend :49301/49302), 34250 (scale backend :49305/49306). Earlier-stopped: 79457/79963/80397 (initial watch-mode convex dev + dashboard), 92036 (first dev backend), first scale-instance backend (stopped via instance.mjs). No pattern kills used.
1790305355 final-report.md written; lane end
end=1790305355
