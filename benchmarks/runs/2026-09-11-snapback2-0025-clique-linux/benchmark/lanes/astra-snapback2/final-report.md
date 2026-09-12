# Clique — final report

Lane `astra-clique-snapback2`; model `gpt-6-astra`, effort `medium`; backend public npm `snapback2@0.0.25`. All requested authoring milestones are green under ENVIRONMENT.md's suite-plus-choreography bar. M7 was not attempted. This run was **not strictly port-clean**: the first discarded M1 browser attempt contacted 53100 through an inherited environment variable. No other lane's source was inspected.

The essay was written before this tally: [essay.md](essay.md). The qualitative milestone record is [diary.md](diary.md).

## Clocks and milestone results

Raw run start: **1789163268**. Final authoring boundary: **1789172635** (9367s from run start). Latest passing receipt, including post-boundary suite-linkage verification: **1789172809.688**. Report generation: **1789173235**. Replay overlapped M8 on its own clock and is not added again to elapsed wall.

| Milestone | Status | Start epoch | Boundary end epoch | Wall seconds | First observed suite+choreo green epoch | Suite assertions / choreography passed |
|---|---|---:|---:|---:|---:|---:|
| M1 | green | 1789163268 | 1789163735 | 467 | 1789163679.315 | 7 / 3 |
| M2 | green | 1789163735 | 1789164292 | 557 | 1789164238.076 | 22 / 9 |
| M3 | green | 1789164292 | 1789165485 | 1193 | 1789165415.687 | 7 / 7 |
| M4 | green | 1789165485 | 1789166902 | 1417 | 1789166870.881 | 5 / 5 |
| M5 | green | 1789166902 | 1789168126 | 1224 | 1789168046.281 | 6 / 4 |
| M6 | green | 1789168126 | 1789168581 | 455 | 1789168500.247 | 5 / 1 |
| M8 | green | 1789168581 | 1789172635 | 4054 | 1789170355.921 | 6 / 5 |
| M7 | not-run | — | — | — | — | Separate fresh session excluded |

M1 is charged from the run start, including the 16 seconds before its explicit start marker. The M8 start marker was late; its charged start is conservatively the M6 boundary. First-green receipt times can precede the boundary because artifact export, additional proofs and corrections continued. The final M3 receipt was regenerated after the essay to bind the updated regression-suite hash; its original first-green receipt remains in evidence. No milestone reached the four-hour cap; there were no capability failures.

Every current suite receipt is hash-matched to its current choreography summary. [Coverage validation](evidence/coverage-validation.json) confirms the combined manifest covers every suite-required ID. Per-milestone suites, manifests and JSONL receipts are under `evidence/suite-mN.json`, `coverage-mN.json`, and `choreography-mN.jsonl`. [run-record.json](run-record.json) is an authoring-phase record validated against the base protocol schema; full composed grading/metering validity is not claimed.

## Replay and scale

Original start **1789168581**, verified end **1789171175**, gross **2594s**. All **167157** actions settled. Checkpoint pauses at 10/50% total **64.666s**; measured final verification is **99.257s**. Separating both yields **2430.077s** of replay/setup/retry wall. The unchanged raw runner receipt records only the 10/50 exclusions; [scale-clock.json](evidence/scale-clock.json) makes the final-verification correction explicit.

The first instance stopped after 8,057 accepted actions when my erroneous 100-membership cap rejected action 8,058. The successful retry used a fresh seeded instance and retained the original clock. A setup retry also failed before its owner was running. None of these intervals were erased.

10%, 50% and 100% invariant verification all pass. Final counts include 1008 users, 50228 posts, 100015 messages, 5921 follow edges, 1002 conversations and 2054 memberships. Verification checks every manifest per-user/per-chat count, group roster, named O5 fixture and named spot entity. Hash: `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`. Full settlement receipts and checkpoints: [scale-replay-retry](evidence/scale-replay-retry/).

After verification, additive M8 migration preserved core fixture state. [Full-corpus API proof](evidence/scale-insights-proof.json) verifies six totals, seven UTC buckets and Trending for five accounts against independent reconstruction. [Scale browser proof](evidence/scale-browser-proof.json) verifies real rendering and API origin 53202. Search beyond the first 100 conversations is exercised. These are local API/browser samples; they do not claim the independent grader's complete M8 degradation bands.

