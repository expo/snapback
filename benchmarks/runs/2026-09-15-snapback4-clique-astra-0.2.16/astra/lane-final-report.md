# Clique final report

Lane: astra-clique-snapback4-full-20260913 · gpt-6-astra · effort=medium.

**M1–M6 and M8 are green. M7 was not run, as instructed.** The final fresh scale replay and invariant/API verification passed. Performance gate: **pass**.

## Clocks and proof

Raw lane start=1789438589; report end=1789443807; elapsed=5218s. Raw boundary intervals below include verification and later hardening. First-green timestamps are retained independently; scale overlaps M8 and must not be added to these intervals. The 77-second M4→M5 boundary gap contains the supplementary expired-edit probe; it remains charged in total lane elapsed.

| Milestone | Status | Start epoch | End epoch | Wall s | First green UTC | Suite / required choreography | iOS Hermes artifact |
|---|---|---:|---:|---:|---|---|---|
| M1 | green | 1789438589 | 1789438976 | 387 | 2026-09-15T02:22:25.481Z | 7 suite assertions / 3 of 3 choreography checks (3 required) | artifacts/m1-ios |
| M2 | green | 1789438976 | 1789439546 | 570 | 2026-09-15T02:31:00.527Z | 22 suite assertions / 9 of 9 choreography checks (9 required) | artifacts/m2-ios-complete |
| M3 | green | 1789439547 | 1789439942 | 395 | 2026-09-15T02:38:06.418Z | 7 suite assertions / 7 of 7 choreography checks (5 required) | artifacts/m3-ios-final |
| M4 | green | 1789439942 | 1789440077 | 135 | 2026-09-15T02:41:16.922Z | 5 suite assertions / 5 of 5 choreography checks (5 required) | artifacts/m4-ios |
| M5 | green | 1789440154 | 1789440878 | 724 | 2026-09-15T02:53:47.039Z | 6 suite assertions / 4 of 4 choreography checks (2 required) | artifacts/m5-ios-final |
| M6 | green | 1789440878 | 1789441669 | 791 | 2026-09-15T03:01:30.403Z | 5 suite assertions / 1 of 1 choreography checks (1 required) | artifacts/m6-ios |
| M8 | green | 1789441669 | 1789443365 | 1696 | 2026-09-15T03:15:11.158Z | 6 suite assertions / 5 of 5 choreography checks (5 required) | artifacts/m8-ios-final |
| M7 | not-run | — | — | — | — | Explicitly separate session | — |

All suite coverage lives in [coverage-manifest](evidence/coverage-manifest.json); suite and neutral choreography receipts are under evidence/mN-*. Each milestone has an actual exported .hbc artifact. Supplemental native restart checks m8-a17/a18 are not claimed; the exact supplemental statuses are `ios-simulator-m6: not-recorded` ("M6 simulator evidence is recorded separately from web green") and `ios-simulator-m8: not-recorded` ("M8 simulator evidence is recorded separately from web green"), each `requiredForGreen=false`. There are no required-check instrument skips. No required implemented choreography check remains failed.

## Scale replay

First attempt: start=1789441969, end=1789442123; failed with EADDRNOTAVAIL after over 50,000 settled actions. Its 10% invariants passed, while Following exceeded the relative performance limit. Evidence is preserved under evidence/scale-attempt1/.

Final attempt: start=1789442353, workloadStart=1789442354, replay/verification end=1789443576, raw wall=1223s. These raw intervals include checkpoint verification/probes; no calibrated replay cap was supplied, and no cap fraction is invented. The fixture has 167,157 scale actions plus 86 starter actions, 1,008 real accounts, 50,228 posts and 100,015 messages. Both checkpoint manifests and all final invariant comparisons passed; the independent API check walked all 10,000 busy-group messages through 200 pages and checked representative media/quoted-message classes and registration receipts. The verified original store remains stopped and unchanged; interactive write probes ran on a stopped-copy instance.

