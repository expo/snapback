# Clique final report

Lane: astra-clique-snapback4-full-20260913. Model: gpt-6-astra, effort medium. Backend: snapback4@0.3.0; native arm: snapback4-expo@0.3.0. Both exact public npm pins were recorded before installation and resolved exactly.

All requested milestones are green under the frozen suite-plus-choreography bar. M7 was not run, as instructed. Every requested milestone has an iOS Hermes export. No simulator proof or independent grading result is claimed. All work artifacts are in this lane.

The essay was written before this quantitative tally.

## Raw clocks

start=1790202906

Final end=1790208259; total elapsed=5353 seconds. Milestone wall below runs from the logged start to logged green boundary, including orientation in M1 and post-first-green hardening. First-green wall is the exact earliest passing combined choreography-summary timestamp minus that milestone's start. These are distinct measurements. Replays have separate clocks and overlap some other work; do not sum them into lane elapsed.

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First-green epoch | First-green wall |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1790202906 | 1790203431 | 525 | 1790203399.032 | 493.032 |
| M2 | green | 1790203431 | 1790204199 | 768 | 1790204099.913 | 668.913 |
| M3 | green | 1790204200 | 1790204700 | 500 | 1790204614.618 | 414.618 |
| M4 | green | 1790204700 | 1790205074 | 374 | 1790204925.957 | 225.957 |
| M5 | green | 1790205074 | 1790205689 | 615 | 1790205657.136 | 583.136 |
| M6 | green | 1790205689 | 1790206217 | 528 | 1790206139.978 | 450.978 |
| M8 | green | 1790206217 | 1790207403 | 1186 | 1790206565.473 | 348.473 |
| M7 | not-run | — | — | — | — | — |

## Verification

| Milestone | Required suite assertions covered | Choreography passed / total (required) | Suite receipt | Choreography receipt |
|---|---:|---:|---|---|
| M1 | 7 | 3/3 (3 required) | [receipt](evidence/m8-regression-m1-suite.json) | [JSONL](evidence/m1-choreo.jsonl) |
| M2 | 22 | 9/9 (9 required) | [receipt](evidence/m8-regression-m2-suite.json) | [JSONL](evidence/m2-choreo.jsonl) |
| M3 | 7 | 7/7 (5 required) | [receipt](evidence/m8-regression-m3-suite.json) | [JSONL](evidence/m3-choreo.jsonl) |
| M4 | 5 | 5/5 (5 required) | [receipt](evidence/m8-regression-m4-suite.json) | [JSONL](evidence/m4-choreo.jsonl) |
| M5 | 6 | 4/4 (2 required) | [receipt](evidence/m8-regression-m5-suite.json) | [JSONL](evidence/m5-choreo.jsonl) |
| M6 | 5 | 1/1 (1 required) | [receipt](evidence/m8-regression-m6-suite.json) | [JSONL](evidence/m6-choreo.jsonl) |
| M8 | 6 | 5/5 (5 required) | [receipt](evidence/m8-1790207303960-suite.json) | [JSONL](evidence/m8-choreo.jsonl) |

Latest earlier-milestone regression suites passed after M8. coverage-manifest.json maps every required assertion in the requested scope to its test. The suite receipt embedded in each choreography summary was SHA-256 verified against the retained bytes. No required choreography checks were skipped or relabeled. M6/M8 simulator status is the instrument's exact `not-recorded` supplemental status, `requiredForGreen:false`, per the user's export-only native requirement.

Additional proofs: [server-only expiry](evidence/m5-expiry-server.json), [asset revocation/edit window](evidence/m4-security.json), [closed-client scheduled digest/restart/authorization/idempotency](evidence/digest-proof.json), [cold offline queue/search](evidence/cold-offline.json), [cold ordinary media and consumed-once exclusion](evidence/cold-media.json), [token-only HTTP API](evidence/raw-api.json). Typecheck passed in evidence/m8-typecheck-final2.txt. UI screenshots: evidence/final-insights.png and evidence/final-chat-mobile.png.

