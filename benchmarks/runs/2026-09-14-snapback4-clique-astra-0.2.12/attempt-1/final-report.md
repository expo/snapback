# Final report: incomplete lane

Lane: `astra-clique-snapback4-full-20260913` · model: `gpt-6-astra` · effort: `medium`.

M1's application suite passed, but **no milestone is green**. The frozen choreography failed during module loading because `choreography/setup-identity.mjs` imports `../../lib/json-schema.mjs`. That helper is absent from the supplied instrument and resolves outside the permitted lane. The exact diagnostic is `ERR_MODULE_NOT_FOUND`; see [startup evidence](evidence/m1-choreo-final-output.log). No frozen JSONL receipts were emitted. The lane-authored [instrument skip record](evidence/m1-instrument-skip.jsonl) explicitly identifies itself and does not impersonate a harness receipt.

M1 was aborted before its four-hour cap. Under the brief's DAG, all remaining continuous-session milestones are blocked transitively by M1. This is not two independent capability failures, and it is not a completed build of Clique.

## Clocks and statuses

Raw run start: **1789407049**. Raw run end: **1789407803**. Actual run wall: **754 seconds**. M1 includes orientation from the run origin; the explicit M1 log marker was 1789407080. The authoring terminal precedes report/cleanup time. No first-green time exists. The protocol charges an aborted milestone its full 14,400-second cap; actual wall is retained below, not represented as cap exhaustion.

| Milestone | Status | Start epoch | Terminal epoch | Actual wall seconds | First green |
|---|---|---:|---:|---:|---|
| M1 | aborted | 1789407049 | 1789407733 | 684 | — |
| M2 | blocked-by-M1 | — | — | — | — |
| M3 | blocked-by-M1 | — | — | — | — |
| M4 | blocked-by-M1 | — | — | — | — |
| M5 | blocked-by-M1 | — | — | — | — |
| M6 | blocked-by-M1 | — | — | — | — |
| M7 | not-run | — | — | — | — |
| M8 | blocked-by-M1 | — | — | — | — |

Every blocked milestone has the complete transitive failed-prerequisite set `[M1]`. M7 was excluded by instruction and not attempted. No tokens were estimated; harness-native accounting is external to these descriptive artifacts.

## Verification

M1: `npm run acceptance -- --milestone m1` passed six tests covering all seven suite-required assertion IDs, with no missing mapping. Evidence: [suite](evidence/m1-suite.json), [coverage](evidence/m1-coverage.json), [console](evidence/m1-suite-output5.log). The suite includes signup, authenticated onboarding, visible duplicate handle/email errors, persistent profile editing, fixture-avatar upload and actual browser image rendering, and repeated M1 starter installation.

Separate [supplemental diagnostics](evidence/m1-supplemental.json) passed live cross-user profile update, browser reload session persistence, logout persistence, and refusal of a revoked bearer. They are not frozen choreography and do not confer green. Quarry compilation and final TypeScript checks passed. M2–M6/M8 suites and choreography were not run because of the failed prerequisite. There are no native claims for those milestones.

Native artifacts: initial `artifacts/m1-ios/` and final `artifacts/m1-ios-final/`. The final Hermes bundle is `artifacts/m1-ios-final/_expo/static/js/ios/entry-e2a0a22bb5007cf5512d307733a9cdf4.hbc`; export evidence is `evidence/m1-ios-final.log`. No simulator proof was attempted or claimed.

Scale replay: **not-run**; own start/end epochs are null; invariant verification not-run; no adapter or envelope performance claim.

## Package and environment record

Resolved exact pins: `snapback4@0.2.12`, platform binary package `snapback4-darwin-arm64@0.2.12`, `snapback4-expo@0.2.4`; Expo `57.0.22`, React Native `0.86.3`, React `19.2.3`. npm resolutions are retained in `package-lock.json` and `evidence/resolved-pins.txt`. Only public npm packages were used; no Snapback source checkout or other lane was inspected.

