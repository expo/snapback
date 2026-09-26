# Clique final report

lane id astra-clique-snapback4-full-20260913

Model: gpt-6-astra, effort=medium. Backend: public snapback4 0.4.3; native arm: public snapback4-expo 0.4.3.

start=1790424315

M1 → M2 → M3 → M4 → M5 → M6 → M8 are green in the final suite/choreography receipts. M7 is not-run, as instructed. No scope was struck. The closing essay was written before this tally.

## Milestone clocks and evidence

These are raw logged authoring boundaries, inclusive of orientation and normal diagnosis. First logged green is an upper bound on the original passing receipt time. Retained receipt timestamps below distinguish proof from logging. Final regressions are recorded separately and remain inside this continuous session. No driver-certified efficiency or token score is claimed.

| Milestone | Start epoch | End epoch | First logged green epoch | Wall seconds | Final status | Suite | Choreography |
|---|---:|---:|---:|---:|---|---|---|
| M1 | 1790424315 | 1790424816 | 1790424816 | 501 | green | 7 required passed | 3/3 passed |
| M2 | 1790424816 | 1790425640 | 1790425640 | 824 | green | 22 required passed | 9/9 passed |
| M3 | 1790425640 | 1790426554 | 1790426554 | 914 | green | 7 required passed | 7/7 passed |
| M4 | 1790426554 | 1790427051 | 1790427051 | 497 | green | 5 required passed | 5/5 passed |
| M5 | 1790427051 | 1790427559 | 1790427559 | 508 | green | 6 required passed | 4/4 passed |
| M6 | 1790427559 | 1790428163 | 1790428163 | 604 | green | 5 required passed | 1/1 passed |
| M8 | 1790428163 | 1790430090 | 1790428994 | 1927 | green | 6 required passed | 5/5 passed |
| M7 | — | — | — | — | not-run | Separate session | Separate session |

Session through report: 5775 seconds. M8 through final verification/report preparation: 1927 seconds. No milestone reached the 14,400-second safety limit.

| Milestone | Earliest retained green receipt | Latest green receipt | Initial receipt retained |
|---|---|---|---|
| M1 | 2026-09-26T12:13:17.223Z | 2026-09-26T13:15:43.159Z | yes |
| M2 | 2026-09-26T12:25:56.896Z | 2026-09-26T13:18:21.914Z | yes |
| M3 | 2026-09-26T13:21:55.600Z | 2026-09-26T13:21:55.600Z | no; use logged upper bound |
| M4 | 2026-09-26T13:30:52.319Z | 2026-09-26T13:30:52.319Z | no; use logged upper bound |
| M5 | 2026-09-26T12:58:36.321Z | 2026-09-26T13:36:36.276Z | yes |
| M6 | 2026-09-26T13:08:47.091Z | 2026-09-26T13:36:44.630Z | yes |
| M8 | 2026-09-26T13:13:32.288Z | 2026-09-26T13:37:08.089Z | yes |

Latest suite bytes match each choreography summary’s recorded suite SHA-256. See [milestone-results.json](milestone-results.json), [coverage-manifest.json](coverage-manifest.json), and [run-log.md](run-log.md). Some early mutable receipt paths were overwritten during retries; final proofs and retained attempts are preserved, but complete original-boundary custody is not claimed. No frozen harness check was relabeled or skipped as a workaround. Native supplemental simulator checks are not claimed; the requested Hermes artifacts are present.

## Native and web artifacts

- M1: [Hermes bundle](artifacts/m1-ios/_expo/static/js/ios/entry-7e4db523cb5c16e8742480946e6f829c.hbc) — `sha256:f06046fd11694699aca5e62b1c1907b1532773648cb769c68bcf903b5052ffa1`
- M2: [Hermes bundle](artifacts/m2-ios/_expo/static/js/ios/entry-3457dec23366bca96dc808d75a6db8c7.hbc) — `sha256:a2ce6131b5baf482042a17e0893966bbfbc29535044c8643c9853239d16add2a`
- M3: [Hermes bundle](artifacts/m3-ios/_expo/static/js/ios/entry-4978c8a10d9950bdaa088766e3f247b9.hbc) — `sha256:2bab2e38e3159ac2203bdaff7c300f1e44f9a883ad9651cd49d6ffc4be876f4f`
- M4: [Hermes bundle](artifacts/m4-ios/_expo/static/js/ios/entry-fc16db50df7311736ebccfa85be32eaa.hbc) — `sha256:add716d183bd7d6310cb1a6ac07c5b563b8ee2e57f5fff82fd700c4e8f7874e9`
- M5: [Hermes bundle](artifacts/m5-ios/_expo/static/js/ios/entry-9162c2055402cee24cecb1cd39ec3d8c.hbc) — `sha256:b06feb19eb2270b0d87b617f41f3e26aaab7971f91609106c8a388d3088127eb`
- M6: [Hermes bundle](artifacts/m6-ios/_expo/static/js/ios/entry-81c89e063987e261bb398092aec52251.hbc) — `sha256:c45040765aa611cbc9bb985048a4699b149d2ceb21cf81b092b965292f407c69`
- M8: [Hermes bundle](artifacts/m8-ios/_expo/static/js/ios/entry-3ee3774a8d62c8188c0b789d43ab5b36.hbc) — `sha256:bc3ba5ae47337357d3751e9eea0a8ffec92f2e372ebd18202adb5c8bf735a517`

