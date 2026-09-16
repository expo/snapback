# Clique final report

Lane `astra-clique-snapback4-full-20260913`; model `gpt-6-astra`; effort `medium`. Backend authored in Quarry. No M7 work was attempted.
All seven requested milestones reached the environment overlay’s web green bar: a passing coverage-validated suite and passing required choreography. This does not claim native simulator behavior or a scored O5 result.
## Clocks and milestone results

Raw run start: **1789539727**. First M1 clock includes initial orientation. M8 includes a disclosed post-green static-check correction interval that overlapped the separately recorded scale replay. First-green times are retained.

| Milestone | Start epoch | First green epoch | Final end epoch | Wall seconds | First green seconds | Status |
|---|---:|---:|---:|---:|---:|---|
| M1 | 1789539727 | 1789540371 | 1789540371 | 644 | 644 | green |
| M2 | 1789540371 | 1789540975 | 1789540975 | 604 | 604 | green |
| M3 | 1789540975 | 1789541344 | 1789541344 | 369 | 369 | green |
| M4 | 1789541344 | 1789541765 | 1789541765 | 421 | 421 | green |
| M5 | 1789541765 | 1789542374 | 1789542374 | 609 | 609 | green |
| M6 | 1789542374 | 1789542730 | 1789542730 | 356 | 356 | green |
| M8 | 1789542730 | 1789543148 | 1789543711 | 981 | 418 | green |
| M7 | — | — | — | — | — | not-run |

The four-hour milestone safety limit was never reached. There were no capability failures, blocked milestones, or aborted milestones. Failed intermediate attempts remain in evidence.
## Suite and choreography evidence

| Milestone | Suite tests passed | Coverage | Choreography required / all passed | Canonical evidence |
|---|---:|---|---|---|
| M1 | 6/6 | 7 mapped, frozen validator passed | 3 required / 3 total passed; green=true | [suite](evidence/m1-suite.json), [coverage](evidence/m1-coverage.json), [receipts](evidence/m1-choreography.jsonl) |
| M2 | 6/6 | 22 mapped, frozen validator passed | 9 required / 9 total passed; green=true | [suite](evidence/m2-suite.json), [coverage](evidence/m2-coverage.json), [receipts](evidence/m2-choreography.jsonl) |
| M3 | 4/4 | 7 mapped, frozen validator passed | 5 required / 7 total passed; green=true | [suite](evidence/m3-suite.json), [coverage](evidence/m3-coverage.json), [receipts](evidence/m3-choreography.jsonl) |
| M4 | 6/6 | 5 mapped, frozen validator passed | 5 required / 5 total passed; green=true | [suite](evidence/m4-suite.json), [coverage](evidence/m4-coverage.json), [receipts](evidence/m4-choreography.jsonl) |
| M5 | 4/4 | 6 mapped, frozen validator passed | 2 required / 4 total passed; green=true | [suite](evidence/m5-suite.json), [coverage](evidence/m5-coverage.json), [receipts](evidence/m5-choreography.jsonl) |
| M6 | 3/3 | 5 mapped, frozen validator passed | 1 required / 1 total passed; green=true | [suite](evidence/m6-suite.json), [coverage](evidence/m6-coverage.json), [receipts](evidence/m6-choreography.jsonl) |
| M8 | 2/2 | 6 mapped, frozen validator passed | 5 required / 5 total passed; green=true | [suite](evidence/m8-suite.json), [coverage](evidence/m8-coverage.json), [receipts](evidence/m8-choreography.jsonl) |

No required web choreography assertion was relabeled as an instrument skip. Native simulator assertions remain separately unrecorded, as permitted by ENVIRONMENT.md; they are not represented as passed.

Additional independent proofs: [closed-client scheduled digest](evidence/m8-digest-proof.json), [web durable offline queue](evidence/m8-web-durable-queue.json), [cold web media and search](evidence/m8-web-cold-media.json), [final TypeScript pass](evidence/final-typecheck-pass.log). M5 also checks server expiry in an isolated instance, and the frozen choreography waits through real expiry.
## Native artifacts

