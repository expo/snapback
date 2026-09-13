lane id astra-clique-snapback4-full-20260913
model gpt-6-astra
effort=medium
backend=snapback4-0.2.6
start=1789324245
snapback4=0.2.6
snapback4-expo=0.2.1
1789324245 knowledge-lookup source=fixture attribution=environment evidence=instrument/ENVIRONMENT.md action=read-authoritative-instrument
1789324350 milestone-start M1 effective-start=1789324245 orientation-included source=fixture attribution=environment evidence=instrument/social-messenger.md
1789324350 knowledge-lookup source=package-README/guide attribution=environment evidence=node_modules/snapback4/README.md,evidence/guide.txt published-surface-read; exact-pins-installed
1789324350 knowledge-lookup source=fixture attribution=environment evidence=instrument/schema/social-messenger/assertions.json,instrument/ui,instrument/choreography/README.md,instrument/protocol.md
1789324435 server-start name=backend pid=83203 command=node_modules/.bin/snapback4 dev --port 49300
1789324436 server-start name=web pid=83233 command=node_modules/.bin/expo start --web --port 49301
1789324576 correction-loop M1 attribution=agent-error evidence=evidence/m1-acceptance-attempt1.log reason=seed-replay-did-not-retry-documented-E_RATE_LIMIT iteration=1
1789324576 error M1 attribution=environment source=diagnostic evidence=evidence/choreo-m1-startup2.log missing-instrument-json-schema-helper; loader-supplies-AJV-equivalent-validation; frozen-checks-unchanged
1789324576 correction M1 attribution=environment evidence=evidence/choreo-m1-startup2.log actual-default-node=v25.9.0 using-explicit-24.18.0-for-harness
1789324728 error-retry M1 attribution=ambiguous source=diagnostic evidence=evidence/m1-choreo-attempt3.log,evidence/m1-acceptance-attempt3.log reason=concurrent-suite-choreo-auth-startup-timeout; isolated-login-succeeded; rerun-serially
1789324717 milestone-green m1 start=1789324245 evidence=evidence/suite-m1.json,evidence/choreo-m1.jsonl
1789324743 milestone-start M2 source=fixture attribution=environment evidence=instrument/social-messenger.md
1789325074 correction-loop M2 attribution=agent-error source=diagnostic evidence=evidence/m2-suite-attempt1.log reason=millisecond-ties-ordered-by-random-id; added-server-arrival-tiebreak
1789325074 knowledge-lookup M2 source=diagnostic attribution=agent-error evidence=evidence/m2-check1.log,evidence/m2-check3.log reason=ambiguous-exists-index; applied-explicit-byPair
1789325118 server-stop pid=83233 reason=enable-Metro-watch
1789325118 server-start name=web pid=69216 command=node_modules/.bin/expo start --web --port 49301
1789325132 server-start name=web pid=70828 command=node_modules/.bin/expo start --web --port 49301
1789325132 correction-loop M2 attribution=agent-error evidence=evidence/m2-suite-attempt2.log,evidence/web-server.log reason=launcher-CI-disabled-Metro-watch-and-served-M1-bundle; restarted-with-CI-false; iteration=2-empty-string-CI-invalid
1789325226 correction-loop M2 attribution=agent-error source=fixture evidence=evidence/choreo-m2.jsonl reason=feed-tabs-needed-from-profile-and-thread; promoted-feed-navigation-to-shell
1789325368 server-pid-discovered name=backend-binary pid=83224 parent=83203 source=process-child-query
1789325395 milestone-green m2 start=1789324743 evidence=evidence/suite-m2.json,evidence/choreo-m2.jsonl
1789325437 milestone-start M3 source=fixture attribution=environment evidence=instrument/social-messenger.md
1789325836 error-retry M3 attribution=ambiguous source=diagnostic evidence=evidence/m3-choreo-attempt1.log,evidence/m3-signin-probe.log reason=startup-timeout-before-assertions; all-four-isolated-signins-succeeded; serial-rerun
1789325836 knowledge-lookup M3 source=generated-types attribution=agent-error evidence=evidence/m3-types1.log,snapback/generated/api.ts correction=module-operations-use-api.chat-not-flat-keys
1789325877 correction-loop M3 attribution=agent-error source=package-README/guide evidence=node_modules/snapback4/README.md,evidence/m3-signin-probe.log,evidence/m3-choreo-attempt2.log reason=parallel-four-client-signin-vs-bounded-Argon2-admission; added-retryable-auth-backoff
1789326123 correction-loop M3 attribution=agent-error evidence=evidence/choreo-m3-178932*.jsonl,evidence/m3-receipt-probe.log reason=full-navigation-race-during-member-remove; use-authenticated-platform-wire-keepalive-for-online-admin-removal
1789326123 correction-loop M3 attribution=agent-error source=package-README/guide evidence=snapback/schema.q reason=upsert-replaces-profile-avatar; changed-profile-edit-to-update-preserving-avatar; repaired-fixture-avatar-with-real-upload
1789326123 correction M3 attribution=agent-error evidence=lib/state.tsx reason=session-boot-retries-transient-network-failure-during-reload-offline-transition
1789326281 correction-loop M3 attribution=agent-error evidence=evidence/m3-receipt-reload-probe.log,lib/device.web.ts reason=manual-WASM-URL-not-durably-available-during-reload-offline-race; cache-pinned-runtime-bytes-in-IndexedDB-before-opening-device
1789326281 verification-attempt M3 attribution=agent-error evidence=evidence/m3-choreo-attempt5.log reason=diagnostic-browser-overlapped-choreography-same-personas-and-live-code-refresh; not-authoritative; rerun-suite-and-choreo-serially
1789326291 milestone-green m3 start=1789325437 evidence=evidence/suite-m3.json,evidence/choreo-m3.jsonl
1789326349 milestone-start M4 source=fixture attribution=environment evidence=instrument/social-messenger.md,instrument/fixtures/config/windows.shortened.json
1789326707 correction-loop M4 attribution=snapback4-defect subAttribution=defect source=diagnostic evidence=evidence/m4-video-probe.log,evidence/m4-field-why.txt,evidence/m4-video-probe2.log reason=documented-id-only-video-argument-fails-local-module-mutation-prediction-with-E_FIELD-missing-duration; passing-complete-upload-asset-facts-succeeds; server-wire-id-only-succeeded-in-suite
1789326687 milestone-green m4 start=1789326349 evidence=evidence/suite-m4.json,evidence/choreo-m4.jsonl
1789326737 milestone-start M5 source=fixture attribution=environment evidence=instrument/social-messenger.md
1789327146 correction M5 attribution=agent-error source=fixture evidence=app/search.tsx,scripts/acceptance-m5.mjs reason=global-search-results-now-group-all-matches-by-chat-not-just-adjacent-runs; strengthened-suite-with-actual-grouped-UI-check
1789327289 verification M5 server-windows-pass evidence=evidence/m5-server-windows.json
1789327398 correction M5 attribution=agent-error source=fixture evidence=lib/chat.tsx reason=wire-stored-chat-color-to-kit-bubble-accentColor; default-server-start-now-loads-production-window-config
1789327467 knowledge-lookup source=package-README/guide attribution=environment evidence=node_modules/snapback4/README.md sections=Assets,Presence,Effects,Workers,React; source=fixture evidence=instrument/fixtures/action-schema.md,instrument/fixtures/README.md
1789327692 milestone-green m5 start=1789326737 evidence=evidence/suite-m5.json,evidence/choreo-m5.jsonl
1789327705 milestone-start M6 source=fixture attribution=environment evidence=instrument/social-messenger.md,instrument/fixtures/action-schema.md
1789327808 server-start name=push pid=7067 command=node scripts/push-worker.mjs
1789327809 correction-loop M6 attribution=agent-error source=diagnostic evidence=evidence/m6-check1.log,evidence/m6-check2.log,evidence/m6-check3.log reason=wrong-follow-index-name-and-unsupported-where; use-prefix-indexes-and-zero-total-deletion
1789328391 correction-loop M6 attribution=agent-error source=diagnostic evidence=evidence/m6-offline-probe3.log,evidence/m6-offline-probe4.log reason=redundant-exists-message-id-check-outside-sync-horizon-made-send-unpredictable; removed-check-relying-on-platform-write-id-idempotency; device-now-predictable-true-with-message-row
1789328498 correction-loop M6 attribution=snapback4-defect subAttribution=defect source=diagnostic evidence=evidence/m6-offline-probe4.log,evidence/m6-choreo-attempt3.log,evidence/m6-choreo-attempt4.log reason=decorated-message-shape-omits-device-pending-metadata; raw-row-query-retains-it; combine-raw-pending-with-shaped-history
1789328561 correction M6 attribution=agent-error source=fixture evidence=snapback/chat.q,scripts/replay.mjs,instrument/fixtures/invariant-manifest-combined.json reason=scale-central-member-exceeds-200-chats; raised-authorized-membership-bound-to-2000; canonical-DM-mapping-now-uses-authoritative-return-instead-of-first-inbox-page
1789328614 milestone-green m6 start=1789327705 evidence=evidence/suite-m6.json,evidence/choreo-m6.jsonl
1789328651 milestone-start M8 source=fixture attribution=environment evidence=instrument/social-messenger.md,instrument/fixtures/config/digest.shortened.json,ui/src/InsightsSummary.tsx,ui/src/TrendingRow.tsx
1789329285 server-stop pid=83224 reason=M8-mid-period-digest-restart
1789329285 server-stop pid=83203 reason=M8-mid-period-digest-restart
1789329285 server-start name=backend-restart pid=92035 port=49300
1789329286 server-start name=backend-restart-binary pid=92036 port=49300
1789329324 server-start name=aging-instance pid=96947 port=49304
1789329324 server-start name=aging-instance-binary pid=96949 port=49304
1789329484 verification M8 scheduled-digest pass=true evidence=evidence/m8-digest-proof.json
1789329511 knowledge-lookup M8 source=package-README/guide attribution=environment evidence=evidence/m8-guide-indexes.txt,evidence/m8-why-fanout.txt,evidence/m6-guide-jobs.txt,evidence/m6-guide-bounds.txt; source=fixture evidence=ui/src/InsightsSummary.tsx,ui/src/InsightsBarList.tsx,ui/src/TrendingRow.tsx
1789329511 correction-loop M8 attribution=agent-error source=diagnostic evidence=evidence/m8-check1.log,evidence/m8-check2.log,evidence/m8-check3.log,evidence/m8-check4.log,evidence/m8-check5.log,evidence/m8-check6.log,evidence/m8-check7.log reason=module-schedule-reference,exact-sync-audience,uncapped-partial-mutation-fanout,job-only-chunk-top-level-and-null-narrowing; changed-to-root-scheduled-job-with-two-feed-lanes
1789329511 correction-loop M8 attribution=agent-error source=diagnostic evidence=evidence/m8-typecheck1.log,evidence/m8-typecheck2.log reason=heterogeneous-generated-feed-query-union; explicit-client-presentation-cast
1789329511 correction-loop M8 attribution=agent-error source=diagnostic evidence=evidence/m8-trending-aging.log,evidence/m8-trending-aging.json reason=synthetic-dev-seed-rank-row-needed-explicit-id; isolated-past-content-test-does-not-alter-replay-timestamps
1789329511 correction-loop M8 attribution=agent-error source=diagnostic evidence=evidence/m8-suite-attempt1.log,evidence/m8-check-final-ui.log,evidence/m8-check8.log reason=added-followers-page-needed-id-tie-break; old-generation-correctly-kept-serving-until-fixed
1789329455 milestone-green m8 start=1789328651 evidence=evidence/suite-m8.json,evidence/choreo-m8.jsonl
1789329846 verification M8 supplemental-pass evidence=evidence/m8-digest-proof.json,evidence/m8-multidevice-extra.json,evidence/m8-m2-regression-suite.log,evidence/m8-m2-regression-choreo.log; native=artifacts/m8-ios
1789329846 scale-preparation source=fixture attribution=environment evidence=scripts/run-scale.mjs,scripts/scale-verify.mjs,scripts/scale-browser-probes.mjs clock=separate-from-milestones
1789329846 server-start name=scale-instance pid=62515 port=49303
1789329847 server-start name=scale-instance-binary pid=62517 port=49303
1789329847 server-start name=scale-web pid=62559 command=node_modules/.bin/expo start --web --port 49302
1789329848 scale-replay-start start=1789329848 source=fixture attribution=environment evidence=instrument/fixtures/scale.log,evidence/scale-clock.json own-clock-cap=14400 fresh-instance=scale-instance replayMode=true
1789329974 correction M8 attribution=agent-error evidence=lib/cached-media.tsx,lib/posts.tsx,evidence/m8-media-typecheck.log,evidence/m8-media-typecheck2.log reason=extended-explicit-ordinary-cache-to-avatars-post-media-and-chat-backgrounds; gallery-now-opens-all-attached-images; frozen-kit-media-callback-has-no-index
1789330160 correction M8 attribution=agent-error source=fixture evidence=snapback/chat.q,evidence/m8-full-history-check.log reason=retain-full-authorized-message-and-reaction-history-on-device-to-satisfy-all-previously-synced-offline-reads; scale-cold-sync-will-measure-full-busy-chat; applied-same-query-schema-to-scale-instance-during-registration
1789330160 scale-observation source=diagnostic attribution=environment evidence=evidence/scale-auth-rate-limit.txt,evidence/scale-settle.jsonl reason=real-signup-progress-is-bounded-by-identity-admission; adapter-respects-retryable-refusals-with-backoff-no-bypass
1789330339 server-stop pid=62559 reason=reload-final-client-before-scale-browser-probes
1789330339 server-start name=scale-web pid=23742 command=node_modules/.bin/expo start --web --port 49302
1789330622 essay-written-before-final-tally source=model-knowledge,package-README/guide,diagnostic attribution=environment evidence=essay.md; comparisons-architectural-not-measured-alternative-builds; scale-execution-still-running
1789330647 correction-loop M8 attribution=agent-error source=fixture evidence=evidence/final-gallery.log,evidence/final-gallery.json reason=kit-exposes-one-gallery-container-not-one-testID-per-image; corrected-probe-selector
1789330712 correction-loop M8 attribution=agent-error source=diagnostic evidence=evidence/m8-insights.png,app/insights.tsx,evidence/final-m8-visual-suite.log reason=visual-review-found-empty-string-React-Native-text-warning; changed-error-conditional-to-boolean
1789330850 correction M8 attribution=agent-error evidence=lib/chat.tsx,app/new-chat.tsx,app/profile/[handle].tsx,evidence/final-people-typecheck.log reason=member-picker-now-searches-and-pages-all-profiles; added-direct-message-entry-from-person-profile
1789331079 correction M8 attribution=agent-error evidence=lib/cached-media.tsx,snapback/custom.q,evidence/final-avatar-check.log reason=avatar-cache-validation-now-uses-immutable-principal-instead-of-changeable-handle
1789331079 knowledge-lookup source=package-README/guide attribution=environment evidence=node_modules/snapback4-expo/README.md native-arm-surface-read-no-witness-claim
1789331282 milestone-finalized m8 status=green end=1789331282 first-green=1789329455 evidence=milestones.json reason=post-green-completeness-review-and-final-native-export; overlaps-separate-scale-registration-clock
1789331282 essay-finalized-after-M8-before-final-tally source=model-knowledge,published-docs attribution=environment evidence=essay.md
1789331282 server-stop pid=23742 reason=pin-final-client-for-scale-probes
1789331282 server-start name=scale-web pid=39721 command=node_modules/.bin/expo start --web --port 49302
1789331577 knowledge-lookup source=fixture attribution=environment evidence=instrument/schema/run-record.schema.json,instrument/schema/social-messenger/run-record.schema.json,instrument/schema/social-messenger/run-record-extension.schema.json reason=prepare-protocol-record; driver-native-metering-and-independent-grader-receipts-not-provided-in-lane
1789331684 correction-loop attribution=agent-error source=fixture evidence=milestones.json,evidence/choreo-m5-1789327354362.jsonl,evidence/choreo-m6-1789328572585.jsonl reason=boundary-helper-had-labeled-final-green-as-first-green-for-M5/M6; restored-earliest-actual-segment-summary-times; original-M5-first-suite-bytes-not-archived-so-hash-custody-gap-recorded; latest-M5-suite-and-green-remain-hash-bound
1789331951 verification-prepared source=fixture,model-knowledge attribution=environment evidence=scripts/verify-scale-totals.mjs,scripts/probe-scale-group.mjs,scripts/scale-performance-summary.mjs reason=all-entity-counts-and-published-degradation-rules; mutation-probes-isolated-from-invariant-corpus
1789332001 knowledge-lookup source=fixture attribution=environment evidence=metering/README.md,evidence/record-custody-gap.md reason=native-ledger-and-driver-boundary-custody-requirements; no-transcript-estimator-or-reconstructed-driver-receipts
1789332046 knowledge-lookup source=package-README/guide attribution=environment evidence=evidence/scale-personas-guide.txt reason=published-personas-card-confirms-30-auth-attempts-per-socket-peer-per-minute; replay-uses-real-auth-and-honors-limit
1789332097 correction-loop source=diagnostic attribution=agent-error evidence=scripts/wire.mjs,evidence/scale-personas-guide.txt reason=automatic-auth-backoff-retries-had-not-been-individually-logged; aggregate-throttling-episode-retained; added-per-retry-logging-for-subsequent-processes; running-replay-retains-original-loaded-helper
1789332097 knowledge-lookup source=package-README/guide attribution=environment evidence=evidence/scale-assets-guide.txt reason=upload-admission-and-single-home-asset-contract-verified
1789332238 knowledge-lookup source=web attribution=environment evidence=essay.md URLs=https://docs.convex.dev/client/react/optimistic-updates,https://supabase.com/docs/guides/database/postgres/row-level-security,https://supabase.com/docs/guides/realtime reason=verify-comparison-baseline-from-official-docs-only; no-alternative-implementation-or-Snapback-source-read
1789332465 scale-checkpoint stage=10pct source=fixture attribution=environment evidence=evidence/scale-verify-10pct.json,evidence/scale-probes-10pct.json,evidence/scale-browser-10pct.json result=pass-invariants-and-probe-execution; probe-wall-excluded-from-own-clock
1789332545 scale-replay-end end=1789332545 status=failed evidence=evidence/scale-clock.json
1789332901 correction-loop source=diagnostic,package-README/guide attribution=agent-error evidence=evidence/scale-browser-50pct.json,evidence/scale-startup-diagnostic.json,evidence/scale-sync-counts.json,snapback/schema.q reason=public-repost-counter-also-replicated-one-unused-original-count-per-post; split-repost-only-source-and-maintain-without-reducing-message-retention; first-probe-failure-preserved
1789332901 correction-loop source=diagnostic attribution=agent-error evidence=evidence/scale-counter-filter-check.log reason=attempted-maintain-read-filter-conflicted-with-inherited-public-sync-E_SYNC; replaced-with-dedicated-repostEdges-source
1789332901 knowledge-lookup source=package-README/guide attribution=environment evidence=evidence/scale-sync-guide.txt,evidence/scale-language-guide.txt,node_modules/snapback4/README.md reason=sync-paging-maintain-inheritance-and-root-job-run-contract
1789332945 server-start name=scale-instance pid=43653 port=49303
1789332946 server-start name=scale-instance-binary pid=43662 port=49303
1789332946 error source=diagnostic attribution=ambiguous evidence=evidence/scale-instance-server.log,evidence/scale-counter-backfill-scale.json reason=scale-server-PIDs-62515-and-62517-exited-without-diagnostic-during-schema-change/backfill; restarted-same-store-no-reset
1789333128 scale-replay-resume original-start=1789329848 resumedAt=1789333128 source=diagnostic attribution=agent-error evidence=evidence/scale-clock-attempt1.json,scripts/resume-scale.mjs reason=same-store-idempotent-receipt-resume-after-repost-counter-fix; no-clock-reset; known-failed-browser-probe-wall-excluded; unmetered-earlier-API-probe-fraction-conservatively-included
1789333257 correction-loop attribution=agent-error source=diagnostic evidence=evidence/scale-fix-m2-suite.log,evidence/feed-scroll-diagnostic.json,snapback/schema.q,lib/posts.tsx reason=Following-pagination-failed-during-fallback/materialized-source-transition; source-change-now-remounts-page-accumulator; stable-state-scroll-diagnostic-read-50-rows
1789333279 server-stop pid=39721 reason=load-final-feed-pagination-client-for-scale-probes
1789333279 server-start name=scale-web pid=83693 command=node_modules/.bin/expo start --web --port 49302
1789333319 correction-loop attribution=agent-error source=diagnostic evidence=evidence/scale-fix-m2-suite2.log,scripts/acceptance-m2.mjs reason=Global-too-showed-10-mounted-rows; original-test-counted-final-DOM-size-of-virtualized-FlatList; corrected-to-distinct-cards-observed-during-real-scroll-exceeding-page-size; prior-cursor-transition-hypothesis-was-not-sufficient-to-explain-failure
1789333341 correction-loop attribution=agent-error source=diagnostic evidence=evidence/scale-fix-m8-suite.log reason=ran-M8-aggregate-snapshot-test-concurrently-with-M2-writes-on-shared-main-backend; one-post-count-race; rerun-sequentially-after-M2-completes
1789333417 scale-replay-end end=1789333417 status=passed source=fixture attribution=environment evidence=evidence/scale-clock.json probeFailures=0
1789333448 scale-checkpoint stage=final source=fixture attribution=environment evidence=evidence/scale-verify-final.json,evidence/scale-browser-final.json,evidence/scale-clock.json result=all-167157-actions-settled-and-local-invariants-pass; full-cold-start-21446ms; prior-timeout-preserved
1789333489 scale-probe-snapshot source=model-knowledge attribution=environment evidence=mutation-probe-instance/.snapback4/store.sqlite reason=SQLite-backup-of-own-database-for-isolated-mutating-probes-no-schema-or-source-inspection
1789333489 server-start name=mutation-probe-instance pid=10264 port=49305
1789333490 server-start name=mutation-probe-instance-binary pid=10273 port=49305
1789333518 server-start name=mutation-probe-web pid=13842 command=node_modules/.bin/expo start --web --port 49306
1789333643 scale-verification source=fixture attribution=environment evidence=evidence/scale-entity-totals.json,evidence/scale-settlement-accounting.json,evidence/scale-celebrity-writes.json,evidence/scale-group-render.json,evidence/scale-performance-summary.json result=all-entity-counts-and-settlements-pass; two-strict-midcurve-predicates-fail; no-reclassification-or-latency-threshold-adjustment
1789333643 error source=diagnostic attribution=agent-error evidence=evidence/scale-wire-guide.txt reason=guide-wire-is-not-a-published-card; used-README-wire-section
1789333643 error source=diagnostic attribution=agent-error evidence=run-log.md reason=read-main-replay-state-for-alice-but-main-starter-sessions-live-in-seed-sessions.json; exact-TypeError-cannot-read-properties-of-undefined-reading-token; corrected-read-only-diagnostic
1789333681 correction source=model-knowledge attribution=agent-error evidence=scripts/run-scale.mjs reason=fresh-replay-entrypoint-now-refuses-existing-replay-state-before-writing-clock; explicit-resume-keeps-original-clock
1789333719 milestone-finalized m8 status=green source=fixture attribution=environment evidence=milestones.json,evidence/scale-fix-m2-choreo3.log,evidence/scale-fix-m8-choreo2.log,evidence/m8-ios-export.log reason=scale-driven-counter-fix-and-final-regressions-complete; first-green-unchanged
1789333719 essay-finalized-before-final-tally source=model-knowledge,published-docs,fixture,diagnostic attribution=environment evidence=essay.md,diary.md reason=include-completed-replay-and-retained-performance-failures
1789333745 server-stop pid=13842 name=mutation-probe-web evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=10273 name=mutation-probe-instance-binary evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=83693 name=scale-web evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=43662 name=scale-instance-binary evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=96949 name=aging-instance-binary evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=92036 name=backend-restart-binary evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=7067 name=push evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333745 server-stop pid=70828 name=web evidence=evidence/server-cleanup.json reason=final-cleanup-exact-recorded-PID-with-lane-cwd-verification
1789333747 final-report end=1789333747 source=fixture,diagnostic attribution=environment evidence=final-report.md,run-record.pending.json,evidence/run-record-validation.json
1789333747 end=1789333747
1789333808 final-report end=1789333808 source=fixture,diagnostic attribution=environment evidence=final-report.md,run-record.pending.json,evidence/run-record-validation.json
1789333808 end=1789333808