## Replay

| Program | Start epoch | End epoch | Raw wall seconds | Actions settled | Manifest |
|---|---:|---:|---:|---:|---|
| M6 program | 1790206190.378 | 1790207457.416 | 1267.038 | 167243 | [pass](evidence/scale-replay-result.json) |
| Completed M8 program | 1790206950.885 | 1790208030.394 | 1079.509 | 167243 | [pass](evidence/scale-final-replay-result.json) |

Each run used a fresh separate store, all three starter logs, then the pinned scale log, with sequential authoritative settlement and media uploads. Both checkpoints and the full state matched invariant-manifest-combined.json: 1,008 users/profiles, 5,921 follow edges, 50,228 posts including 2,004 replies, 1,002 conversations, 2,053 memberships, 100,015 messages, and 2,000 active reactions. All per-user following/conversation counts, per-chat message counts, and per-group member counts were compared. Named content was also checked against the action intents. Push was disabled with the published --replay mode; doctor evidence records suppression and held schedules.

The adapter was authored in M6 and passed the frozen grammar validator plus an authoritative 50-action state check. Replay raw wall includes checkpoint verification; the verification duration and individual probe windows are retained in each checkpoint JSON. No calibrated replay cap or O5 score was invented.

Final-program diagnostic query measurements (ten samples each, p95 is the maximum of ten):

| User | Query | 10% p95 ms | 100% p95 ms | Ratio |
|---|---|---:|---:|---:|
| u0005 | following | 3.851 | 4.345 | 1.13× |
| u0005 | global | 3.300 | 3.740 | 1.13× |
| u0005 | inbox | 2.826 | 2.502 | 0.89× |
| u0005 | insights | 2.047 | 2.158 | 1.05× |
| u0005 | trending | 2.270 | 3.959 | 1.74× |
| u0500 | following | 3.486 | 3.467 | 0.99× |
| u0500 | global | 2.435 | 2.191 | 0.90× |
| u0500 | inbox | 9.218 | 7.431 | 0.81× |
| u0500 | insights | 2.087 | 1.677 | 0.80× |
| u0500 | trending | 2.270 | 1.924 | 0.85× |
| u0901 | following | 2.899 | 3.104 | 1.07× |
| u0901 | global | 2.504 | 2.303 | 0.92× |
| u0901 | inbox | 1.655 | 1.524 | 0.92× |
| u0901 | insights | 2.268 | 2.168 | 0.96× |
| u0901 | trending | 1.971 | 1.981 | 1.01× |

These are builder diagnostics under shared-host load, not the independent rotated probe set or a full O5 grade.

## Native artifacts

| Milestone | Hermes bundle | Bytes | SHA-256 |
|---|---|---:|---|
| M1 | [bundle](artifacts/m1-ios/_expo/static/js/ios/entry-b836fd338093bfb1876686bb60e03cd2.hbc) | 2782324 | 643272d9ce22914bc47d026270b2d04188a8cd54cb8e4a0e8013f6547edd966f |
| M2 | [bundle](artifacts/m2-ios/_expo/static/js/ios/entry-64ecba1f0b758024b67e6bb837a32a6e.hbc) | 2808227 | 5c5651bb8b92772337c6e11ac6d32c593e82afc010866a4458e713dbbf93e14b |
| M3 | [bundle](artifacts/m3-ios/_expo/static/js/ios/entry-c66373fe7926b3f321acc89095238177.hbc) | 2832494 | 420237ddfd817acb1de04f83595093c3780ea835e5a0213d0bff69600551e21d |
| M4 | [bundle](artifacts/m4-ios/_expo/static/js/ios/entry-3625be00df7c4688fb10a6a05b261085.hbc) | 2838284 | 82d79c75bc89752c0619dc1d2bee33a2f75cde890f2bfeb7c14f6f714fb821ce |
| M5 | [bundle](artifacts/m5-ios/_expo/static/js/ios/entry-c8e421b37b1bc42f02bebb5097b0c963.hbc) | 2848124 | c3f17c2eac0802d0f8d94f9ef54c00a6813095a6b2b567e52272f07ad1841dc8 |
| M6 | [bundle](artifacts/m6-ios/_expo/static/js/ios/entry-e9643292585bf087e86d5f2c30facee7.hbc) | 2848123 | 3acb68575a68c6a3900e9822d250a7fd0bb56571229ee01711618bdbd046fac2 |
| M8 | [bundle](artifacts/m8-ios/_expo/static/js/ios/entry-4c933253a38197c35349bd6dd6479f6b.hbc) | 2856845 | 009b1f49d1a4036bda7f644ba13c046aee713d6a6771818c72b66d343570f4d7 |