- M1: [m1-ios-final](artifacts/m1-ios-final); entry-39e216f5a83a967e58bb34da69e0951f.hbc (2740917 bytes).
- M2: [m2-ios-final](artifacts/m2-ios-final); entry-a172a9be44cc3eacefcb3b84e88d6aea.hbc (2752955 bytes).
- M3: [m3-ios-final](artifacts/m3-ios-final); entry-dbfc8f7c99fe2926f083faf9c6e91f8f.hbc (2774562 bytes).
- M4: [m4-ios](artifacts/m4-ios); entry-df53d83802fa02c613a7ae25e5537314.hbc (2792754 bytes).
- M5: [m5-ios](artifacts/m5-ios); entry-a840612d75805fd3cb10b63a4e38e0d6.hbc (2801132 bytes).
- M6: [m6-ios](artifacts/m6-ios); entry-3fbadfccad0f3991db7762381209ef7d.hbc (2801652 bytes).
- M8: [m8-ios-verified](artifacts/m8-ios-verified); entry-1dc3367757648dfd670425694c5515c9.hbc (2806281 bytes).

These are successful iOS Hermes bundle exports, not native runtime, simulator, or push-delivery proofs. The final static web export is [artifacts/web-verified](artifacts/web-verified).
## Scale replay

Fresh retained instance: `/Users/ccheever/clique-sb4-20260916-astra-cal8/lanes/astra-snapback4/scale-instance-1789543148`. Backend ran on 49363 with published `--replay`, suppressing new push/digest effects and holding schedules. All three starter segments preceded the hash-pinned scale log.

Start **1789543148**; end **1789543868**; wall **720 seconds**. Scale actions settled: **167157/167157**. Verification: **pass**. Action log sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9.

Evidence: [per-action authoritative receipts](evidence/scale-settle.jsonl), [clock/result](evidence/scale-result.json), [10% checkpoint](evidence/scale-10pct-verification.json), [50% checkpoint](evidence/scale-50pct-verification.json), [final invariant comparison](evidence/scale-final-verification.json), [supplemental named fields](evidence/scale-named-spots.json). Each action awaited authoritative success. Counts are independently read from documented application SQL views; named fields, all per-user follow/membership counts and all per-chat message/member counts are checked. User count is corroborated by settled registrations and one profile per principal, rather than reading private auth storage.

Hidden scored probes and their calibrated replay cap are not supplied to builders in this instrument snapshot. They were not fabricated or run. Checkpoint developer verification ran synchronously; no wall time was excluded from this reported replay clock. No O5 score or hidden-probe performance claim is made. The run stayed below the conservative four-hour administrative safety limit.
## Correction loops and attribution

Logged correction-loop events: **17** (agent-error: 17). This is a count of timestamped correction-loop entries, not a claim that every retry was a separate defect. Other errors/retries/workarounds remain in run-log.md. No confirmed snapback4-defect is asserted.

