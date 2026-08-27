lane id=sol-convex
model=sol
effort=xhigh
backend=convex-1.45.0
start=1787852644
1787852644 run-start source=fixture WEB-ONLY M1-M6+M8; M7 skipped; native iOS/Xcode/Hermes legs environment-null
1787852672 knowledge-lookup source=fixture read authoritative social-messenger brief, CONTRACT, and applicability manifest
1787852720 knowledge-lookup source=fixture read action grammar, UI-kit contracts, screen composition, choreography README/runbook/source, and atomic assertion manifest
1787852730 knowledge-lookup source=web official Convex documentation lookup attempted for local deployments, auth, Expo, and cron (browser returned no page body)
1787852745 knowledge-lookup source=package-source resolved registry metadata convex=1.45.0, expo=57.0.17, expo-router=57.0.17
1787852790 M1-start source=fixture accounts and profiles
1787852810 M1-error source=diagnostic npm ETARGET for nonexistent expo-status-bar~57.0.8
1787852820 M1-retry source=package-source corrected Expo companion package pins to published versions
1787852830 M1-error source=diagnostic npm file dependency tried to create node_modules inside read-only frozen UI kit
1787852840 M1-workaround source=package-source enabled npm install-links so the frozen kit is packed into the lane instead of mutated
1787852900 knowledge-lookup source=package-source inspected Convex 1.45.0 CLI anonymous deployment selection and local port controls
1787853338 server-start source=diagnostic kind=convex-cli pid=2835628 child=2835659 backend-pid=2835697 ports=48200,48202
1787853370 M1-error source=diagnostic Convex generated-table union inference produced nine TypeScript errors on generic db.get helper results
1787853380 M1-retry source=package-source narrowed db.get results at typed table call sites; retained package typecheck
1787853550 M1-error source=diagnostic app typecheck exposed React Native 0.87 StyleSheet type incompatibility with frozen UI kit authored/tested on 0.86.2
1787853560 M1-retry source=package-source pinned react-native=0.86.2 to the kit's published dev pin and excluded the read-only instrument tree from lane compilation
1787853990 M1-green-candidate source=diagnostic suite-required acceptance passed with complete atomic coverage receipt=receipts/suite-m1.json
1787854109 server-start source=diagnostic kind=expo-web pid=2841556 shell-pid=2841583 metro-pid=2841584 port=48201
1787854190 M1-failure source=diagnostic choreography logout/relogin timed out after prior revoked-token query result cleared the newly stored session
1787854200 M1-retry source=diagnostic removed stale-query auto-clear race; explicit logout remains server-revoking and storage-clearing
1787854240 M1-failure source=diagnostic choreography relogin succeeded but remained on /settings, which intentionally has no authenticated-surface selector accepted by harness
1787854250 M1-retry source=fixture changed successful auth landing to the contracted root feed surface
1787854310 server-stop source=diagnostic kind=expo-web pids=2841556,2841583,2841584 reason=force fresh Metro bundle after auth landing correction
1787854340 M1-error source=diagnostic non-CI Expo restart aborted because React Native DevTools sandbox and xdg-open are unavailable on host
1787854355 M1-workaround source=diagnostic restarted Metro with CI, devtools disabled, and cleared cache
1787854355 server-start source=diagnostic kind=expo-web pid=2843947 shell-pid=2843986 metro-pid=2843987 port=48201
1787854398 M1-green source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m1.json,receipts/choreo-m1.jsonl first-green-wall=1608s
1787854398 M2-start source=fixture posts and follow graph
1787854415 M2-error source=diagnostic segmented replay opened M2 without carrying M1's in-memory password map and used sample credentials
1787854425 M2-retry source=fixture replay adapter now resolves starter actor passwords from personas.json independently for every segment
1787854735 milestone=M2 choreography=failure source=diagnostic outcome=application correction-loop=2 details="frozen M2 misses: composer media semantic value absent at runtime; profile follow flow stranded without feed tabs; repost attribution semantic value absent; thread route exposed duplicate compose IDs"
1787854938 server-stop source=diagnostic kind=expo-web pids=2843947,2843986,2843987 reason=fresh bundle for M2 UI-contract corrections
1787854943 M2-workaround source=diagnostic frozen UI kit passes accessibilityValue to roleless React Native Web nodes but runtime omits aria-valuetext; app shell now restores exact semantic metadata without changing kit component contracts
1787854943 server-start source=diagnostic kind=expo-web pid=2847703 shell-pid=2847731 metro-pid=2847732 port=48201
1787855014 M2-retry source=diagnostic live browser preflight confirmed exact attachment/avatar semantics, profile-to-feed tab navigation, and one unique thread composer; rerunning frozen choreography
1787855139 M2-failure source=diagnostic correction-loop=3 details="all frozen checks passed except remote feed image/video semantics; React Native Web kit media dropped aria-valuetext and rendered Image as CSS background rather than harness-required img"
1787855150 M2-workaround source=diagnostic app-owned web adapter preserves the frozen FeedCard contract while adding accessible media value and a byte-loaded img inside its media surface
1787855188 server-stop source=diagnostic kind=expo-web pids=2847703,2847731,2847732 reason=fresh bundle for final M2 media correction
1787855194 server-start source=diagnostic kind=expo-web pid=2849716 shell-pid=2849744 metro-pid=2849745 port=48201
1787855220 M2-retry source=diagnostic browser preflight confirmed remote image/video values and loaded image elements; rerunning frozen choreography
1787855308 M2-green source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m2.json,receipts/choreo-m2.jsonl first-green-wall=910s
1787855320 M3-start source=fixture direct and group chat, presence, typing, receipts, membership lifecycle
1787855340 M3-green-candidate source=diagnostic suite-required acceptance passed with complete atomic coverage receipt=receipts/suite-m3.json
1787855426 M3-failure source=diagnostic correction-loop=1 details="membership lifecycle reached add-member candidate, whose kit accessibilityValue was omitted by React Native Web"
1787855440 M3-workaround source=diagnostic settings web adapter restores exact candidate/member/color/disappearing semantic values and background state without changing frozen component contracts
1787855480 server-stop source=diagnostic kind=expo-web pids=2849716,2849744,2849745 reason=fresh bundle for M3 settings semantics
1787855487 server-start source=diagnostic kind=expo-web pid=2851965 shell-pid=2851993 metro-pid=2851994 port=48201
1787855545 M3-retry source=diagnostic rerunning frozen choreography after exact settings semantic adapter
1787855628 M3-failure source=diagnostic correction-loop=2 details="Remove control write was abandoned by immediate full-page navigation; Dave stayed active and correctly received the later message"
1787855660 M3-workaround source=package-source membership removal now uses Convex 1.45.0 HTTP mutation envelope with fetch keepalive, preserving the initiated authority write across navigation
1787855790 server-stop source=diagnostic kind=expo-web pids=2851965,2851993,2851994 reason=fresh bundle for durable membership cutoff
1787855797 server-start source=diagnostic kind=expo-web pid=2854601 shell-pid=2854629 metro-pid=2854630 port=48201
1787855810 M3-retry source=diagnostic rerunning frozen membership lifecycle with navigation-durable removal
1787855881 M3-failure source=diagnostic correction-loop=3 details="server cutoff excluded the new message, but removing the inactive group from listConversations also erased retained history from Dave's already-open group screen"
1787855900 M3-retry source=diagnostic conversation screen now retains its resolved conversation identity after membership cutoff so the inactive-member query can continue rendering server-bounded history
1787855930 server-stop source=diagnostic kind=expo-web pids=2854601,2854629,2854630 reason=fresh bundle for retained cutoff history
1787855937 server-start source=diagnostic kind=expo-web pid=2855412 shell-pid=2855442 metro-pid=2855443 port=48201
1787855995 M3-failure source=diagnostic correction-loop=4 details="retained listMessages result was masked because the parallel typing subscription rejected inactive membership and tripped the screen query boundary"
1787856010 M3-retry source=diagnostic inactive retained viewers now receive an empty typing projection while their server-cutoff message history remains readable
1787856094 M3-green source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m3.json,receipts/choreo-m3.jsonl first-green-wall=774s
1787856110 M4-start source=fixture chat media, reactions, edit/delete authority and windows
1787856120 M4-green-candidate source=diagnostic suite-required acceptance passed with complete atomic coverage receipt=receipts/suite-m4.json
1787856151 M4-green source=diagnostic suite=pass choreography=pass receipts=receipts/suite-m4.json,receipts/choreo-m4.jsonl first-green-wall=41s
1787856170 M5-start source=fixture synchronized settings, view-once/disappearing, search/offline, and scale replay
1787856180 M5-green-candidate source=diagnostic suite-required acceptance passed with complete atomic coverage receipt=receipts/suite-m5.json
1787856418 M5-failure source=diagnostic correction-loop=1 details="frozen M5 misses limited to remote selected-color state and async view-once viewer's nested loaded-image shape; disappearing and warm-offline search passed"
1787856440 M5-workaround source=diagnostic settings adapter now exposes exact pressed color and byte-loaded background preview; async image viewer now mounts a stable container with a nested img
1787856465 server-stop source=diagnostic kind=expo-web pids=2855412,2855442,2855443 reason=fresh bundle for M5 web media/state surfaces
1787856471 server-start source=diagnostic kind=expo-web pid=2859434 shell-pid=2859462 metro-pid=2859463 port=48201
1787856480 M5-retry source=diagnostic rerunning frozen long-window segment after live-state and viewer corrections
1787856741 M5-failure source=diagnostic correction-loop=2 details="view-once first view and server state succeeded, but disabled opened affordance lost exact accessibilityValue and therefore exposed neither accepted opened token nor a second server refusal"
1787856760 M5-workaround source=diagnostic conversation web adapter restores exact view-once, receipt, and conditional sender-avatar semantic tokens from live message state
1787856770 server-stop source=diagnostic kind=expo-web pids=2859434,2859462,2859463 reason=fresh bundle for exact view-once state
1787856776 server-start source=diagnostic kind=expo-web pid=2861339 shell-pid=2861367 metro-pid=2861368 port=48201
1787856785 M5-retry source=diagnostic rerunning frozen long-window segment with exact opened token
1787856834 M5-error source=diagnostic same background fixture was already persisted by the prior retry, so a repeated deliberate selection produced no changed remote state
1787856920 M5-workaround source=diagnostic each background selection now carries a fragment selection revision while retaining identical fixture bytes and rendering
1787857053 server-stop source=diagnostic kind=expo-web pids=2861339,2861367,2861368 reason=fresh bundle for repeatable background selection
1787857059 server-start source=diagnostic kind=expo-web pid=2863022 shell-pid=2863035 metro-pid=2863036 port=48201
1787857065 M5-retry source=diagnostic final frozen long-window rerun after repeat-selection correction
1787857275 M5-green-candidate source=diagnostic functional suite=pass choreography=pass receipts=receipts/suite-m5.json,receipts/choreo-m5.jsonl; O5 scale replay remains
1787857350 knowledge-lookup source=fixture read frozen scale artifact hashes, checkpoint named fixtures, manifest verification mechanics, k=20 probe rules, and four-hour safety cap
1787857460 knowledge-lookup source=package-source Convex 1.45.0 self-host selection, local backend arguments, HTTP function envelope, and isolated storage mechanics
1787857664 server-start source=diagnostic kind=convex-scale-backend pid=2867207 cloud-port=48204 site-port=48206 storage=.convex/scale
1787857695 M5-error source=package-source raw instance secret is not a Convex admin key; derived scale-agent admin key with published local-backend keygen command
1787857710 M5-workaround source=package-source deployed exact current functions to isolated backend through hidden --url/--admin-key selection, then restored dev .env.local after CLI rewrote it
1787857730 M5-scale-start source=fixture fresh-backend starter-plus-scale replay cap=14400000ms expected-actions=167157 checkpoints=10%,50% ports=48204,48206
1787858020 M5-scale-error source=diagnostic attempt=1 checkpoint=10% settled=24777 details="self-authored verifier compared JSON object insertion order; bounded actual named fixture values were exact but Convex serialized keys canonically"
1787858040 M5-scale-retry source=diagnostic preserved attempt-1 receipt and changed verifier to recursive key-order-independent exact comparison; restarting on a new fresh isolated backend
1787858113 server-stop source=diagnostic kind=convex-scale-backend pid=2867207 reason=attempt-1 verifier correction
1787858127 server-start source=diagnostic kind=convex-scale-backend pid=2869561 cloud-port=48204 site-port=48206 storage=.convex/scale-r2 beacon=disabled
1787858138 M5-scale-retry source=diagnostic attempt=2 new fresh backend deployed and dev .env.local restored
1787859805 M5-scale-error source=diagnostic attempt=2 replay-settled=167157 replay-elapsed=1643694ms checkpoints=pass details="final spot verifier distinguished omitted optional text-message media from manifest null; all entity values otherwise exact"
1787859830 M5-scale-retry source=diagnostic preserving full replay clock/checkpoints and resuming final verification on the already-complete fresh backend after null-normalization correction
1787860050 M5-scale-error source=diagnostic first resumed final probe pass reached degradation-rule evaluation after exact pre-probe named and spot verification, but the resume error path failed to persist per-probe details
1787860142 M5-scale-retry source=diagnostic rerunning bounded probes to persist exact rule evidence; preserving prior failure and explicitly accounting for the first pass's 23 receipt-message and 23 celebrity-post probe artifacts
1787860231 M5-scale-complete source=diagnostic settled=167157 replay-wall=1643694ms cap-utilization=11.4% invariants=pass rules=8/9 performance-outcome=O5-band-30 details="Trending 50% p95 1.233ms exceeded 0.964ms linear midpoint ceiling; no timeout/error/OOM"
1787860231 M5-green source=diagnostic suite=pass choreography=pass receipt=receipts/choreo-m5.jsonl wall=4061s scale-replay=attempted-and-complete scale-performance=degradation-failure
1787860253 M6-start source=fixture milestone=custom-client-push-offline-proof web-only-native=environment-null safety-cap=14400s
1787860282 M6-green source=diagnostic suite=pass choreography=pass receipt=receipts/choreo-m6.jsonl wall=29s native-ios=environment-null
1787860282 M6-boundary source=model-knowledge writing qualitative essay before any scoring or final metric tally
1787860341 M8-start source=fixture milestone=insights-trending-durable-offline-convergence web-only-native=environment-null safety-cap=14400s
1787860456 M8-error source=diagnostic suite=pass choreography=fail assertions=m8-a02-insights-like-refresh,m8-a14-cross-device-read-state details="React Native Web omitted frozen kit accessibilityState/accessibilityValue attributes from like controls and chat rows"
1787860456 M8-retry source=diagnostic application wrapper now restores exact aria-selected like state and aria-valuetext chat identity without changing frozen UI-kit contracts
1787860623 server-stop source=diagnostic kind=expo-web pids=2863022,2863035,2863036 reason=stale-Metro-lazy-module-cache
1787860623 M8-workaround source=diagnostic restarted only recorded Expo process tree with empty cache after fresh pages continued receiving pre-patch DOM
1787860623 server-start source=diagnostic kind=expo-web pids=2884167,2884181,2884182 port=48201 cache=cleared
1787860716 M8-green source=diagnostic suite=pass choreography=pass receipt=receipts/choreo-m8.jsonl wall=375s native-ios=environment-null
1787860716 knowledge-lookup source=diagnostic resolved package tree confirms convex=1.45.0 expo=57.0.17 expo-router=57.0.17 react-native=0.86.2 react-native-web=0.21.2
1787860716 M8-boundary source=model-knowledge extending qualitative essay before dimension or holistic scoring
1787860740 scoring-step-2 source=diagnostic dimension scores recorded in dimension-scores.json after completed essay and before holistic; no total computed
1787860825 scoring-step-3 source=model-knowledge independent holistic=74 recorded after dimensions and before final-report metrics; not computed from dimensions and no total computed
1787860898 final-validation source=diagnostic typecheck=pass scores-json=pass scale-receipt-shape=pass starter-and-sample-log-validation=pass env-restored=true
1787860907 server-stop source=diagnostic kind=expo-web pids=2884167,2884181,2884182 reason=run-complete
1787860911 server-stop source=diagnostic kind=convex-scale-backend pid=2869561 reason=run-complete clean-shutdown=true
1787860918 server-stop source=diagnostic kind=convex-cli pids=2835628,2835659,2835697 reason=run-complete
1787860920 final-cleanup source=diagnostic all recorded final server PIDs exited and ports=48200,48201,48202,48204,48206 are clear
1787860947 final-report source=diagnostic final-report.md written after scores with raw timing, receipts, corrections, pins, token availability, and gaps; no weighted total computed
1787861027 final-artifact-validation source=diagnostic strict JSON parsing, report terminator, run-log identity, no score-total field, and cleared recorded ports all verified
end=1787861027
