# run-log.md

lane id: grok-clique-familiar
model: grok-4.6
effort=xhigh
backend=snapback-familiar-0.1.27
start=1787656057

- 1787656057 knowledge-lookup orientation BENCHMARK-ORIENTATION.md + AGENTS.md (source: lane files)
- 1787656057 knowledge-lookup skill allowlist snapback-authoring (source: skills/snapback-authoring/SKILL.md)

- 1787656359 first-product-edit stamped at=2026-08-25T11:12:39.000Z orientationBytes=14893 selectedSkills=[snapback-authoring]
- 1787656359 knowledge-lookup Familiar TypeScript profile (source: served guide backend/familiar-profile.md extracted from published @expo/snapback-runtime-linux-x64@0.1.27)
- 1787656359 knowledge-lookup expo-chat start packet (source: packaged template AGENTS.md / start/expo-chat.md)
- 1787656359 knowledge-lookup sessions-and-principals + app-identity-binding (source: served guide)
- 1787656359 knowledge-lookup package types ctx.d.mts define.d.ts familiar.d.mts (source: package types)
- 1787656359 M1 start
- 1787656359 scaffold snapback new clique --template expo-chat (source: packaged CLI)

- 1787657026 knowledge-lookup snapback generate succeeded familiar profile (source: served codegen / package types)
- 1787657026 lifecycle-owner start command=`env -u CI snapback dev snapback --expo --expo-platform web --port 48100 --port-range 48100-48119 --json` cwd=clique pid=2110880 backend-pid=2110936 metro-pid=2110971 ready=http://127.0.0.1:48100 expo=http://127.0.0.1:48119 application-ready=clique/.snapback/dev.ready.json.application-ready
- 1787657026 note CI=true inherited; unset for lifecycle owner (attribution: environment)

- 1787658472 M1 suite green npm run acceptance -- --milestone m1 (headless write-path replay + assertions)
- 1787658472 M1 choreography green receipts/m1/choreography.jsonl green=true nonGreenCause=null
- 1787658472 M1 green suite+choreo
- 1787657026..1787658472 correction-loop SessionGate signOut killed supervised provider SNAPBACK_AUTH_SESSION_EXPIRED (attribution: snapback-defect, evidence: EXPO_PUBLIC_SNAPBACK_URL not injected; supervisor mints session). Workaround: URL-first SnapbackProvider using supervisor bootstrap origin only.
- 1787658472 correction-loop profile edit saved empty handle (attribution: agent-error). Fix: wait for getMine before rendering edit form.
- 1787658472 correction-loop choreography import.meta.url vs instrument symlink (attribution: environment). Workaround: scripts/run-choreography.mjs realpath + ESM alias for playwright.
- 1787658472 knowledge-lookup SNAPBACK_AUTH_STALE_RESULT (source: served guide)
- 1787658472 M2 start

- 1787658800 lifecycle-owner died SNAPBACK_EXPO_METRO_EXITED metro watch ENOENT on codegen tmp generation dir (attribution: snapback-defect, evidence: expo-dev log SNAPBACK_EXPO_METRO_EXITED). Restarting same `snapback dev` against existing dev.sqlite3 (no reseed).
- 1787658800 M1->M2 schema successor old=snapback.v1:sessions:schema:sha256:4969b7142ec9fbec19aa4f71f48b183cb611d222dbeb2f78e4b5fdff02f608bf new=snapback.v1:sessions:schema:sha256:2000d509c58f2a1d4ffa7bb5d2a88787ec9bd6e115d316208464edb474b33337 functions old=a70acf078c8ca935224bf5decdc3ee8139049569db7ac5a273209bf5e6305f1d new=cb2724f9fc702d8fac15078e7ae78d647a32936f1f1a2acd0c847ba8a9376dda

