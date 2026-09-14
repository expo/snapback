# Grok M7 outcome audit

Observed 2026-09-14 after the recorded Grok M7 process exited. Scope: the frozen M7 brief and assertion manifest, the public Grok lane report and receipts, the two passive prefix captures, and the prior retained Grok M7 record. This is a static evidence audit. It did not run tests, probe the application, read private model reasoning, add a grader, or steer any lane.

## Verdict

The received files support a **builder-reported functional green** for all six suite-required M7 assertions and both choreography assertions. The coverage and suite ID sets agree exactly, the successful choreography retains every timed attempt, its segment summary is green, and it binds the exact final suite hash. The external driver exited 0 after 1,658.219 seconds, within the 14,400-second cap.

The snapshot evidence supports a builder-run zero-mismatch comparison across eight persona exports before and after adoption and again after the M7 suite. Its scope is narrower than the unqualified wording in the final report: no post-snapshot persona files or media bytes are retained, the starter message corpus has no populated media, receipt, or reaction values, and the export's declared message fields omit an explicit `type`. Assertion `m7-a08` is assigned to `grader` but has only this builder-run evidence and remains independently ungraded.

The snapshot timing difference is a packet/orchestration mismatch, not a Grok builder deviation. The frozen brief requires export before the M7 session, while the supplied frozen prompt tells the fresh M7 agent to start and seed the backend and then export “before changing anything.” The builder followed that prompt: the external wrapper started at `1789374362`, the internal report started at `1789374381`, and the manifest records export at `2026-09-14T08:36:59.347Z`, about 657 seconds after the wrapper start and 638 seconds after the internal start, before the first recorded schema change.

## Suite and coverage

`coverage-m7.json` contains exactly the six suite-required IDs in manifest order: `m7-a01`, `m7-a03`, `m7-a04`, `m7-a06`, `m7-a07`, and `m7-a09`. `suite-m7.json` contains those same six IDs once each, marks each pass, and reports milestone pass. Its SHA-256 is `acc7b0247573fecde32e23575a4b8c25fe77e4aa0f0e3228a3d248fe4f3af80e`; `suite-status-m7.json` also points to that receipt and reports pass.

The suite receipt records one Boolean per assertion rather than the underlying test cases. It supports the registered six-ID outcome, while detailed claims about poll bounds, counts, tombstones, and individual regression suites remain report-level claims in this audit. Source-to-receipt correspondence belongs to the separate source audit.

## Choreography and attempt custody

The successful `choreo-m7.jsonl` has exactly two assertion records and one segment summary:

| Assertion | Retained attempts | Result |
|---|---:|---|
| `m7-a02-live-poll-tallies` | 3 | all pass; attempts 1, 2, and 3 retained |
| `m7-a05-offline-vote-reconciles` | 1 | pass |

The segment summary reports 2/2 required assertions passed and `green: true`. It links `suite-m7.json` by `sha256:acc7b0247573fecde32e23575a4b8c25fe77e4aa0f0e3228a3d248fe4f3af80e`, exactly matching the final suite bytes. The observation sidecar retains settlement waits for all four attempts and the required browser-wait block claim.

The final report and public run log say an earlier invocation refused at setup because PATH selected Node 25.9.0 instead of the declared Node 24.18.0, then the documented Volta Node produced the green run. No separate refusal receipt is present in the audited public artifacts. The passive `grok-m7-first-receipts` capture was taken after the successful run and its suite, coverage, status, choreography, and observation hashes are byte-identical to the final files. It preserves the complete successful attempt set, not the earlier setup-refusal output.

## Snapshot preservation scope

The pre-snapshot manifest names eight persona JSON files, and every declared file hash matches the retained bytes. It records 39 persona-visible message projections across five persona-visible conversations: Alice 15, Bob 15, Carol 9, and zero for Dave through Henry. All eight profiles have populated avatar references.

The export uses the custom-client operations `threadMessages`, `convReceipts`, `convReactions`, `convRecipients`, `conversationOf`, `inbox`, and `me`. The retained message objects include identity, conversation, author, server time, body/caption, media-reference variants, edited/tombstone state, quote, caller reaction, and pending state. The manifest does not declare an explicit message `type`, although the frozen M6 minimum manifest requires one. `pending` is a local write state rather than the caller's delivered/read receipt state.

The starter exports contain zero populated message-media fields, zero receipt rows, zero reaction rows, and zero populated caller reactions. Avatar references are present, but the M7 directory contains no fetched asset bytes or asset-byte hash manifest. The comparison therefore establishes structural retention of nullable media/reaction fields and empty receipt/reaction collections; it does not demonstrate preservation of populated message media, populated receipts or reactions, or media bytes.

The passive post-migration prefix capture retains the pre-snapshot bytes and an `ok: true`, zero-mismatch comparison at `2026-09-14T08:40:58.303Z`. The final `snapshot-compare.json` repeats the comparison after the suite at `2026-09-14T08:46:56.286Z`; the two files differ only in `comparedAt`. No post-snapshot persona payloads are retained, so the comparison cannot be independently recomputed from the archived inputs. This is builder evidence for preservation, not an independently executed `m7-a08` result.

## Conditional regression scope

The assertion manifest makes `m7-a09` conditional on previously green milestones. The inherited builder report marks only M1 and M2 fully green. M3's suite passed but its milestone ended `capability-failure` because choreography was not green; M4–M8 have passing suite files but milestone statuses of blocked or not-run after M3. The required conditional regression subset is therefore M1 and M2.