Resolved environment: snapback4=0.3.0, snapback4-expo=0.3.0, expo=57.0.22, react=19.2.3, react-native=0.86.3, node=24.18.0, host=macOS arm64 / Apple M5 Max. package-lock.json retains registry URLs and integrity hashes. setup-identity.json binds the installed public binary and wrapper.

## Corrections and attribution

39 logged error/correction entries: environment=7, agent-error=31, ambiguous=1. Entries can describe the initial failure and correction of one loop; this is an event count, not a deduplicated efficiency score. No demonstrated snapback4 defect is claimed. The initial ambiguous write-ID failure was subsequently resolved as an agent error. The React DOM dependency mismatch was also reclassified as my unpinned-install error; raw event counts preserve the initial attribution.

- 1790203094 error source=diagnostic attribution=environment evidence=evidence/install-router.log ERESOLVE react-dom latest requires React 19.3; retry pinned react-dom 19.2.3 to match published Expo starter.
- 1790203094 correction-loop attribution=agent-error evidence=evidence/cli-help.txt duplicate init invocation raced delayed npx; second refused existing app.json, no overwrite. Use absolute node CLI entry.
- 1790203295 error attribution=environment source=diagnostic evidence=evidence/install-choreography.log copied instrument retained read-only mode; chmod only lane copies, retry install.
- 1790203367 error attribution=environment source=diagnostic evidence=evidence/m1-choreo-run.log copied choreography imports ../metering; copying frozen dependency directories into lane.
- 1790203378 error attribution=agent-error source=diagnostic evidence=evidence/m1-choreo-run.log setup identity expects relative artifact paths; corrected.
- 1790203513 error source=diagnostic attribution=agent-error evidence=evidence/m2-check.txt guessed cross-table merge form; replace with global event index while Following uses declared timeline.
- 1790203821 correction-loop attribution=environment evidence=evidence/m2-suite-failure.png Metro served M1 bundle after edits despite watch mode; reset cache and use Node watcher.
- 1790203867 error attribution=environment source=fixture evidence=evidence/m2-choreo-run.log default fixture path assumes original repository layout; use allowed input-only adapter pointing to lane instrument/fixtures.
- 1790203904 correction-loop attribution=agent-error evidence=evidence/m2-choreo-run.log follow helper expects feed tabs accessible from profile; moved feed navigation tabs into shell for all screens.
- 1790203976 correction-loop attribution=agent-error evidence=evidence/m2-choreo-run.log Expo Stack retained hidden composer locators and async tab route exposed stale feed; use Slot route composition plus immediate shared tab state.
- 1790204061 correction-loop attribution=environment evidence=evidence/m2-choreo-run.log Metro still stale: CI=0 remains truthy to internal watchers; removed CI variable entirely and restarted.
- 1790204084 error attribution=agent-error evidence=evidence/m2-choreo-run.log restarting Metro during current failed choreography ended it with connection reset; preserve interrupted attempt and rerun.
- 1790204456 error attribution=environment evidence=scripts/inspect-ui.mjs Metro missed newly created conversation routes (Unmatched Route); explicit clear-cache restart before milestone verification.
- 1790204556 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m3-choreo-run.log empty matching query returns zero by documented search semantics; added explicit people browse branch for member picker.
- 1790204569 error attribution=agent-error source=diagnostic evidence=evidence/m3-check.txt reserved read used as column; renamed readOrdinal.
- 1790204569 error attribution=agent-error source=diagnostic evidence=evidence/m3-check2.txt optional membership read required null coalescing; corrected to ??0.
- 1790204569 error attribution=agent-error source=diagnostic evidence=evidence/m2-check2.txt,evidence/m2-check3.txt timeline extra at column needs default; events deletion cannot take repost reference; used own event unique key.
- 1790204785 error attribution=agent-error source=diagnostic evidence=tool-transcript accidental scratch redirect outside lane was refused by read-only root; no outside file written; scratch now scripts/m4-ui-fragment.txt.
- 1790204892 correction-loop attribution=agent-error evidence=evidence/m4-suite-run.log suite mistook local predicted media visibility for server settlement; wait for authoritative receiver history before asserting uploaded reference.
- 1790205267 error attribution=agent-error source=diagnostic evidence=evidence/m5-check.txt private views sync requires principal-leading index; added index exactly as diagnostic instructed.
- 1790205422 correction-loop attribution=agent-error evidence=evidence/m5-regression-m1.json,evidence/m5-regression-m2.json,evidence/m5-regression-m3.json,evidence/m5-regression-m4.json regression runner overwrote first-green suite paths; restored exact bytes from retained stdout, verified all four choreography-bound SHA256 hashes; future suite receipts use unique timestamp names.
- 1790205891 error attribution=ambiguous sample-replay action=2 evidence=evidence/sample-replay-run.log AssertionError [ERR_ASSERTION]: {"state":"failed","id":"500812832aef215c7a43c2a096","why":{"code":"E_WRITE_ID","family":"input","message":"write id must be 26 uppercase Crockford base32 digits, starting with 0–7 (the mintId() form)","guide":"writes"}}
- 1790205914 correction-loop attribution=agent-error source=diagnostic evidence=evidence/sample-replay-run.log E_WRITE_ID requires Crockford ULID shape; encode deterministic SHA128 in correct alphabet
- 1790205914 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m6-check.txt presence guarded profile read made send nonpredictable; hoist payload reads before effect-only guard
- 1790206050 correction-loop attribution=agent-error evidence=evidence/m6-suite-run.log push test assumed original Alice displayName after M1 choreography edited it; assert current authoritative profile value
- 1790206115 correction-loop attribution=agent-error evidence=evidence/m6-suite-run2.log sample receipt validation counted a register receipt from pre-ULID failed attempt; verify latest complete 50-action run
- 1790206132 correction-loop attribution=agent-error evidence=evidence/m6-choreo-attempt1.log composer cleared text after pending prediction appeared, erasing next typed message; clear submitted text before dispatch
- 1790206500 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m8-check.txt generic post IDs needed typed references for maintained attribution; widened reply helper arguments explicitly; shaped merge result after lane block
- 1790206501 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m8-check3.txt schedule duration only m/h/d; translate JSON seconds to minutes and honor production UTC anchor
- 1790206546 correction-loop attribution=agent-error evidence=evidence/m8-suite-run.log test used sm-feed-card instead of frozen sm-feed-item; corrected suite selector
- 1790206718 correction-loop attribution=agent-error evidence=evidence/m8-doctor.txt,evidence/m8-attribution-upgrade.q nested reply attribution had four null root-post captures; added explicit immutable reply target, backfilled via Quarry job, and counted nested received engagement
- 1790206718 correction-loop attribution=agent-error source=diagnostic evidence=evidence/m8-attribution-check.txt typed post reference selected reply parent index; explicit generic-ID helper selects point lookup for attribution upgrade
- 1790206860 correction-loop attribution=agent-error evidence=evidence/backend.log,evidence/digest-proof-run.log,evidence/m8-suite-run3.log backend restart overlapped transient invalid attribution edit, so new host refused startup; freeze schema during restart proof and require readiness
- 1790207072 correction-loop attribution=agent-error evidence=evidence/m8-typecheck2.txt online snapshot helper erased generic row type; explicit boundary return type fixes client compilation
- 1790207131 correction-loop attribution=agent-error evidence=src/chats.tsx review found transient once-photo viewer could outlive tombstone or membership revocation; close/revoke viewer on either state change
- 1790207156 correction-loop attribution=agent-error evidence=src/session.tsx review added auth-screen transition when SDK observes remote session revocation
- 1790207211 correction-loop attribution=agent-error evidence=scripts/choreo.mjs immutable suite-status snapshots and automatic receipt/observation archives added; earlier overwritten observation sidecars are not claimed as complete efficiency provenance
- 1790208005 correction-loop attribution=agent-error evidence=scripts/validate-report.mjs report validator assumed optional ajv-formats installed; use existing AJV with explicit RFC3339 date-time validator
- 1790208005 classification-correction attribution=agent-error evidence=evidence/install-router.log React DOM ERESOLVE came from my unpinned install request, not a platform defect; original event retained

