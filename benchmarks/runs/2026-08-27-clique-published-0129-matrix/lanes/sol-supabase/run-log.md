lane id=sol-supabase
model=sol
effort=xhigh
backend=supabase-2.112.4
start=1787852658
1787852658 run-start source=fixture scope=WEB-ONLY M1-M6+M8; M7 not-run; native legs environment-null
1787852693 knowledge-lookup source=fixture read authoritative brief, coordination contract, assertion applicability, action grammar, UI-kit contracts, and choreography runbook
1787852790 milestone-start M1 source=fixture accounts-and-profiles
1787853088 knowledge-lookup source=published-docs official Supabase Expo auth, RLS, Realtime Broadcast/Postgres Changes, and database-function guidance
1787853088 knowledge-lookup source=package-source resolved expo=57.0.17 expo-router=57.0.17 react-native=0.87.1 supabase-cli=2.116.0 and required supabase-js=2.112.4
1787853090 error M1 source=package-source npm peer resolution required react 19.2.3 for react-native 0.87.1
1787853090 retry M1 source=diagnostic align react/react-dom to 19.2.3
1787853104 error M1 source=package-source requested react-native-safe-area-context version was unpublished
1787853107 retry M1 source=package-source resolved Expo peer packages from npm registry
1787853123 error M1 source=diagnostic npm file dependency attempted to mutate the read-only instrument UI-kit tree
1787853130 workaround M1 source=package-source packed frozen UI kit 0.3.2-m8 into a lane-local immutable tarball dependency
1787853500 error M1 source=diagnostic TypeScript 7 produced incompatible React Native style inference and revealed TrendingRow prop misuse
1787853500 retry M1 source=package-source align compiler to frozen kit's TypeScript 5.x contract and pass TrendingRow's frozen post prop
1787853550 error M1 source=diagnostic latest React Native 0.87.1 was newer than Expo 57's bundled 0.86.3 and broke frozen-kit style types
1787853550 retry M1 source=package-source align native peers to Expo 57 bundledNativeModules pins
1787853770 server-start source=diagnostic pid=2838171 port=48300 purpose=Expo-Router-web
1787853772 error M1 source=diagnostic pid=2838171 exited because Expo attempted unavailable xdg-open on headless host
1787853772 retry M1 source=model-knowledge restart Expo with CI=1 to suppress browser launch
1787853780 server-start source=diagnostic pid=2838393 port=48300 purpose=Expo-Router-web-CI
1787853845 failure M1 source=diagnostic suite=pass choreography=fail assertion=logout-remains-signed-out-on-relaunch
1787853870 correction-loop M1 source=diagnostic re-login retained /settings route so the required authenticated feed/chat surface never appeared; route reset added after authentication
1787853920 server-processes source=diagnostic root-pid=2838393 shell-pid=2838421 node-pid=2838422 port=48300
1787853930 server-stop source=diagnostic sent TERM only to recorded root pid=2838393 for code-reload restart; descendants exited
1787853940 server-start source=diagnostic root-pid=2840184 shell-pid=2840212 node-pid=2840213 port=48300 purpose=Expo-Router-web-watch
1787853953 green M1 source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m1.json,receipts/choreography-m1-r2.jsonl first-green-wall=1295s correction-loops=1
1787853953 milestone-start M2 source=fixture posts-follow-graph-feeds
1787854200 error M2 source=diagnostic idempotent starter replay's Storage upsert required an UPDATE policy in addition to INSERT
1787854200 retry M2 source=model-knowledge add lane-prefixed authenticated-owner Storage update policy and reapply schema
1787854400 failure M2 source=diagnostic suite=pass choreography=aborted-after-red attachment semantics and post-profile feed return failed
1787854400 correction-loop M2 source=diagnostic added React-Native-Web semantic bridge for frozen accessibilityValue contracts and persistent cross-screen feed-tab routes
1787854510 error M2 source=diagnostic first semantic MutationObserver rewrote identical attributes recursively and starved file-input settlement
1787854510 retry M2 source=diagnostic make accessibility shims idempotent before observing attribute changes
1787854900 failure M2 source=diagnostic suite=pass choreography=aborted-after-red video attachment preview never loaded because the frozen Composer renders an Image surface
1787854900 correction-loop M2 source=fixture supply a deterministic image poster to the frozen Composer while retaining the fixture MP4 for upload
1787855050 error M2 source=diagnostic feed hydration crossed the choreography timeout because signed avatar/media URL creation was serialized
1787855050 correction-loop M2 source=model-knowledge parallelize independent signed-URL and profile enrichment requests
1787855400 failure M2 source=diagnostic suite=pass choreography=red viewer repost disambiguation saw a persisted direct follow projection
1787855400 correction-loop M2 source=diagnostic profile rendered before asynchronous following-state hydration, so the harness clicked set instead of clear; gate profile render on fully loaded counts/follow state
1787855550 failure M2 source=diagnostic suite=pass choreography=red thread composer locator matched active Thread plus inactive Stack-retained Home
1787855550 correction-loop M2 source=package-source switch Expo Router root layout from history-retaining Stack to Slot so frozen test IDs remain unique per active route
1787855900 failure M2 source=diagnostic suite=pass choreography=red follow/global projection was overwritten by a slower feed request from the prior tab
1787855900 correction-loop M2 source=model-knowledge add monotonic request generation so stale async feed hydration cannot overwrite the latest tab projection
1787856200 failure M2 source=diagnostic suite=pass choreography=red feed projection and live like refresh exceeded hosted round-trip tolerance
1787856200 correction-loop M2 source=model-knowledge cache short-lived private Storage signed URLs below their expiry so Realtime refreshes fetch only changing relational state