The overlay said Node 24.18.0 was first on PATH; actual initial shell commands ran Node 25.9.0. Frozen choreography attempts and supplemental tests explicitly selected `/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node`. This environment deviation is retained, not hidden.

Only ports 49360 and 49361 were used. Server launcher PIDs and discovered descendants are recorded in `run-log.md` and `evidence/cleanup-pids.json`. Cleanup signalled only those PIDs. Initial unprotected background launches had already exited; the subsequent retained launches and their child binary were stopped.

## Correction and refusal inventory

- **agent-error, one loop:** optional catch-all route failed to match `/`; explicit index plus ordinary catch-all fixed it. Evidence: `evidence/m1-screen.png`, `evidence/m1-suite-output.log`.
- **agent-error, one loop:** retained Stack screens followed the global pathname and duplicated hidden edit controls; Slot layout fixed it. Evidence: `evidence/m1-suite-output4.log`, successful retry `evidence/m1-suite-output5.log`.
- **environment, setup recovery:** copied directories were read-only, blocking dependency installation; changed permissions only on lane copies and retried. The first diagnostic is in the retained tool transcript; the successful retry overwrote its file.
- **environment, setup recovery:** background process lifetime required retained launches; recorded both original and retry PIDs.
- **environment, transient recovery:** Metro's graph briefly reported `Got unexpected undefined` after route rename; later requests rebuilt. Evidence: `evidence/web.log`.
- **environment, unresolved instrument refusal:** missing metering directory resolved by copying the supplied directory; missing external JSON-schema helper remained. Exact evidence: `evidence/m1-choreo-startup.log`, `evidence/m1-choreo-startup2.log`, `evidence/m1-choreo-final-output.log`.
- **agent-error, first-pass diagnostic:** AssetState union access needed narrowing. Fixed before final type verification; not counted as a completed-work correction loop.

No observed Snapback 4 defect is established by this attempt. Later features are unimplemented, not diagnosed platform gaps. Some errors/lookups were recorded retrospectively with evidence pointers; this log is not a complete automatically stamped observability stream.

## Hand-authored application/config lines

Generated types, package lock, vendored UI/choreography/metering, compiled artifacts, evidence, and prose reports are excluded. The seed/API/acceptance tooling is included. Minified one-line JSX counts as its literal physical lines; these counts are not complexity estimates.

| File | Lines |
|---|---:|
| `app.json` | 1 |
| `app/[...path].tsx` | 1 |
| `app/_layout.tsx` | 2 |
| `app/index.tsx` | 1 |
| `babel.config.js` | 1 |
| `package.json` | 30 |
| `scripts/acceptance.mjs` | 18 |
| `scripts/api.mjs` | 9 |
| `scripts/choreography.mjs` | 7 |
| `scripts/m1-supplemental.mjs` | 15 |
| `scripts/seed.mjs` | 18 |
| `setup-identity.json` | 49 |
| `snapback/schema.q` | 33 |
| `src/App.tsx` | 38 |
| `src/client.ts` | 9 |
| `src/device.ts` | 4 |
| `src/device.web.ts` | 4 |
| `tsconfig.json` | 1 |

## Candid gaps

Only accounts and profiles exist. Posts, follow graph, messaging, media posts/messages, reactions, edit/delete windows, expiry, view-once, chat customization, message search, offline message writes, push seam, custom-client messaging API, replay adapter, scale execution, insights, trending, scheduled digest, and multi-device messaging remain unimplemented. M1's public profile replica is unbounded and was not measured at scale. Native export is not evidence of native runtime behavior. Signup and profile completion are separate steps; duplicate-handle failure occurs during profile completion. The M1 seed ledger is scoped to the current backend instance and must be reset when replacing that instance.

The descriptive `run-record.json` has not been validated against the instrument's composed metering schema and is not a native accounting attestation. The essay was written before this tally and explicitly limits comparison to observed M1 work. No competitive scores or full-app claim are reported.

end=1789407803