## Native and additional proofs

Seven milestone Hermes exports exist; [artifact inventory](evidence/native-build-artifacts.json) records paths, bytes, magic and hashes. M8's authoritative export is `artifacts/m8-ios-final`. M6 and M8 Apple simulator proofs are **unavailable / not-run because this is Linux**. Neither the exports nor the web restart screenshot substitutes for native execution.

Additional passing evidence: [anchored digest and restart](evidence/digest-proof.json), [digest read/unsend/revocation](evidence/digest-custody-proof.json), [configured expiry and unread cleanup](evidence/expiry-counter-proof.json), [web durable queue restart](evidence/web-durable-proof.json), [out-of-head quote jump](evidence/quote-history-proof.json), and final TypeScript/Quarry checks. The web restart proof kept the web shell reachable while partitioning the backend; it is explicitly not a fully offline native cold launch.

## Corrections and attribution

[Correction register](evidence/correction-register.json) retains 64 logged error/retry/correction entries with attribution and evidence. This is a count of recorded entries, **not an invented exact count of independent loops**: some lines bundle related corrections and some diagnoses were later revised. The full timestamped history is [run-log.md](run-log.md).

| Area | Attribution and resolution |
|---|---|
| Initial endpoint, module mode, duplicate route screen | Inherited environment plus agent setup errors; discarded cross-port attempt, explicit endpoint guard, module scope and Router Slot |
| M2 web semantics and Metro watcher | Environment/integration: explicit accessibility values, worker cap and generated-tree exclusions |
| M3 DM identity, roster navigation, onboarding reset | Agent errors: canonical pair index, authenticated keepalive admission, persistent confirmed account state |
| M3 starter-group receipt check | Exact instrument mismatch: Erin is a member but no Erin client is launched; documented fixture adapter uses a real Alice/Bob/Carol trio, preserving the original starter |
| M4 edit drafts and bounded composite pages | Agent errors: preserve draft identity/actions; clear submitted input before awaiting; ten rich rows fit where fifty exceeded budget |
| M5 once/expiry/history presentation | Agent errors and web integration: parent viewer, authoritative retained-row reconciliation, durable kind label and on-open reference |
| Replay cap and setup retry | Agent error: fixture probe envelope was incorrectly made a universal membership cap; fresh retry retained clock |
| M8 aggregates and digest | Agent errors: server freshness, compact contributions, UTC-anchored row timer, exact custody cleanup |
| Long-job CLI polling | snapback2-defect: E_OWNER_NOT_RUNNING / Resource temporarily unavailable while owner lived and job completed; status plus trace recovered completion |
| Scale web and nullable joins | Shared-root configuration ambiguity followed by an agent null-handling error; isolated client and guarded hydration |
| Quote history and evidence linkage | Agent test/scroll timing errors fixed; current suite hashes re-bound with a fresh M3 choreography run |

## Resolved package pins

| Package | Resolved version |
|---|---|
| expo | 54.0.37 |
| expo-constants | 18.0.14 |
| expo-file-system | 19.0.24 |
| expo-image-picker | 17.0.11 |
| expo-linking | 8.0.12 |
| expo-router | 6.0.24 |
| expo-secure-store | 15.0.8 |
| expo-sqlite | 16.0.10 |
| expo-video | 3.0.16 |
| react | 19.1.0 |
| react-dom | 19.1.0 |
| react-native | 0.81.5 |
| react-native-safe-area-context | 5.6.2 |
| react-native-screens | 4.16.0 |
| react-native-web | 0.21.2 |
| snapback2 | 0.0.25 |
| snapback2-linux-x64 | 0.0.25 |
| typescript | 5.9.2 |
| playwright | 1.62.1 |

The root lockfile and independent clean-client install retain the exact backend pin. No source checkout or alternate backend implementation was used.

## Hand-authored lines