- ts=1787856376 source=diagnostic event=error milestone=M2 detail="inspection command had an unmatched path quote; no product state changed"

1787858493 green M2 source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m2.json,receipts/choreography-m2-r12.jsonl first-green-wall=4540s correction-loops=12
1787858493 milestone-start M3 source=fixture realtime-messenger-groups

1787859210 failure M3 source=diagnostic suite=pass choreography=red DM composer became visible before the authenticated sender id was ready, making immediate sends no-op; full-message hydration also exceeded the live window
1787859210 correction-loop M3 source=model-knowledge gate the composer on sender readiness, render optimistic local messages, append Realtime INSERT payloads immediately, and cache resolved DM ids; isolated two-client delivery=1.4s

1787859590 error M3 source=diagnostic whole-schema retry deadlocked on a Storage policy lock held across active hosted Realtime clients; transaction rolled back
1787859590 retry M3 source=model-knowledge apply only the changed lane-prefixed DM function through the mandated Management API, avoiding unrelated Storage DDL locks

1787859620 failure M3 source=diagnostic choreography-r2 passed DM, typing, and DM receipt; group delivery waited behind Home feed hydration, concurrent first DM creation raced, and custom action buttons were siblings rather than descendants of the frozen bubble selector
1787859620 correction-loop M3 source=diagnostic mark delivered immediately on Home message INSERT, advisory-lock DM pair creation, and make the contract bubble own its action descendants

1787859770 failure M3 source=diagnostic choreography-r3 passed 6/7 implemented checks; page navigation canceled the asynchronous remove-member fetch before Dave became addable again
1787859770 workaround M3 source=published-docs use authenticated Fetch keepalive for membership mutations that intentionally precede frozen page navigation

1787859831 green M3 source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m3.json,receipts/choreography-m3-r4.jsonl first-green-wall=1338s correction-loops=3
1787859831 milestone-start M4 source=fixture rich-messaging

1787859930 error M4 source=diagnostic suite red because Storage upsert requires SELECT as well as INSERT/UPDATE, while pre-message objects were not yet visible through the conversation-linked policy
1787859930 retry M4 source=model-knowledge add a separate lane-prefixed owner SELECT policy; first combined-policy DDL attempt had an unmatched parenthesis and was rejected atomically

1787860160 failure M4 source=diagnostic suite=pass choreography=4/5; frozen media loader captured the absent descendant locator before the viewer's directly-tagged video mounted
1787860160 correction-loop M4 source=fixture make each viewer test-id a stable container whose image/video child can settle after the click

1787860238 green M4 source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m4.json,receipts/choreography-m4-r2.jsonl first-green-wall=407s correction-loops=2
1787860238 milestone-start M5 source=fixture chat-customization-search-disappearing

1787860410 failure M5 source=diagnostic suite=pass choreography=red React Native Web omitted both accessibilityValue and accessibilityState from chat swatches; a later DM open also crossed the hosted timeout
1787860410 correction-loop M5 source=package-source project frozen swatch values/selected states into DOM semantics and resolve the installed Alice/Bob starter DM locally by its stable id

1787860610 failure M5 source=diagnostic choreography-r2 color sync passed but background update could occur before Carol's Realtime subscription reached SUBSCRIBED; second view-once click had neither refreshed state nor an error surface
1787860610 correction-loop M5 source=model-knowledge add low-frequency settings reconciliation and an explicit view-once denial error while the optimistic affordance refresh settles

1787860770 failure M5 source=diagnostic choreography-r3 persisted each background but Carol could not sign it because message-area recipient RLS requires a linked message row
1787860770 retry M5 source=model-knowledge add a separate active-conversation-member SELECT policy for paths referenced as chat backgrounds

1787860800 error M5 source=diagnostic initial background policy used unqualified name, which bound to conversation.name inside the correlated subquery and masked the object as not found
1787860800 retry M5 source=model-knowledge qualify storage.objects.name and replace only the lane policy

1787860980 failure M5 source=diagnostic choreography-r4 still red because ChatSettings exposed controls before current user hydration, producing messages//g-starter uploads; RN Web also renders kit Image as a background div invisible to the frozen img loader
1787860980 correction-loop M5 source=package-source gate settings on current user and bridge the frozen preview with path semantics plus a real loaded img descendant

1787861120 green M5 source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m5.json,receipts/choreography-m5-r5.jsonl web-first-green-wall=882s correction-loops=5
1787861120 scale-start O5 source=fixture fresh-logical-backend cap=14400s diagnostic-bound=2000-actions