- 1789540315 correction-loop attribution=agent-error evidence=evidence/m1-suite.json detail=duplicate-handle-error-not-visible; retry=restart-Metro-with-watch
- 1789540630 correction-loop attribution=agent-error evidence=evidence/m2-acceptance.log detail=suite-locator-needed-first-for-repeated-feed-cards
- 1789540705 correction-loop attribution=agent-error evidence=evidence/m2-choreo.log detail=choreography-requires-feed-tabs-reachable-on-profile-and-thread
- 1789541240 correction-loop attribution=agent-error evidence=evidence/m3-choreo.log detail=group-route-resolver-discarded-open-conversation-on-membership-removal
- 1789541240 correction-loop attribution=agent-error evidence=evidence/m3-acceptance.log detail=suite-navigated-before-login-settlement
- 1789541541 correction-loop attribution=agent-error evidence=evidence/m4-acceptance.log detail=suite-read-server-before-predicted-write-settled-and-raced-next-composition
- 1789541714 correction-loop attribution=agent-error evidence=scripts/coverage.mjs,evidence/m1-coverage-validation.json detail=aligned-coverage-manifest-with-frozen-validator-and-validated-M1-through-M4
- 1789542456 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m6-check.log detail=E_STRUCTURAL_FANOUT-use-original-members-page-for-effect-loop
- 1789542621 correction-loop attribution=agent-error evidence=evidence/m6-acceptance.log detail=test-assumed-original-displayname-and-wrong-profile-query-argument
- 1789542892 correction-loop attribution=agent-error evidence=evidence/m8-check.log,evidence/m8-check-retry.log detail=typed-reference-mismatch-fixed-with-unique-post-reference
- 1789542955 correction-loop attribution=agent-error evidence=evidence/m8-acceptance.log detail=CLI-as-requires-principal-not-email
- 1789543021 correction-loop attribution=agent-error evidence=evidence/m8-acceptance-retry.log,evidence/m8-choreo.log detail=correct-feed-item-testID-and-show-inbox-on-home-for-cross-device-read-proof
- 1789543052 correction-loop attribution=agent-error evidence=evidence/m8-acceptance-retry2.log detail=old-post-proof-now-populates-yesterday-check-zero-days-against-server-state
- 1789543254 correction-loop attribution=agent-error evidence=evidence/final-typecheck.log detail=embedded-inbox-edit-also-touched-NewChat-and-base-Client-type-does-not-expose-local-sync-fixed
- 1789543276 correction-loop attribution=agent-error evidence=evidence/final-typecheck-retry.log detail=corrected-previous-attribution-location-ChatSettings-not-NewChat
- 1789543367 correction-loop attribution=agent-error source=diagnostic evidence=API.md detail=verified-history-wire-order-is-descending-and-corrected-latest-message-documentation
- 1789543651 correction-loop attribution=agent-error evidence=app/index.tsx,src/Posts.tsx detail=final-mobile-layout-review-hide-desktop-inbox-below-768-and-use-ranked-kit-row

Environment issues included the initially active Node 25 PATH despite the overlay, read-only permissions inherited by copied harness files, and copied harness relative support imports. Toolchain commands were subsequently pinned to Node 24.18.0. A disallowed command was rejected before execution. One accidental empty placeholder was written at `/tmp/not-allowed-placeholder`; this violated the lane-only write instruction, was logged, contained no data, and was not used. No forbidden source checkout, sibling lane, or prior implementation was inspected.
## Resolved packages

- `snapback4@0.2.24`
- `snapback4-expo@0.2.15`
- `expo@57.0.22`
- `react@19.2.3`
- `react-native@0.86.3`

Both requested exact Snapback pins were recorded before installation. Lockfile: [package-lock.json](package-lock.json). Package closure hashes and toolchain identity: [setup-identity.json](setup-identity.json). No source-built Snapback substitute was used.
## Hand-authored line counts by file

Physical lines, including blank lines, in newly authored application/backend/test/tooling files. Minified long lines count once; this is not a complexity metric. Generated recipe/types/config output, copied frozen kit/harness, package-lock, artifacts, evidence, and replay-instance copies are excluded. Mixed generated/scaffold configuration files are listed separately below.