**1827 physical lines across 105 files**, under the method in [hand-authored-loc.json](evidence/hand-authored-loc.json). Counts include tests, migrations, diagnostics and report tooling. Installed packages, isolated copies, known unchanged scaffold helpers and generated constants are excluded. Vendored UI counts are changed lines only. Dense single-line source makes physical LOC a weak complexity measure; byte counts are retained in the JSON inventory.

| File | Counted lines | Category |
|---|---:|---|
| app.config.js | 6 | configuration |
| app/_layout.tsx | 10 | client |
| app/chat/[id].tsx | 1 | client |
| app/chats.tsx | 1 | client |
| app/chatsettings/[id].tsx | 1 | client |
| app/conversation/[handle].tsx | 1 | client |
| app/conversation/group/[group]/index.tsx | 1 | client |
| app/conversation/group/[group]/settings.tsx | 1 | client |
| app/index.tsx | 1 | client |
| app/insights.tsx | 1 | client |
| app/new-chat.tsx | 1 | client |
| app/post/[postId].tsx | 1 | client |
| app/profile/[handle].tsx | 1 | client |
| app/profile/edit.tsx | 1 | client |
| app/search.tsx | 1 | client |
| app/settings.tsx | 1 | client |
| metro.config.js | 1 | configuration |
| scripts/acceptance.mjs | 27 | tooling/tests |
| scripts/backfill-once-labels.mjs | 6 | tooling/tests |
| scripts/build-insights-expected.mjs | 13 | tooling/tests |
| scripts/choreo.mjs | 5 | tooling/tests |
| scripts/cleanup-servers.mjs | 12 | tooling/tests |
| scripts/configure-digest.mjs | 1 | tooling/tests |
| scripts/configure.mjs | 3 | tooling/tests |
| scripts/custom-client-demo.mjs | 21 | tooling/tests |
| scripts/debug-conversation.mjs | 1 | tooling/tests |
| scripts/debug-cutoff.mjs | 1 | tooling/tests |
| scripts/debug-edit-loop.mjs | 1 | tooling/tests |
| scripts/debug-edit-pair.mjs | 1 | tooling/tests |
| scripts/debug-edit.mjs | 1 | tooling/tests |
| scripts/debug-media.mjs | 1 | tooling/tests |
| scripts/debug-remove.mjs | 1 | tooling/tests |
| scripts/debug-settings.mjs | 1 | tooling/tests |
| scripts/debug.mjs | 1 | tooling/tests |
| scripts/digest-custody-proof.mjs | 11 | tooling/tests |
| scripts/digest-proof.mjs | 21 | tooling/tests |
| scripts/ephemeral-suite.mjs | 11 | tooling/tests |
| scripts/expiry-counter-proof.mjs | 5 | tooling/tests |
| scripts/expiry-proof.mjs | 2 | tooling/tests |
| scripts/finalize-report.mjs | 22 | tooling/tests |
| scripts/finish-scale-upgrade.mjs | 5 | tooling/tests |
| scripts/group-reset.mjs | 1 | tooling/tests |
| scripts/insights-suite.mjs | 19 | tooling/tests |
| scripts/inspect-members.mjs | 1 | tooling/tests |
| scripts/m5-schema.py | 30 | tooling/tests |
| scripts/m5-ui.py | 21 | tooling/tests |
| scripts/m5-viewer.py | 3 | tooling/tests |
| scripts/m8-refine.py | 52 | tooling/tests |
| scripts/m8-schema.py | 32 | tooling/tests |
| scripts/media-suite.mjs | 9 | tooling/tests |
| scripts/messaging-suite.mjs | 12 | tooling/tests |
| scripts/observe-browser.mjs | 4 | tooling/tests |
| scripts/offline-suite.mjs | 7 | tooling/tests |
| scripts/pids.mjs | 2 | tooling/tests |
| scripts/prepare-choreo.ts | 1 | tooling/tests |
| scripts/quote-history-proof.mjs | 2 | tooling/tests |
| scripts/replay.ts | 50 | tooling/tests |
| scripts/scale-browser-proof.mjs | 5 | tooling/tests |
| scripts/scale-insights-proof.mjs | 7 | tooling/tests |
| scripts/scale-label-finish.mjs | 3 | tooling/tests |
| scripts/seed.ts | 31 | tooling/tests |
| scripts/setup.mjs | 5 | tooling/tests |
| scripts/social-suite.mjs | 27 | tooling/tests |
| scripts/upgrade-scale.mjs | 11 | tooling/tests |
| scripts/verify-replay.mjs | 43 | tooling/tests |
| scripts/web-durable-proof.mjs | 21 | tooling/tests |
| scripts/window-proof.mjs | 1 | tooling/tests |
| shared/thread.ts | 33 | client |
| snapback/access.q | 3 | backend |
| snapback/delivery.ts | 10 | backend |
| snapback/digest.q | 125 | backend |
| snapback/feeds.q | 16 | backend |
| snapback/follows.q | 22 | backend |
| snapback/groups.q | 103 | backend |
| snapback/insights.q | 21 | backend |
| snapback/messages.q | 220 | backend |
| snapback/posts.q | 55 | backend |
| snapback/profiles.q | 42 | backend |
| snapback/push.q | 12 | backend |
| snapback/runtime.q | 4 | backend |
| snapback/schema.q | 406 | backend |
| src/Auth.tsx | 15 | client |
| src/backend.ts | 3 | client |
| src/Connectivity.tsx | 1 | client |
| src/Connectivity.web.tsx | 2 | client |
| src/GlobalSearch.tsx | 22 | client |
| src/Insights.tsx | 3 | client |
| src/Media.tsx | 3 | client |
| src/Media.web.tsx | 3 | client |
| src/Messaging.tsx | 27 | client |
| src/online.ts | 2 | client |
| src/platform.ts | 3 | client |
| src/platform.web.ts | 5 | client |
| src/Profile.tsx | 16 | client |
| src/Search.tsx | 9 | client |
| src/Social.tsx | 12 | client |
| src/Trending.tsx | 4 | client |
| ui/src/Avatar.tsx | 2 | vendored UI changed lines |
| ui/src/ChatListRow.tsx | 1 | vendored UI changed lines |
| ui/src/ChatSettingsForm.tsx | 7 | vendored UI changed lines |
| ui/src/Composer.tsx | 1 | vendored UI changed lines |
| ui/src/FeedCard.tsx | 4 | vendored UI changed lines |
| ui/src/MessageBubble.tsx | 1 | vendored UI changed lines |
| ui/src/PollDisplay.tsx | 3 | vendored UI changed lines |
| ui/src/ReceiptTicks.tsx | 1 | vendored UI changed lines |