- 1787660019 M2 suite green receipts/m2/suite-status.json pass=true
- 1787660019 M2 choreography green receipts/m2/choreography.jsonl green=true nonGreenCause=null required 7/7 passed
- 1787660019 M2 green suite+choreo
- 1787658800..1787660019 correction-loop FlatList items hidden on RN-web; FeedTabs missing off feed; router.push stacked copies; thread composer fill timeout (attribution: agent-error). Fix: ScrollView+map, FeedTabs in AppChrome, router.replace, composer at top of thread.
- 1787660019 correction-loop m2-a11 Bob still follows Dave from seed (attribution: agent-error). Fix: use Frank as unfollowed author.

- 1787660200 M3 start
- 1787660200 lifecycle-owner died SNAPBACK_EXPO_METRO_EXITED after M3 generate (attribution: snapback-defect). Restart same `snapback dev` against existing dev.sqlite3 (no reseed).
- 1787660259 lifecycle-owner restart command=`env -u CI snapback dev snapback --expo --expo-platform web --port 48100 --port-range 48100-48119 --json` cwd=clique pid=2118533 backend-pid=2118625 metro-pid=2118790 ready=http://127.0.0.1:48100 expo=http://127.0.0.1:48119 application-ready=clique/.snapback/dev.ready.json.application-ready
- 1787660260 M2->M3 schema successor old=snapback.v1:sessions:schema:sha256:2000d509c58f2a1d4ffa7bb5d2a88787ec9bd6e115d316208464edb474b33337 new=snapback.v1:sessions:schema:sha256:77ba0eacd96b42f6e0e5db3789d62547c4076c838296ebd697afe8ebb2d153c1 functions new=snapback.v1:sessions:function:sha256:51f07610751d2b64567eb75859b7496099177a2aba2484e7f84521facfe14127
- 1787660792 knowledge-lookup useSnapbackActivityPresence idleMs/touch/withdraw (source: package types @expo/snapback-react index.d.mts + implementation.mjs). Do not use @expo/snapback-expo wrapper: it requires SnapbackExpoLifecycleContext which URL-first SnapbackProvider does not provide.
- 1787660792 knowledge-lookup M3 choreography selectors sm-chats-item / sm-convo-bubble / sm-convo-quote / sm-convo-quote-preview / sm-convo-typing (source: instrument choreography.mjs + CONTRACT.md)
- 1787660792 native iOS Simulator / Xcode / Hermes export environment-null on this Linux host (out of scope)
- 1787660835 M3 suite green npm run acceptance -- --milestone m3 receipts/m3/suite.json
- 1787660890 M3 choreography failed typing-indicator-within-2s-expires-within-5s visible~2340ms ceiling 2000ms (expires ok ~1788ms) (attribution: agent-error, evidence: receipts/m3/choreography.jsonl). Live DM + quote-jump passed.
- 1787661214 correction-loop native keydown/input listeners in ConversationScreen called presence.touch() which force-rendered the controlled composer and left sm-convo-send disabled (attribution: agent-error, evidence: choreo click timeout on disabled send). Isolated typing into TypingLayer so presence renders cannot reset draft.
- 1787660890..1787662000 correction-loop typing visibleMs 2.3–2.7s vs 2000ms ceiling (attribution: agent-error, evidence: receipts/m3/choreography.jsonl prior runs; debug pressSequentially of 45-char run id took 2722ms while ConversationScreen setState rerendered AppChrome). Fixes: publish typing once per burst (do not generation-bump every key); isolate MessageComposer so keystrokes do not rerender the chrome. Isolated pressSequentially ~1431ms.
- 1787660835 M3 suite first-green receipts/m3/suite.json required m3-a03,a04,a05,a10,a11,a14,a15
- 1787662000 M3 choreography green receipts/m3/choreography.jsonl green=true nonGreenCause=null required 2/2 passed (dm-live-messages, typing); quoted-reply passed optional; 4 skipped unimplemented (not required)
- 1787662000 M3 green suite+choreo
- 1787662178 lifecycle-owner close SIGINT pid=2118533 (no pkill/killall); children 2118625/2118790 exited; ports 48100-48119 clear
end=1787662178