| File | Lines |
|---|---:|
| app/_layout.tsx | 15 |
| app/chat/[id]/index.tsx | 1 |
| app/chat/[id]/settings.tsx | 1 |
| app/chats.tsx | 1 |
| app/conversation/[handle].tsx | 1 |
| app/conversation/group/[group]/index.tsx | 1 |
| app/conversation/group/[group]/settings.tsx | 1 |
| app/index.tsx | 3 |
| app/insights.tsx | 2 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 2 |
| app/profile/[handle].tsx | 4 |
| app/profile/edit.tsx | 3 |
| app/search.tsx | 3 |
| app/settings.tsx | 7 |
| scripts/acceptance.mjs | 33 |
| scripts/artifact-manifest.mjs | 1 |
| scripts/browser-smoke.mjs | 2 |
| scripts/choreo.mjs | 4 |
| scripts/configure-digest.mjs | 1 |
| scripts/configure.mjs | 1 |
| scripts/coverage.mjs | 3 |
| scripts/custom-client-demo.mjs | 2 |
| scripts/debug-chat.mjs | 1 |
| scripts/digest-proof.mjs | 3 |
| scripts/log.mjs | 1 |
| scripts/mobile-layout-proof.mjs | 1 |
| scripts/offline-media-proof.mjs | 1 |
| scripts/offline-restart-proof.mjs | 1 |
| scripts/replay.mjs | 21 |
| scripts/report.mjs | 2 |
| scripts/scale-run.mjs | 2 |
| scripts/seed.mjs | 38 |
| scripts/serve-web.mjs | 1 |
| scripts/setup-identity.mjs | 3 |
| scripts/start-backend.mjs | 5 |
| scripts/start-static.mjs | 1 |
| scripts/start-web.mjs | 2 |
| scripts/test-lib.mjs | 6 |
| scripts/test-m2.mjs | 16 |
| scripts/test-m3.mjs | 7 |
| scripts/test-m4.mjs | 8 |
| scripts/test-m5.mjs | 7 |
| scripts/test-m6.mjs | 5 |
| scripts/test-m8.mjs | 3 |
| scripts/ui-m8-smoke.mjs | 1 |
| scripts/verify-scale-spots.mjs | 1 |
| scripts/verify-scale.mjs | 7 |
| snapback/chat.q | 196 |
| snapback/digest.q | 24 |
| snapback/insights.q | 41 |
| snapback/media.q | 59 |
| snapback/schema.q | 31 |
| snapback/search.q | 39 |
| snapback/social.q | 107 |
| snapback/worker.mjs | 5 |
| src/Auth.tsx | 18 |
| src/Chat.tsx | 29 |
| src/Media.tsx | 4 |
| src/Posts.tsx | 29 |
| src/Profile.tsx | 21 |
| src/client.ts | 24 |
| src/common.tsx | 6 |

Total in the listed authored code files: **870 physical lines**. Separate authored prose: README.md, API.md, diary.md, essay.md, run-log.md, and this report. Modified scaffold/configuration: package.json, app.json, babel.config.js, metro.config.js, tsconfig.json and config/*.json. Generated feed recipe and generated API are retained but excluded from authored totals.
## Candid gaps and limits

- Native runtime behavior is unverified. Hermes exports passed; the stronger offline restart/media proofs are web-only. Expo Go uses the online fallback; native replica behavior requires a custom build with the published native arm.
- Hidden grader assertions and the private performance probe set were not run. The exact invariant replay does not establish latency ceilings, cold-sync memory limits, or an O5 score.
- The server multi-chat search operation emits N_WIDE_MERGE for its maximum 1,000-lane form; a meter cut is explicitly incomplete. The UI uses the held-message search and labels its synced scope. Full public/message sync has no horizon and may be expensive at scale; native scale sync was not measured.
- The digest passed a separate closed-client scheduled/restart/authorization proof, but high-envelope digest execution is not proved by scale replay because replay correctly holds schedules.
- The delivered process is a local development deployment with a logged push seam, not a TLS production host or a configured APNs/FCM provider. Real push delivery was out of scope.
- Assets and queued data are retained in local development stores. The seed ledger is instance-specific; do not reuse it against a reset backend.
- A few final static-check/documentation corrections happened after first green and overlapped replay; their later M8 end and original first-green epoch are both retained. The retrospective process log is explicit about that overlap.

The comparison essay was written before this numerical tally: [essay.md](essay.md). Per-boundary qualitative notes: [diary.md](diary.md). Detailed event log: [run-log.md](run-log.md).

## Process cleanup and final clock

All owned server processes were stopped using recorded numeric PIDs. No pattern kill was used. [Cleanup evidence](evidence/process-cleanup.json) confirms no process holds the lane's server logs open. The retained backend and scale stores remain available for inspection.

Raw run end: **1789543947**. Total elapsed wall: **4220 seconds**. Milestone and replay walls overlap as disclosed and must not be summed as disjoint intervals.

end=1789543947