## Candid gaps and limits

- The initial discarded 53100 request violated the assigned-port rule. It included signup/profile traffic. It was detected and stopped; no claim of a perfectly isolated run is made.
- Native simulator execution is unavailable on this host. Native UI, plugin integration and native durable restart have bundle evidence only.
- The frozen starter-group aggregate receipt check is structurally impossible as written without Erin. [Exact instrument skip](evidence/instrument-skip-m3.json) and original receipt are retained; the documented trio adapter passed without weakening receipt rules.
- Global search uses paged per-chat requests because a 1,000-lane merge exceeded closure/heap limits and alternate batch forms were refused. The low-level convenience merge still has a documented 100-lane envelope. Large broad searches incur multiple requests; the UI renders results in bounded batches.
- Long-job CLI --wait polling was unreliable under this run's load. Durable jobs completed and were verified by trace. Period timers have no UTC-anchor syntax; the app implements the configured anchor with a persisted row deadline.
- Numeric authentication token TTL is not documented/exposed by the public AuthSession type. Clients handle expiry/refusal rather than assuming permanent tokens.
- The package's native test command was discovered but not executed because its public surface did not expose an owner-port selector within the assigned range. Authenticated suites and copied choreography provide the functional bar.
- No independent external grader ran; no complete M8 10/50/100 browser degradation score is claimed. Token counts, compaction counts, tool totals and exact four-way phase splits are unavailable rather than estimated. The official unavailable adapter is recorded; full graded/metered record composition remains external.
- This is local, production-shaped software, not a deployed or operationally audited service. Client formatting/refactoring and broader production hardening remain work beyond the timed instrument.

Process shutdown is recorded in [server-cleanup.json](evidence/server-cleanup.json); only exact tracked lane PIDs are terminated.

end=1789173235