The final Expo web export and generated offline shell are in `dist/`. Native build success is not simulator proof.

## Scale replay

Fresh isolated instance on port 49362, seeded through all starter actions; replay-mode notifications and schedules suppressed.

- start=1790427859; first scale action=1790427860; final action=1790429002; verification end=1790429082.
- Action replay wall: 1142 seconds; fresh-start-through-extended-verification wall: 1223 seconds. This overlaps M6/M8 authoring and is not added again to session wall.
- Exactly 167157 scale actions settled; failed actions=0. SHA-256: `sha256:b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
- Both checkpoint manifests verified at settled prefixes 24777 and 88057. Final entity totals, per-user follow/conversation counts, per-chat counts, group membership, named content/reactions, celebrity graph, and named asset hashes passed.
- [Replay receipt](evidence/scale-final-receipt.json), [complete verification](evidence/scale-final-full-verification.json), and [M8 scale reads](evidence/scale-m8-probes.json).

Adding M8 maintained views to the completed scale database caused one initial Insights request to wait about 75 seconds during adoption. That sample is retained in `evidence/scale-m8-during-adoption.json`; subsequent reads were fast and complete. No repeated p95, secret holdout score, or universal latency claim is made. The supplied replay cap is not numerically frozen, so no cap-fraction score is invented.

## Additional proofs

- [Unattended expiry](evidence/m5-unattended-expiry.json): absent server row and HTTP 404 bytes after the configured lifetime.
- [Scheduled digest](evidence/m8-digest-proof.json): correct authorized counts, zero inactive/quiet period, tombstone exclusion, and a mid-period backend restart.
- [Cold offline](evidence/m6-cold-offline.json), [retained media](evidence/offline-media.json), and [custom-client demo](evidence/custom-client-demo.json).
- [Durable two-message restart](evidence/m8-durable-offline.json): both pending after offline reload, exactly-once ordered flush, normal read receipts.
- [Offline likes/reactions](evidence/offline-social.json): no premature server change; both settle after reconnect.
- [Sample conformance](evidence/sample-conformance.json): all 50 actions and all 13 verbs.

## Package pins

- node_modules/snapback4: **0.4.3**, https://registry.npmjs.org/snapback4/-/snapback4-0.4.3.tgz; integrity `sha512-TL8Rdvy+0MdX1gfC9uwcHslurA24LByojGZzTcKpaDg/j9WtcebblKi882p2ntt6UqdktavXxjOh4YL3MXjP8A==`.
- node_modules/snapback4-darwin-arm64: **0.4.3**, https://registry.npmjs.org/snapback4-darwin-arm64/-/snapback4-darwin-arm64-0.4.3.tgz; integrity `sha512-nih2ZocJ6/v79meRgcYNEBuGI/cPgQyxVMPrysCFjNifSgDZDkXurhirFFGOCHnVW6qICAyC/KeprUBqi7OaWg==`.
- node_modules/snapback4-expo: **0.4.3**, https://registry.npmjs.org/snapback4-expo/-/snapback4-expo-0.4.3.tgz; integrity `sha512-750mT12iPlfM+0LZCIrHnm2lnEeea9zVpK+ZBLjjdbk4hlwHSU921u1x5BM2kEA5MDNBtc4NmoMO0cqkqVNcZg==`.

## Correction loops

First-pass syntax/type errors and environment setup retries are logged separately, not silently turned into product defects. The following are the distinct completed-work correction loops; multiple iterations of one issue are grouped.

| Attribution | Correction | Evidence |
|---|---|---|
| agent-error | Profile form mounted before profile data | evidence/m1-failure.png |
| agent-error | Login retained settings route | run-log.md |
| agent-error | RN Web lacks native image asset resolver | evidence/metro.log |
| agent-error | Feed navigation missing outside feed route | run-log.md |
| snapback4-defect | List image placement compiled but authorized asset fetch returned E_ASSET_UNKNOWN; four scalar slots resolve it | evidence/media-probe.txt |
| agent-error | DM route selected a group containing the counterpart | run-log.md |
| ambiguous | Member candidate disappeared during transient account loading; retained resolved profile | evidence/member-probe.png |
| agent-error | Redundant acknowledgement writes disrupted ephemeral typing reads | evidence/typing-probe3.txt |
| agent-error | Live receipt join hid retained delivered history | evidence/retention-probe.txt |
| agent-error | Send completion cleared newer media/text draft; video DOM loading wrapper | run-log.md |
| agent-error | Four parallel uploads exceeded documented two-upload bound | evidence/sample-replay-attempt1.txt |
| agent-error | Assumed every eligible send predicts; added saved-intent view metadata and corrected SDK intent ID format | evidence/m6-offline-probe.txt |
| agent-error | Day-row assertion ran before reload completed | evidence/m8-suite-attempt1.json |
| agent-error | Send completion cleared a newer quoted-reply selection | evidence/m3-final-attempt1-output.txt |
| agent-error | Viewer lifetime tied to refreshing bubble; modal close layout overflow; fixed through multiple iterations | evidence/video-probe2.txt |

Counts: 13 agent-error, 1 snapback4-defect, 1 ambiguous. Environment errors (Node PATH mismatch, copied harness permissions/layout, fixture path) are in the timestamped log; they were setup retries rather than counted completed-product loops.

## Hand-authored physical lines

Authored/edited app, backend, tests, scripts, and config; copied UI, fixtures, package source, generated types/rules, exports and evidence excluded. Formatter expansion affects physical lines, so these are a ceremony measure, not a guarantee measure.

| File | Lines |
|---|---:|
| app/[...path].tsx | 247 |
| app/_layout.tsx | 11 |
| app/index.tsx | 1 |
| src/Chat.tsx | 321 |
| src/Insights.tsx | 46 |
| src/MediaViewer.tsx | 96 |
| src/Message.tsx | 121 |
| src/MessageComposer.tsx | 96 |
| src/OutboxView.ts | 87 |
| src/Player.tsx | 28 |
| src/Search.tsx | 77 |
| src/Settings.tsx | 115 |
| src/Social.tsx | 336 |
| src/client.ts | 25 |
| src/ids.ts | 4 |
| scripts/acceptance-m1.mjs | 93 |
| scripts/acceptance-m2.mjs | 235 |
| scripts/acceptance-m3.mjs | 76 |
| scripts/acceptance-m4.mjs | 57 |
| scripts/acceptance-m5.mjs | 77 |
| scripts/acceptance-m6.mjs | 86 |
| scripts/acceptance-m8.mjs | 129 |
| scripts/acceptance.mjs | 2 |
| scripts/audit-pins.mjs | 16 |
| scripts/choreo.mjs | 30 |
| scripts/cold-offline.mjs | 98 |
| scripts/configure.mjs | 19 |
| scripts/conformance.mjs | 60 |
| scripts/custom-client-demo.mjs | 65 |
| scripts/digest-proof.mjs | 145 |
| scripts/expiry-proof.mjs | 59 |
| scripts/finalize-scale.mjs | 59 |
| scripts/inspect-browser.mjs | 8 |
| scripts/media-probe.mjs | 28 |
| scripts/member-probe.mjs | 33 |
| scripts/offline-media.mjs | 76 |
| scripts/offline-probe.mjs | 18 |
| scripts/offline-social.mjs | 73 |
| scripts/push-worker.mjs | 33 |
| scripts/regression.mjs | 32 |
| scripts/replay.mjs | 249 |
| scripts/retention-probe.mjs | 38 |
| scripts/scale-health.mjs | 24 |
| scripts/scale-insights.mjs | 41 |
| scripts/seed.mjs | 136 |
| scripts/setup.mjs | 39 |
| scripts/static-server.mjs | 41 |
| scripts/suite.mjs | 77 |
| scripts/typing-probe.mjs | 26 |
| scripts/verify-scale.mjs | 276 |
| scripts/video-probe.mjs | 36 |
| scripts/wire.mjs | 31 |
| scripts/write-report.mjs | 318 |
| snapback/schema.q | 422 |
| package.json | 47 |
| app.json | 28 |
| tsconfig.json | 16 |
| **Total** | **5063** |

## Candid limits

- The list-of-images placement surface failed recipient byte fetch; four scalar image slots implement the required four-image product behavior. No source fork was used.
- Some sends and reactions can queue without predicted rows. Message presentation metadata supplements the SDK outbox; the SDK remains the sole transport authority.
- Native simulator behavior, production deployment, APNs/FCM delivery, M7, independent grading, and secret performance probes were not run or claimed.
- Original proof custody is incomplete for some early overwritten files. Latest suite/choreography linkage is checked; logged initial green times are explicitly distinguished from retained receipts.
- Harness-native token totals and driver-stamped phase/custody data are external; counts are null rather than estimated. `run-record.json` validates against the base protocol schema; a complete composed metering/grading record is not fabricated.
- The scale schema-adoption wait is retained as an operational limitation. Steady-state sample timings are not a production service-level guarantee.

All owned servers are shut down by their exact recorded PIDs at close; no pattern kills are used.

end=1790430090
