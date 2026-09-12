# Clique / astra-clique-snapback3 final report

Incomplete diagnostic: M1 is **aborted**, all continuous descendants are **blocked-by-M1**. The installed worker refuses the mandatory avatar image schema. The four-hour cap was not exhausted. No milestone is green.

The decisive diagnostic in [m1-media-check.json](evidence/m1-media-check.json) is:

> S3_CAPABILITY_UNAVAILABLE: this slice supports Quarry queries and mutations; effects, jobs, channels, schedules, clock-sensitive live queries and media need their runtime slice

The exact attempted Quarry sources are [m1-media-schema.q](evidence/m1-media-schema.q) and [m1-media-profiles.q](evidence/m1-media-profiles.q). The partial textual schema certifies, and both the UI and reporting name its media limitation. No installed implementation was modified, no alternate backend was added, and no prohibited checkout or benchmark implementation was read. No agents were delegated.

## Raw clocks and outcomes

Run start=1789222660. M1 terminal=1789223246. Reporting snapshot/end=1789223585. Actual M1 authoring wall=586 seconds, including initial orientation. Post-terminal narrative/reporting=339 seconds. Total elapsed to reporting snapshot=925 seconds. The contract charges an abort at the full wall cap: **14400 seconds**, separately from the observed wall. Token values/caps/charges are null; no authenticated controller or joined native usage stream was supplied. Phase partitions are unmeasured and null. Several early lookup timestamps were retrospective markers; the correction is explicitly logged.

| Milestone | Status | Start epoch | End epoch | Actual wall s | First green | Suite | Choreography |
|---|---|---:|---:|---:|---|---|---|
| M1 | aborted | 1789222660 | 1789223246 | 586 | null | 5 pass / 2 platform failures | 3/3 pass; combined green=false |
| M2 | blocked-by-M1 | null | null | null | null | not-run | not-run |
| M3 | blocked-by-M1 | null | null | null | null | not-run | not-run |
| M4 | blocked-by-M1 | null | null | null | null | not-run | not-run |
| M5 | blocked-by-M1 | null | null | null | null | not-run | not-run |
| M6 | blocked-by-M1 | null | null | null | null | not-run | not-run |
| M7 | not-run | null | null | null | null | not-run | not-run |
| M8 | blocked-by-M1 | null | null | null | null | not-run | not-run |

M2 and M3 require M1; M4/M5 require M3; M6 requires M2/M3/M4/M5; M8 requires M6. The complete failed root prerequisite set is **[M1]** in every blocked entry. Blocks do not count as additional failures. The lane ends because no runnable continuous milestone remains, not because it experienced two independent failures. M7 was excluded by instruction.

## Verification and artifacts

- [M1 suite](evidence/m1-suite.json), [coverage](evidence/m1-coverage.json): all seven suite-required IDs mapped; five behavioral tests pass, avatar upload/render explicitly fail for unavailable media. No successful seed claimed.
- [Frozen choreography JSONL](evidence/choreography-m1.jsonl): three required browser checks pass, no skips. Combined green=false, nonGreenCause=**suite-failed**, outcomeClass=**platform**. Run ID=8ac4a37c-ddfe-42e6-bd94-cbc37f8c7c4e. The separate observations stream is retained beside it. No instrument skip was needed.
- [TypeScript](evidence/typecheck.log) passes. [Auth API probe](evidence/auth-probe.json) confirms short-password denial, future expiry, and server refusal of the old token after logout.
- [Web export](evidence/web-export.log) in dist/; [M1 iOS Hermes export](evidence/ios-export.log) in artifacts/m1-ios/. Hermes bytecode is produced. No exports exist for blocked milestones.
- M6/M8 native proof: **unavailable / not-run — Linux host cannot run an Apple iOS simulator**. [Native status](artifacts/native-status.json). Bundle export is not simulator proof. Native persistent storage is not implemented in this partial client.
- [Seed attempt](evidence/seed-m1.json) stops at the first unsupported profile-set avatar action. The separate [diagnostic text load](evidence/seed-m1-partial.json) creates useful browser personas but is explicitly nonconforming and does not install M1. M2/M3 segments are blocked.
- Scale replay: **not-run**, start=null, end=null, wall=null; fresh-instance replay and invariant-manifest verification **not-run**, because the M6 adapter milestone is blocked. No performance claim or O5 score.
- [Setup identity](setup-identity.json) hash-binds the worker and CLI. The supplied immutable tarball digest was verified; prepack qualification is the supplied package's qualification, not a claim that this lane ran a publisher prepack workflow. The frozen UI copy and its dependency declarations compare byte-for-byte equal; evidence/ui-preservation.txt is empty diff output. Choreography and metering are sibling copies; install ran only inside the choreography copy.
- Server PID **1430597**, port **54800**, recorded and stopped with SIGTERM. No pattern kills. Wrapper exited after its child. No external server ports used.

