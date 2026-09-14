lane id muse-clique-snapback4-full-20260913
model muse-spark-1.3
effort=xhigh
backend=snapback4-0.2.6
start=1789346454
1789346454 lane-start instrument-read-begin
1789346477 milestone m1-start
snapback4-exact-pin snapback4@0.2.6 (source: prompt)
snapback4-expo-exact-pin snapback4-expo@0.2.1 (source: prompt)
1789346485 knowledge-lookup snapback4-readme-start source=package-README
1789347472 correction-loop sync-proof-failures attributions-pending evidence=check-output
1789347534 correction-loop schema-compile-errors iterations=6 attribution=agent-error evidence=snapback4-check-E_SYNC-E_QUARRYXXX my created-members branch was self-justifying, README example was accurate
1789347843 correction-loop digest-upsert-hidden-collision iterations=8 attribution=ambiguous evidence=scratch-repro-fol2-twice README-collision-rule hidden-row-upsert-refuses-E_RULE fix=public-read-counters
1789347948 smoke-50-50 backend-wire-ok evidence=scripts-smoke.mjs
1789347948 knowledge-lookup upsert-hidden-collision source=diagnostic+package-README-collision-rule attribution=ambiguous
1789348549 server-pids backend=84007 web=14901 ports=49300,49301 evidence=lsof
1789348640 server-pids web-restart=28867 flags=-s evidence=lsof
1789348742 kit-contract-drift sm-auth-toggle-renamed-to-sm-auth-mode-toggle attribution=ambiguous evidence=CONTRACT-vs-ui-kit-0.3.3-audit
1789349079 workaround host-ffmpeg-broken fallback=fixture-PNG-poster attribution=environment evidence=dyld-libx265-missing
1789349115 correction-loop dedupe-poison wire-ids-recorded-NOT_FOUND-during-broken-schema-era fix=namespace-bump-sd1 attribution=agent-error evidence=manual-fresh-id-succeeds
1789349283 server-pids backend=14417 evidence=lsof-restart-noted
1789349283 server-pids web=28867 evidence=lsof
1789351005 milestone m1-green checks=10/10 evidence=tests-accept.mjs
1789351005 milestone m2-green checks=31/31 evidence=tests-accept.mjs
1789351005 correction-loop feed-unfollow-unrepost-purge attribution=agent-error evidence=m2-a08-a18-schema-retracts iterations=3 fix=purge-direct-hits-sync+retracts-job+client-filter-pending
1789351171 milestone m3-green checks=9/9 evidence=tests-accept.mjs
1789351895 correction-loop seed-shape-mismatch attribution=agent-error evidence=seed-E_INPUT-appConfig-empty iterations=1 fix=array-shape+fail-loud+rows-posted
1789352119 milestone m4-green checks=14/14 evidence=tests-accept.mjs
1789352522 milestone m5-partial checks=15/16 evidence=tests-accept.mjs
1789353072 milestone m5-green checks=16/16 evidence=tests-accept.mjs
1789354061 milestone live-green checks=14/14 evidence=tests-accept.mjs
1789354061 correction-loop social-sync-blindness attribution=agent-error evidence=live-a04-a06-schema-sync iterations=4 fix=sync-public-follows-likes-reposts-replies+entryCard-counts+onPick-prop
1789354831 milestone m6-green checks=13/13 evidence=tests-accept.mjs
1789355969 milestone m8-green checks=19/19 evidence=tests-accept.mjs
1789355969 correction-loop fanout-double-bump attribution=agent-error evidence=m8-a04-p2-schema-job iterations=1 fix=job-skips-bucket0
1789356017 milestone m2-34-34 checks=34/34 evidence=tests-accept.mjs
1789356300 correction-loop replay-target-resolution attribution=agent-error evidence=sample-50-27-50-handle-miss fix=resolve-actor-sessions-first-then-handle
1789356400 correction-loop replay-wire-replay-poison attribution=ambiguous evidence=replayed-true-fresh-retry fix=per-process-nonce-retry-wire
1789356600 milestone replay-sample-green actions=50/50 evidence=scripts-replay.mjs
1789356900 scale-run-1 actions=36809 ok=33696 failed=3113 evidence=coverage-scale-replay.json
1789357246 correction-loop asset-cache-violates-one-asset-one-home attribution=agent-error evidence=E_ASSET_PLACED-3113 fix=remove-caches+fresh-uploads+E_ASSET_PLACED-recovery
1789357246 native-artifact ios-hermes-bundle entry-d8eceecda9531af8fd760c0b3e0d2d1c.hbc bytes=2785799 sha256=524753cb463295268bd7d9b3941ac3260beb871a52ae40e0167cb95ec5c16a86 evidence=app-host/clique/dist-ios
1789360100 correction-loop verifier-paging-complete-semantics attribution=ambiguous evidence=chat-count-got-50 fix=follow-next-cursor-not-complete
1789360100 correction-loop verifier-login-rate-limit attribution=environment evidence=E_RATE_LIMIT-u271 fix=10s-backoff-login
1789360100 correction-loop generator-celebfollower-leak attribution=agent-error evidence=u001-got-10-want-5 fix=exclude-u001-from-base-graph
1789361200 correction-loop generator-churn-cleared-fixture-edge attribution=agent-error evidence=u001-got-4-want-5 fix=churn-skips-celebfollower-edges
1789360600 milestone scale-green actions=36804/36804 verify=88/88 wall=713.1s evidence=coverage-scale-replay.json+coverage-scale-verify.json
1789361800 correction-loop video-send-local-replica-duration attribution=ambiguous evidence=E_FIELD-missing-field-duration fix=uploadVideo-duration-hint+attach-send-race-guard
1789362000 milestone m4-green-again checks=14/14 evidence=tests-accept.mjs-only-m4
1789362100 dev-rebootstrap fresh-store pid=96584 reason=residue-fragile-m5-search evidence=accept-clean
1789362200 correction-loop worker-token-dead-after-rebootstrap attribution=environment evidence=E_AUTH-worker fix=mint-fresh-pusher-token
1789362600 milestone clean-full-green m1-m5-live=green m6-m8=32/32 evidence=tests-accept.mjs
1789362700 milestone replay-sample-green-fresh actions=50/50 evidence=coverage-sample-50.json
1789362750 native-artifact ios-hermes-bundle entry-d0e6db042514d967203b0330f6580997.hbc bytes=2788000 sha256=930026f767d40177a7e04b2030ff3d1baff98c6791c5eee8136a0c8ee78d8639 evidence=app-host/clique/dist-ios
1789364000 infra-reap backend+web+worker SIGTERMed evidence=runtime-terminal-143 fix=restart-all verified-push-delivery
1789364000 server-pids backend=38562 web=44902 ports=49300,49301 evidence=lsof
