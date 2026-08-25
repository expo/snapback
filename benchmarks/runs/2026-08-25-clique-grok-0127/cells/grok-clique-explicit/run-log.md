# run-log.md
lane id grok-clique-explicit
model grok-4.6
effort=xhigh
backend=snapback-explicit-0.1.27
start=1787656054

- 1787656054 knowledge-lookup BENCHMARK-ORIENTATION.md (lane-local) — snapback-web-clique, M1–M3, snapback-explicit-v1, pin 0.1.27, instrument social-messenger@0.3.3-m8
- 1787656054 knowledge-lookup AGENTS.md (lane-local) — skill allowlist snapback-authoring only before first product edit
- 1787656054 knowledge-lookup skills/snapback-authoring/SKILL.md (lane-local) — golden path snapback-explicit-v1; schema.mjs/functions.mjs; escalate via snapback guide
- 1787656054 knowledge-lookup instrument/briefs/social-messenger.md (instrument) — Clique M1–M3 reduced run; last-write-wins; starter-log replay; suite+choreo green
- 1787656054 knowledge-lookup instrument/tools/social-messenger/CONTRACT.md (instrument) — sm-* test IDs, personas, action verbs
- 1787656054 knowledge-lookup instrument/schema/social-messenger/assertions.json (instrument) — M1 7 suite / 3 choreo; M2 22 suite / 5 choreo; M3 7 suite / 8 choreo
- 1787656054 knowledge-lookup instrument/tools/social-messenger/choreography/README.md (instrument) — CHOREO_BASE_URL, suite-status linkage, required skips
- 1787656271 knowledge-lookup snapback CLI --help / new --help / dev --help (packaged CLI 0.1.27) — templates crud-dashboard|expo-chat|media-feed|react|todo-contract; snapback dev --expo --expo-platform web --port --port-range --application-ready-file
- 1787656271 knowledge-lookup npm README @expo/snapback-cli@0.1.27 — expo-chat is Expo conversation starter; sessions + uploads
- 1787656271 knowledge-lookup packaged template expo-chat AGENTS.md start packet (published package files) — sessions, guest-first, volatile-explicit custody, signUpWithPassword/signInWithPassword, defineJsMutation, ephemeral typing
- 1787656271 knowledge-lookup snapback doctor --json (packaged CLI) — runtime @expo/snapback-runtime-linux-x64 selected; SNAPBACK_DEV_SERVER_SEED_FAILED without an app (environment, expected pre-scaffold)
- 1787656271 M1 start — scaffold expo-chat then adapt to Expo Router Clique; backend pin 0.1.27 explicit profile
- 1787656527 first-product-edit stamped first-product-edit.json orientationBytes=14887 selectedSkills=[snapback-authoring]
- 1787656527 knowledge-lookup packaged template expo-chat schema/functions/App.tsx (published package files) — sessions, defineJsMutation, signUpWithPassword, useSnapbackQuery
- 1787656527 knowledge-lookup @expo/snapback-codegen define.d.ts / ctx.d.mts / @expo/snapback-client app-client.d.mts (package types)
- 1787656800 correction-loop agent-error SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER — HANDLE_RE const not spliceable; switched to function declaration. evidence: bun run generate
- 1787657123 lifecycle-owner pid=3605743 command=`snapback dev snapback --expo --expo-platform web --port 48100 --client-port 48110 --bootstrap-port 48101 --port-range 48100-48119` backend pid=3605817 origin=http://127.0.0.1:48100 metro=http://127.0.0.1:48110 bootstrap=48101
- 1787657123 knowledge-lookup served guide GET /_snapback/guide/start/expo-chat.md and /_snapback/guide/auth/passwords.md (running snapback 0.1.27)
- 1787657123 knowledge-lookup snapback guide signUpWithPassword / SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE (served guide)
- 1787657200 correction-loop agent-error SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE — replay used platform memory; switched to expo-web+fake-indexeddb. evidence: scripts/replay.mjs
- 1787657400 workaround environment Chromium missing libatk/libX11 on host; extracted Ubuntu debs into ~/.local/chrome-libs and set LD_LIBRARY_PATH. evidence: ldd chrome
- 1787657600 correction-loop agent-error duplicate-handle error lost because SessionShell remounted HomeScreen; kept children in stable AppChrome body. evidence: sm-auth-error missing then present
- 1787657600 correction-loop agent-error setProfile after signup used stale anonymous mutation dispatcher; deferred via pendingProfile effect. evidence: 400 HANDLE_TAKEN without UI error
- 1787658098 M1 green suite+choreography. suite receipts/m1/suite.json pass=true; choreography receipts/m1/choreography.jsonl green=true. deployment schemaHash=snapback.v1:sessions:schema:sha256:2d884c3241841d6b39e4220bf5a21509785b78a4c548752b3269b585dfadaf25 bundleHash=snapback.v1:sessions:function:sha256:dcc937dec8fb2e5f85cc204ac3ea98182c29cab229586817cace873e331ba499
- 1787658098 M2 start — additive schema successor for posts/follows/feeds; no destructive reseed
- 1787658263 knowledge-lookup served guide SNAPBACK_APP_BINDING_IDENTITY_MISMATCH / clients/react-expo.md#diagnose-a-binding-identity-mismatch
- 1787658263 lifecycle startup-successor-activated continuity preserved; old schemaHash …2d884c32… → new …f6d3f2a1… (evidence: snapback.dev.v1 startup-successor-activated)
- 1787658400 M2 starter replay 52 actions ok through generated mutations (scripts/replay.mjs)
- 1787659000 correction-loop snapback-defect SNAPBACK_APP_BINDING_IDENTITY_MISMATCH after successor; Expo extra still named M1 descriptor 5204d9d4; lifecycle pid 3605743 stdin /dev/null so reload/restart not deliverable. evidence: clique boot fallback + /proc/3605743/fd/0 -> /dev/null
- 1787659243 M2 capability-failure (web authoring green blocked); M3 blocked-by-M2
- 1787659243 closing lifecycle owner pid 3605743 via SIGTERM (not pkill/killall)
end=1787659243