## Corrections and known limits

One completed-work correction loop, **agent-error**: the profile UI displayed E_CONSTRAINT rather than the explanatory server message. Retaining receipt.message made the duplicate-handle browser check pass. [Evidence](evidence/correction-01.md). First-pass implicit-id/index, keyed-write grammar, and FeedTabs prop errors were fixed before a success claim and are not counted as loops. The missing media slice is attributed to the platform capability, not misrepresented as an unexpected runtime defect. npm emitted an optional worklets peer-version warning; web and Hermes exports succeeded, with no native execution inference.

The build is not production-complete. Avatars are missing; signup and profile completion are separate steps; the full starter segment cannot install. Posts/follows, messaging, media, receipts, reactions, edit/delete windows, disappearing/view-once, search, offline messaging, push, custom-client messaging API, replay, insights, digest, and multi-device convergence were not authored because their prerequisites failed. The empty feed tabs are M1 navigation shell only; they implement no social feed. Native session persistence/offline guarantees remain absent. No later test coverage or green status is implied.

run-record.json is an honest pre-grading diagnostic record. A fully composed post-grading/metering record is not claimed: this run has no grader session or authenticated metering/clock-correlation manifest. The composed schema requires those artifacts; fabricated grading sessions or measured skew would be false. Base-schema validation passes. The composed validator additionally reports missing orientation, typing-boundary, observability-protocol, efficiency-eligibility, and suite-linkage metadata in this diagnostic record. Suite linkage itself was validated by choreography and is retained in suite-status.json and its receipts. Exact validation errors are in evidence/record-validation.json. This is an instrumentation/reporting limitation in addition to the product gap.

## Resolved application pins

- @expo/metro-runtime: 57.0.15
- expo: 57.0.22
- expo-router: 57.0.21
- react: 19.2.3
- react-dom: 19.2.3
- react-native: 0.86.2
- react-native-safe-area-context: 5.7.0
- react-native-screens: 4.26.0
- react-native-web: 0.21.2
- snapback3: 0.0.1-experimental.0
- @types/react: 19.2.0

Node: **/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node v24.13.1**. npm 11.8.0; Playwright 1.62.1; Chromium 151 host cache; Ubuntu Linux x64 on expose-builder-pixel. package-lock.json retains the complete transitive closure. Snapback tarball SHA-256: 719eba5bfaffeebf117ca3e10d60d830da2ca4ca735693ea0e46f0d6317fcb4e.

## Hand-authored physical lines

Source/config/test files only; copied UI/instrument, generated declarations, exports, dependencies, documentation, and evidence excluded. Counts are physical lines, not complexity or quality scores. Full machine-readable listing: evidence/hand-authored-lines.json.

| File | Lines |
|---|---:|
| package.json | 34 |
| app.json | 1 |
| tsconfig.json | 1 |
| app/_layout.tsx | 5 |
| app/index.tsx | 3 |
| app/settings.tsx | 3 |
| app/profile/[handle].tsx | 4 |
| app/profile/edit.tsx | 3 |
| src/client.tsx | 4 |
| src/screens.tsx | 16 |
| scripts/acceptance.mjs | 29 |
| scripts/auth-probe.mjs | 10 |
| scripts/choreography.mjs | 4 |
| scripts/seed.mjs | 30 |
| scripts/server.mjs | 6 |
| scripts/setup-identity.mjs | 6 |
| snapback/profiles.q | 9 |
| snapback/schema.q | 15 |

Total: 183 lines across 18 files. The code contains dense lines; do not interpret this as normalized statement count.

The qualitative [essay](essay.md) was written before this tally. [Builder assessment](builder-assessment.json) applies nulls to unobserved dimensions and supplies no weighted total. This N=1 diagnostic supports no comparative speed or variance claim.

end=1789223585
