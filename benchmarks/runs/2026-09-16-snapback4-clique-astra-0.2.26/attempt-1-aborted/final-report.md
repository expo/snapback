# Final report

Incomplete lane: M1 aborted because the frozen choreography could not load an absent instrument dependency. No milestone is green. The wall cap was not exhausted. The DAG blocks every remaining continuous milestone; the two-consecutive-failure stop rule was not triggered.

Lane: astra-clique-snapback4-full-20260913; model: gpt-6-astra; effort: medium.

Raw lane start=1789584336; end=1789585087; elapsed=751 seconds. M1 orientation is included from the lane start. Boundary timestamps are in run-log.md. Finalization after the M1 boundary is separately included in lane elapsed.

| Milestone | Status | Start epoch | End epoch | Actual wall seconds | First green | Suite / choreography | Native |
|---|---|---:|---:|---:|---|---|---|
| M1 | aborted | 1789584336 | 1789585012 | 676 | none | suite passed; choreography startup unavailable | Hermes export |
| M2 | blocked-by-M1 | — | — | — | none | not run | none |
| M3 | blocked-by-M1 | — | — | — | none | not run | none |
| M4 | blocked-by-M1 | — | — | — | none | not run | none |
| M5 | blocked-by-M1 | — | — | — | none | not run | none |
| M6 | blocked-by-M1 | — | — | — | none | not run | none |
| M7 | not-run | — | — | — | none | separate-session scope | none |
| M8 | blocked-by-M1 | — | — | — | none | not run | none |

The complete transitive failed prerequisite set for each blocked milestone is {M1}. Per the brief's abort charging rule, M1's charged wall is 14,400 seconds; this is not its measured wall. No token counts are estimated. Harness-native token metering was unavailable to this lane; the diagnostic execution-record.json is explicitly not a validated composed harness record.

## M1 evidence

- Seven suite-required assertions map to five browser tests: m1-a01/a02 signup and authenticated onboarding; a03 duplicate handle during onboarding; a04 duplicate email; a08 edited profile persistence; a10/a11 fixture upload and image render. An additional sixth test repeats the starter segment and verifies zero profile writes on both repetitions. All pass in evidence/m1-suite.json and evidence/m1-acceptance-final.txt.
- coverage-manifest.json includes the exact ordered assertion IDs and test mapping. The frozen coverage validator passed: evidence/m1-coverage-validation.json.
- Quarry check and final TypeScript check pass: evidence/m1-check.txt and evidence/m1-typecheck-final.txt.
- Choreography was copied and installed inside the lane. Complete invocation used CHOREO_BASE_URL=http://127.0.0.1:49361, lane ID, suite status, setup identity, adapter, and lane-local receipt destination. It fails before browser startup with ERR_MODULE_NOT_FOUND for harness/lib/json-schema.mjs, imported by setup-identity.mjs. The supplied instrument does not include that module. Evidence: evidence/m1-choreography-final.txt.
- Exact instrument skip is recorded in evidence/instrument-skip.json. It is a lane diagnostic, not a fabricated harness receipt. No JSONL receipt was created by the harness; no implemented check ran. nonGreenCause=instrument.
- iOS Hermes exports: artifacts/m1-ios/_expo/static/js/ios/entry-446afe344f6926b5d5fcb355a87cc9bb.hbc (2678067 bytes); artifacts/m1-ios-final/_expo/static/js/ios/entry-16d383144c54ecf7c6f0d7a2a933290f.hbc (2678067 bytes). SHA-256 digests are in evidence/native-artifacts.json. No simulator proof is claimed.

## Pins, corrections and operations

Resolved required pins: snapback4@0.2.26, snapback4-expo@0.2.17; platform binary snapback4-darwin-arm64@0.2.26. Evidence: package-lock.json and evidence/resolved-packages.txt. Expo 57.0.22 and React Native 0.86.3 came from the published starter; the client uses Expo Router. Initial native-pin ETARGET/E404 recovered during a later npm install. Attribution remains ambiguous; it is not an unresolved platform gap. No other Snapback package version or source build was substituted.

Three recorded correction loops, all agent-error: CL1 route filename, CL2 FeedTabs prop name after browser success, CL3 strengthening the initially passing duplicate-handle test to match signup wording. Initial authoring errors and setup retries are recorded separately and not multiplied into loops. No snapback4-defect loop was established. Environment incidents: copied-directory permissions, missing harness dependency layout/module, and ambient Node 25.9.0 despite the overlay; the final harness and export use explicit Node 24.18.0.

Only ports 49360 and 49361 were used. Started server roots and discovered owned descendants are recorded in run-log.md and evidence/owned-process-cleanup.json. Cleanup sends SIGTERM only to those owned PIDs, with no pattern kills. No sibling lane, prior implementation, or source repository was inspected.

## Scale and gaps

Scale replay not run: M6 was blocked. Replay start=null, end=null, wall=null, invariant verification=null. No adapter-conformance or scale claim. No M2/M3 starter segments were installed. No M8 schedule or config behavior was implemented.

Built account/profile UI and Quarry operations only. Feed tabs are placeholders. Posts, follows, reactions, chats, receipts, messaging/media revocation, edit/delete windows, expiry, view-once, chat customization, message search, push seam, custom-client API, scale adapter, insights, trending, daily digest and multi-device offline proofs are unbuilt. Native exports demonstrate bundling, not runtime native correctness. No backend expressiveness conclusion can be drawn about those unattempted features.

## Hand-authored and edited line counts

Physical lines including blanks/comments; copied UI/harness, dependencies, generated types, build outputs and evidence excluded. Edited starter configurations are counted as whole files, explicitly not a pure-original-code measure.

| File | Lines |
|---|---:|
| snapback/schema.q | 33 |
| src/Clique.tsx | 49 |
| src/client.ts | 9 |
| src/device.ts | 8 |
| src/device.web.ts | 4 |
| src/picker.ts | 5 |
| src/picker.web.ts | 6 |
| app/_layout.tsx | 2 |
| app/index.tsx | 1 |
| app/[...path].tsx | 1 |
| scripts/seed.mjs | 36 |
| scripts/acceptance.mjs | 51 |
| package.json | 39 |
| app.json | 26 |
| tsconfig.json | 16 |
| README.md | 23 |
| essay.md | 25 |
| diary.md | 15 |

Total listed: 349 lines. The final report and run log are excluded from this source/document tally. essay.md was written before this tally.

end=1789585087