The M7 suite marks `m7-a09` pass, and the final M7 report says it also reran the M3–M6 and M8 suites in-process. That broader seven-suite check is useful supplemental evidence, but it does not reclassify those inherited milestones as previously green or repair the inherited M3 choreography failure. The standalone M1–M6/M8 suite receipt files retain their pre-M7 timestamps; there is no separate detailed regression-result artifact. Consequently, the exact seven-suite rerun enumeration is supported by the M7 report and its aggregate `m7-a09` Boolean, while the conditional requirement is supported at least for M1/M2.

## Native and timing scope

No new native export is claimed. The final report explicitly carries forward the continuous session's private-class-field Hermes failure, and the M7 evidence does not establish a native build or runtime result.

The external lifecycle receipt controls elapsed time: start `2026-09-14T08:26:02Z`, end `2026-09-14T08:53:40Z`, wall `1,658.219` seconds, exit 0. The internal report uses start `1789374381`, end `1789375914`, wall 1,533 seconds; it omits 125.219 seconds of wrapper/session overhead. Both clocks remain below the four-hour cap.

The prior Snapback 2 Grok M7 record reports builder green in 1,876 seconds. The current external wall is 217.781 seconds shorter. This is contextual only: the backend, instrument revision, environment, scheduling, and clock custody differ, and neither result has a post-M7 independent grade.

## Packet method qualification

The packet schedules its one independent grade before M7 and renders M7 as pre-evolution not-run or conditional in that grade. `scripts/run_phase.py` requires the completed grade, holistic score, and all-lane grade summary before launching M7, and it has no post-M7 grade stage. At the same time, the frozen assertion manifest assigns `m7-a08` to a grader and the brief says the grader compares the pre-session snapshot. The supplied M7 prompt instead directs the fresh M7 agent to create and compare the snapshots and include that result in its report.

Under the frozen procedure actually supplied to every lane, `m7-a08` receives a local M7-agent comparison and remains independently ungraded. This audit preserves that packet-wide method mismatch without blaming the builder or introducing a lane-specific rerun, pre-seed, ad hoc grade, or other protocol change.

## Evidence identities

| Evidence | SHA-256 |
|---|---|
| `lanes/grok-snapback4/m7/final-report.md` | `17e1d85227ccc68a136768ec6b293798e20353db4fcd7a322f61a06bf4371d72` |
| `logs/grok-snapback4.m7.start.json` | `5d29579bcce282c32e3f95a2e17077d35197df521bb0abedea462bc5d2380e53` |
| `logs/grok-snapback4.m7.end.json` | `2ddca60613f64a7291fd236d26b61b2657fef7464712f7838a854a1edcc8536e` |
| `lanes/grok-snapback4/m7/run-log.md` | `770da005cb095aeb1d6f477efd6d704702832d52095ad88d9223d3989e2078f7` |
| `lanes/grok-snapback4/receipts/suite-m7.json` | `acc7b0247573fecde32e23575a4b8c25fe77e4aa0f0e3228a3d248fe4f3af80e` |
| `lanes/grok-snapback4/receipts/coverage-m7.json` | `86e5af3754fba7ad6e392642c1a3e9fd85ddaf12a50bafb94bd4634fcabf1864` |
| `lanes/grok-snapback4/receipts/suite-status-m7.json` | `ea3ed66e09146255a062c4102acef5b032170e1561337a22a5fb0d80ffc70f6a` |
| `lanes/grok-snapback4/receipts/choreo-m7.jsonl` | `3cd905378dc54c40876d4684ff4775d4c6e70f61cd3366f97b4479d700376854` |
| `lanes/grok-snapback4/receipts/choreo-m7.jsonl.observations.jsonl` | `5c89903c0ed1e6cc9c4ea1ef8ae2ed6f357379d96dd4b8450863010fb39a1147` |
| `lanes/grok-snapback4/m7/pre-snapshot/manifest.json` | `fd01c832f28f6830cc4cb507723dd770a47d9e20231ef9a718e80a27b56a95cf` |
| `lanes/grok-snapback4/m7/snapshot-compare.json` | `d4fa8a08e1ef4274b8845df21d3aed295392689096eccabab1879efae3f6ab2e` |
| `observed-milestones/grok-m7-postmigration-prefix/capture.json` | `abcc776a0d37d6fce5275b3dc9940ba646bc9a035ff2b98716bc3db7c4b66e70` |
| `observed-milestones/grok-m7-postmigration-prefix/snapshot-compare.json` | `494b82be926b838b131d8651d9a56929def4e0435d3336549316a4b110aaf6f8` |
| `observed-milestones/grok-m7-first-receipts/capture.json` | `83b364055f710367396826513f50a5a3106144bc5ac700043a9cec1e910bb3f0` |
| Inherited `lanes/grok-snapback4/final-report.md` | `0958642941e6aa2bc0afd450a6a435fc4b1fdb21de34de815a522462ccfaee3e` |
| `prompts/grok-snapback4.m7.md` | `d105576bd9d60195e9e96ccb4131789fd03391e705d21cb0ee8422307efea78b` |
| `instrument/social-messenger.md` | `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6` |
| `instrument/schema/social-messenger/assertions.json` | `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
| Packet `README.md` | `192cb9705e171289b96829a3930ae43132a23a6bf24138003625ff5a6ee4a0b4` |
| `scripts/run_phase.py` | `a3b3658347f61ee57b9cf13a557fafe4edb9baf385fa59d29e620a1802247b69` |
| Prior `m7-grok-snapback2.md` | `c4aaf4df9214bc6391c214e440a013e2b0dc844408f76f6a204aeec7adb11799` |