## Hand-authored lines

1195 physical source/test/configuration lines across 69 files. Dense code is counted as physical lines, not logical statements. Generated API, generated Quarry config, lockfile, copied frozen instrument/UI, generated assets, replay copies and build outputs are excluded. Copied shared UI: 3671 TypeScript lines. Documentation and archived development fragments are listed separately, not included in that source total.

| File | Category | Lines |
|---|---|---:|
| app.json | source/test/config | 28 |
| app/_layout.tsx | source/test/config | 5 |
| app/chats.tsx | source/test/config | 1 |
| app/conversation/[handle].tsx | source/test/config | 1 |
| app/conversation/group/[group]/index.tsx | source/test/config | 1 |
| app/conversation/group/[group]/settings.tsx | source/test/config | 1 |
| app/conversation/id/[id]/index.tsx | source/test/config | 1 |
| app/conversation/id/[id]/settings.tsx | source/test/config | 1 |
| app/index.tsx | source/test/config | 10 |
| app/insights.tsx | source/test/config | 3 |
| app/new-chat.tsx | source/test/config | 1 |
| app/post/[id].tsx | source/test/config | 8 |
| app/profile/[handle].tsx | source/test/config | 10 |
| app/profile/edit.tsx | source/test/config | 13 |
| app/search.tsx | source/test/config | 4 |
| app/settings.tsx | source/test/config | 5 |
| babel.config.js | source/test/config | 4 |
| config/runtime.json | source/test/config | 1 |
| metro-wasm-transformer.cjs | source/test/config | 10 |
| metro.config.js | source/test/config | 9 |
| package.json | source/test/config | 42 |
| scripts/acceptance.mjs | source/test/config | 23 |
| scripts/build-report.mjs | source/test/config | 30 |
| scripts/build-web.mjs | source/test/config | 7 |
| scripts/capture-final.mjs | source/test/config | 2 |
| scripts/choreo.mjs | source/test/config | 8 |
| scripts/configure.mjs | source/test/config | 21 |
| scripts/custom-client-demo.mjs | source/test/config | 13 |
| scripts/inspect-ui.mjs | source/test/config | 2 |
| scripts/log.mjs | source/test/config | 2 |
| scripts/probe-cold-media.mjs | source/test/config | 3 |
| scripts/probe-cold-offline.mjs | source/test/config | 6 |
| scripts/probe-offline.mjs | source/test/config | 3 |
| scripts/push-worker.mjs | source/test/config | 4 |
| scripts/raw-api-probe.mjs | source/test/config | 4 |
| scripts/replay.mjs | source/test/config | 49 |
| scripts/restart-backend.mjs | source/test/config | 4 |
| scripts/restart-web.mjs | source/test/config | 5 |
| scripts/security-m4.mjs | source/test/config | 3 |
| scripts/seed.mjs | source/test/config | 34 |
| scripts/serve-web.mjs | source/test/config | 3 |
| scripts/setup-identity.mjs | source/test/config | 6 |
| scripts/start-push.mjs | source/test/config | 2 |
| scripts/start-replay.mjs | source/test/config | 8 |
| scripts/start-servers.mjs | source/test/config | 10 |
| scripts/stop-servers.mjs | source/test/config | 5 |
| scripts/tests-m2.mjs | source/test/config | 28 |
| scripts/tests-m3.mjs | source/test/config | 19 |
| scripts/tests-m4.mjs | source/test/config | 16 |
| scripts/tests-m5.mjs | source/test/config | 13 |
| scripts/tests-m6.mjs | source/test/config | 6 |
| scripts/tests-m8.mjs | source/test/config | 7 |
| scripts/validate-report.mjs | source/test/config | 2 |
| scripts/verify-digest.mjs | source/test/config | 14 |
| scripts/verify-expiry.mjs | source/test/config | 4 |
| snapback/attribution.q | source/test/config | 1 |
| snapback/chat.q | source/test/config | 264 |
| snapback/digest.q | source/test/config | 29 |
| snapback/insights.q | source/test/config | 36 |
| snapback/schema.q | source/test/config | 35 |
| snapback/social.q | source/test/config | 164 |
| src/chats.tsx | source/test/config | 33 |
| src/client.ts | source/test/config | 25 |
| src/common.tsx | source/test/config | 11 |
| src/media.tsx | source/test/config | 10 |
| src/posts.tsx | source/test/config | 22 |
| src/serverRead.ts | source/test/config | 4 |
| src/session.tsx | source/test/config | 18 |
| tsconfig.json | source/test/config | 18 |
| README.md | documentation | 29 |
| API.md | documentation | 51 |
| diary.md | documentation | 33 |
| essay.md | documentation | 29 |
| scripts/m4-ui-fragment.txt | archived development fragment | 11 |
| evidence/m8-attribution-upgrade.q | applied upgrade evidence | 11 |