| Performance comparison | Actual | Limit | Result |
|---|---:|---:|---|
| Following500 / Following5 | 1.034 | 3.000 | pass |
| Celebrity follower / Following5 | 1.142 | 3.000 | pass |
| History page50 / page1 | 0.983 | 3.000 | pass |
| search final / 10% | 1.276 | 3.000 | pass |
| search 50% below interpolated curve | 1.345 | 3.009 | pass |
| insights final / 10% | 0.939 | 3.000 | pass |
| insights 50% below interpolated curve | 0.341 | 1.691 | pass |
| trending final / 10% | 0.996 | 3.000 | pass |
| trending 50% below interpolated curve | 0.538 | 1.974 | pass |
| Celebrity write / 5-follower write | 0.952 | 3.000 | pass |

Cold 100-conversation sync: 1421ms. Fifty-member send-to-render: 838ms. Sampling, heap observations and write cohorts: [performance evidence](evidence/scale-performance.json). No cross-backend absolute-speed claim is made.

## Corrections and attribution

25 grouped correction loops: agent-error=18, environment=6, ambiguous=1; confirmed snapback4 defects=0. First-pass compile iterations remain in run-log.md but are excluded from this grouped protocol tally. Multiple attempts at the same failure are one loop.

| Attribution | Correction | Evidence |
|---|---|---|
| agent-error | Cold-scale probe assumed a button role; used actual Chats route | evidence/scale-web-probe-output-first.txt |
| agent-error | Final API spotcheck assumed view-once content in scale fixture; scale has none, while sample/M5 cover it | evidence/scale-api-output.txt |
| environment | Node PATH differed from overlay; absolute Node24 fixed seed execution | evidence/m1-seed.txt |
| environment | Copied readonly modes prevented installation | evidence/npm-choreography.txt |
| environment | Copied choreography required its relative metering dependency | evidence/m1-choreo-output.txt |
| agent-error | Unused starter screens referenced replaced operations | evidence/m1-types.txt |
| agent-error | Native Image.resolveAssetSource unavailable on web | evidence/web.log |
| agent-error | Pagination test needed more than one page of visible events | evidence/m2-acceptance.txt |
| environment | Harness default fixture path assumed original layout | evidence/m2-choreo-retry.txt |
| agent-error | Feed tabs needed to remain reachable after profile navigation | evidence/m2-choreo-retry.txt |
| agent-error | Own repost needed a separate discriminator from original event | snapback/social.q |
| environment | ffmpeg missing x265; Chromium extracted the actual poster frame | evidence/video-poster.txt |
| ambiguous | Admin removal lost across immediate document navigation; synchronous authenticated keepalive fixed it | evidence/m3-choreo-first.txt |
| agent-error | Suite raced Metro startup; readiness wait added | evidence/m3-suite-retry.txt |
| agent-error | View-once modal needed tombstone and unmount cleanup | src/Chats.tsx |
| agent-error | Installer ledger retained raw fixture credentials; replaced with private ordinal receipts and removed ledger | scripts/seed.mjs |
| agent-error | Insights navigation prop did not exist in kit; explicit button added | evidence/m8-suite-first.txt |
| agent-error | Assertion helper required RegExp, not a string | evidence/m8-suite-second.txt |
| agent-error | Home needed chat rows for cross-device unread observation | evidence/m8-choreo-first.txt |
| environment | First replay exhausted ephemeral sockets; paced actions and same-ID transport retries | evidence/scale-attempt1/scale-output.txt |
| agent-error | Wide Following merge failed 3x rule; delivery/broadcast projections replaced it | evidence/scale-attempt1/scale-10%-probes.json |
| agent-error | Digest restart coincided with temporarily invalid schema; valid server restarted before next boundary | evidence/m8-suite-final.txt |
| agent-error | Generated feed/profile result changes exposed UI type assumptions | evidence/m8-types-final.txt |
| agent-error | Digest test began too near a period boundary; setup waits for sufficient window | scripts/digest-probe.mjs |
| agent-error | Native session keys needed SecureStore normalization | src/session.ts |

## Pins and line counts

Resolved public registry packages: **snapback4@0.2.16**, **snapback4-expo@0.2.7**; see evidence/resolved-pins.json and package-lock.json. The optional host binary is the package's published arm.

Hand-authored source/test/operational code: 1093 physical lines across 62 files. Copied UI/fixtures, generated types/constants, dependencies, bundles, databases and prose are excluded. Dense TSX formatting makes this a physical-line measure, not a semantic complexity measure. Edited scaffold/build metadata (package.json, app.json, tsconfig.json, Metro/Babel configuration) is excluded from the source/test total.