1787861634 error O5 source=diagnostic runtime reset removed all lane tables but hosted Auth rejected deletion of a fixture user with a server-side database error; starter and scale-user registrations remained real at the scale boundary
1787861634 failure O5 source=published-service replay stopped nonconforming at settled-prefix=29/167157 when hosted Supabase Auth returned Request rate limit reached; no checkpoint or probe was valid, invariant manifest did not conform, O5-band=0

1787861685 retry O5 source=fixture restore fresh starter-only runtime rows after retaining the nonconforming scale receipt
1787861685 milestone-start M6 source=fixture offline-api-push-sample-replay native=environment-null

1787861925 green M6 source=diagnostic suite=pass choreography=pass native=environment-null receipts=receipts/suite-m6.json,receipts/choreography-m6.jsonl first-green-wall=240s correction-loops=1
1787861925 sequencing source=model-knowledge essay.md written after M6 green and before dimension scoring or final metric tally
1787861953 milestone-start M8 source=fixture insights-trending-multidevice native=environment-null

1787861770 failure M6 source=diagnostic suite=4/5 because sample actor ids differ from their public handles and the replay adapter passed actor id to handle-resolving RPCs
1787861770 correction-loop M6 source=fixture retain the profile-set actor-to-handle map for follow, DM, group, and member verbs

- ts=1787858189 source=diagnostic event=failure milestone=M2 detail="choreography r11 passed 8/9 required browser assertions; viewer-repost projection missed because the tab switch invalidated the in-flight Global refresh"
- ts=1787858189 source=model-knowledge event=correction-loop milestone=M2 detail="optimistically update per-tab caches for repost set/unset and reduce web feed hydration to the newest 30 events; isolated unfollowed-viewer repost rendered exact Bob attribution"

- ts=1787857744 source=diagnostic event=failure milestone=M2 detail="choreography r10 showed both atomic toggles settled, but the initial Following observation captured stale Global cards during async tab hydration"
- ts=1787857744 source=model-knowledge event=correction-loop milestone=M2 detail="cache both feed projections and synchronously project Global cards through the authoritative followed-ID set on tab click; manual exact flow passed follow/change/restore and both Global checks"

- ts=1787857210 source=diagnostic event=correction-loop milestone=M2 detail="removed profile-route feed controls during follow mutation and added an atomic advisory-locked follow toggle RPC; manual two-toggle browser proof restored the exact starting edge"
- ts=1787857210 source=package-source event=workaround milestone=M2 detail="React route transition exposed an empty-feed false-positive window in the frozen choreography; delaying feed controls until the mutation settles prevents route overwrite"

- ts=1787856965 source=diagnostic event=failure milestone=M2 detail="choreography r9 remained red in follow/global projection despite authoritative-edge mutation; isolated browser diagnostic began"
- ts=1787856965 source=diagnostic event=error milestone=M2 detail="first manual two-page diagnostic accidentally shared a browser auth context, so it was discarded"

- ts=1787856466 source=diagnostic event=error milestone=M2 detail="choreography r8 used a non-fixture shared password, leaving contexts on Auth and producing a fatal startup wait; credentials corrected from the frozen personas fixture"
- ts=1787856466 source=diagnostic event=correction-loop milestone=M2 detail="follow control now re-reads the authoritative edge immediately before each reversal mutation"
1787862111 checkpoint M8 source=diagnostic suite=pass tests=3 assertions=6/6 receipt=receipts/suite-m8.json
1787862254 failure M8 source=diagnostic choreography-r1=2/5 pass: like control lacked the frozen observable selected-state attribute and committed Realtime rows briefly coexisted with same-id local pending rows
1787862254 correction-loop M8 source=package-source added a web semantics projection from the frozen control label to data-liked and made pending-to-committed reconciliation idempotent by message id; typecheck=pass
1787862303 green M8 source=diagnostic suite=pass choreography=pass native=environment-null receipts=receipts/suite-m8.json,receipts/choreography-m8-r2.jsonl first-green-wall=350s correction-loops=1
1787862303 milestone-boundary M8 source=model-knowledge diary.md appended and essay.md finalized after M8, before any dimension or holistic score was written
1787862375 knowledge-lookup scoring source=fixture read frozen applicability and 30/60/90 anchors; O5 uses the first-match banded function
1787862408 sequencing source=diagnostic all 16 dimension entries recorded in scores.json before holistic scoring; no weighted total computed or viewed
1787862426 sequencing source=model-knowledge holistic=74 recorded independently after dimensions and before final-report metric tally; no weighted total exists because B8 is null
1787862476 verification source=diagnostic final retained suite/choreography receipts green for M1-M6+M8, typecheck=pass, supabase-js exact-pin=2.112.4, server-http=200; provider-secrets.env remained lane-local and unread in output
1787862492 cleanup source=diagnostic removed only reproducible generated scale.log and sent TERM only to recorded Expo root pid=2840184; shell pid=2840212 and node pid=2840213 exited, ports 48300-48319 clear
1787862590 run-end source=diagnostic final-report.md written after essay, dimensions, and holistic; token totals not surfaced; no weighted total computed because B8 is null
end=1787862590