## Candid gaps and limits

- No native simulator proof: the seven Hermes exports are build artifacts. Native offline behavior is implemented through the pinned published module; the recorded cold-start proofs are web-only.
- Independent grader, holdouts, the complete O5 probe matrix and M7 remain for the external run. No rubric score is self-awarded.
- The base run-record.json is schema validated. The full social-messenger publication record cannot honestly be completed here: it requires external driver-stamped token/orientation custody and at least one independent grading session. Tokens and phase splits remain null rather than estimated. Earlier overwritten observation sidecars are not claimed as complete efficiency provenance; original green suite hashes were restored and verified.
- The app uses local development hosts and a static exported client. Production TLS/deployment and real APNs/FCM delivery were not requested or performed.
- Quarry reads and jobs have finite work ceilings. The digest computes each recipient atomically; an exceptionally large live unread period can park at the engine's documented job bounds. The recorded shortened-period restart/authorization proof passed; this is not an unlimited-load digest claim.
- API.md explicitly defines Posts as original posts; received likes/replies also include authored replies.
- One accidental scratch redirection outside the lane was refused by the host; no outside file was written. This is retained as an agent error in run-log.md.
- All started servers are stopped by recorded PID at the end; restart instructions are in README.md.

Evidence indices: milestone-records.json, replay-clocks.json, native-artifacts.json, line-counts.json, correction-events.json, coverage-manifest.json, performance-diagnostics.json, and run-log.md.

end=1790208259