| File | Lines |
|---|---:|
| app/_layout.tsx | 4 |
| app/chats.tsx | 1 |
| app/conversation/[handle].tsx | 1 |
| app/conversation/group/[group]/index.tsx | 1 |
| app/conversation/group/[group]/settings.tsx | 1 |
| app/index.tsx | 1 |
| app/insights.tsx | 1 |
| app/new-chat.tsx | 1 |
| app/post/[id].tsx | 1 |
| app/profile/[handle].tsx | 4 |
| app/profile/edit.tsx | 1 |
| app/search.tsx | 1 |
| app/settings.tsx | 1 |
| scripts/accept-m2.mjs | 17 |
| scripts/accept-m3.mjs | 7 |
| scripts/accept-m4.mjs | 9 |
| scripts/accept-m5.mjs | 5 |
| scripts/accept-m6.mjs | 8 |
| scripts/accept-m8.mjs | 7 |
| scripts/acceptance.mjs | 24 |
| scripts/boundary.mjs | 4 |
| scripts/build-report.mjs | 21 |
| scripts/cache-shell.mjs | 2 |
| scripts/choreo.mjs | 7 |
| scripts/configure.mjs | 5 |
| scripts/custom-client-demo.mjs | 5 |
| scripts/digest-probe.mjs | 8 |
| scripts/durable-web-probe.mjs | 2 |
| scripts/expiry-probe.mjs | 2 |
| scripts/log.mjs | 3 |
| scripts/owned-processes.mjs | 2 |
| scripts/probe-remove.mjs | 1 |
| scripts/replay.mjs | 30 |
| scripts/run-scale.mjs | 3 |
| scripts/scale-performance.mjs | 3 |
| scripts/scale-probes.mjs | 7 |
| scripts/scale-web-probe.mjs | 3 |
| scripts/seed.mjs | 13 |
| scripts/serve-web.mjs | 4 |
| scripts/server-start.mjs | 4 |
| scripts/start-scale-clone.mjs | 2 |
| scripts/start-scale.mjs | 2 |
| scripts/start-static.mjs | 2 |
| scripts/verify-scale-api.mjs | 10 |
| scripts/verify-scale.mjs | 17 |
| scripts/video-poster.mjs | 2 |
| scripts/window-probe.mjs | 2 |
| snapback/chat.q | 273 |
| snapback/digest.q | 52 |
| snapback/feed.q | 95 |
| snapback/insights.q | 69 |
| snapback/runtime.q | 2 |
| snapback/schema.q | 48 |
| snapback/social.q | 150 |
| snapback/worker.mjs | 6 |
| src/AppShell.tsx | 41 |
| src/Button.tsx | 3 |
| src/Chats.tsx | 32 |
| src/Insights.tsx | 10 |
| src/Posts.tsx | 23 |
| src/adminWrite.ts | 11 |
| src/session.ts | 16 |

## Candid limits

- Native execution was not requested: Hermes exports exist, but no simulator/device receipt or physical-power-loss durability claim is made. A browser restart probe passed.
- APNs delivery, production TLS/hosting and store signing are outside this local logged-push build. Expo Go uses the documented online fallback; a custom native build uses the pinned replica arm.
- Following backfills 200 historical events per new follow. The public projection policy reflects public posts/follows; conversation data remains membership-protected. Public profile sync is intentionally unbounded at this 1,008-profile envelope.
- Query/job ceilings remain finite; counts and ranking use maintained read models. A single digest membership chunk is bounded at 10,000 period messages, matching the busy-chat fixture envelope.
- The >24-hour trending exclusion test used a dev-only system seed for backdated existing data, then real authenticated likes. Starter/sample/scale replay used only app auth, uploads and mutations.
- No external grader holdouts or complete composed grading record are claimed. run-record.json validates the base protocol schema. Harness-native tokens and precise phase metering were unavailable inside the authorized lane and remain null, without estimates or efficiency-score claims.
- Early receipt input paths were mutable; current runs preserve immutable suite-input snapshots. Raw historic receipts and stdout evidence remain available.
- The first replay's transport failure and initial feed performance miss are retained, not hidden by the successful retry. No required product feature was struck, and no source-package substitution was used.

See [essay](essay.md), written before the final tally, [diary](diary.md), and [run log](run-log.md). Server cleanup records identify only lane-owned PIDs.

end=1789443807
