# Muse M7 outcome audit

Observed 2026-09-14 after the actual Muse M7 process exited. Scope: the canonical public M7 report and artifacts, ordinary lifecycle receipts, and immutable observer captures. No private CLI reasoning was read. No test, build, probe, benchmark rerun, ad hoc grade, lane edit, or repository edit was performed. The two provisional custody notes remain intact as historical records.

## Verdict

The artifacts support a **builder-reported M7 green with material evidence qualifications**. The M7 process itself exited 0 within the four-hour cap. A 31/31 M7 suite artifact, a 160/160 regression artifact, a final best-of-three green choreography, and a new iOS Hermes bundle all exist and have stable hashes.

They do not bind one final source state to every green result. The 160/160 regression and 31/31 M7 suite both predate two client corrections that produced the green choreography. The choreography then passes best-of-three while retaining one failed live-tally attempt. A later iOS export/output-path correction and web rebuild occur after choreography, with no subsequent suite, regression, or choreography receipt. The final report's `green` is therefore a builder outcome assembled from individually valid artifacts across successive source states, not a final-state all-checks-green proof.

Snapshot assertion `m7-a08` also remains independently ungraded. The final canonical pre-snapshot is the replacement baseline created after the original migration and store reset; neither the original migration comparison nor the final post-choreography comparison retains its post-persona inputs. These limits prevent an unqualified claim that the original pre-migration state survived based on the final snapshot files alone.

## Actual lifecycle and helper exception

The normal M7 lifecycle records PID 11190 starting at `2026-09-14T08:54:00Z` and ending at `2026-09-14T10:41:15Z`, exit 0, wall `6,434.294` seconds. The builder's internal clock starts at `1789376048`, ends at `1789382439`, and reports 6,391 seconds, excluding 43.294 seconds of wrapper/session overhead. The external lifecycle is controlling and remains 7,965.706 seconds below the 14,400-second cap.

The separately recorded `muse-m7-exit130-override` is an orchestration helper receipt, not an M7 exit-130 result. It records that the earlier continuous Muse builder ended 130 and qualified the exact post-interruption exception. Helper PID 11181 invoked the effective `scripts/run_phase.py m7 muse` path; its M7 subprocess was PID 11190. The helper ended exit 0 after `6,434.309` seconds and embeds the ordinary M7 start/end records.

The helper receipt pins frozen runner SHA-256 `a3b3658347f61ee57b9cf13a557fafe4edb9baf385fa59d29e620a1802247b69`, patch sidecar `1760a5ad1d0fb2e9941ebcce9539dd11cd182d1f14df573153459e7739f9a749`, and patched runner `6c98247006a3a0dc033b54a3c36eb441396cac1b08258e47e60c7d46a6240ff3`. This is a recorded precondition exception for launching the separate M7 phase after the earlier builder's actual exit 130. It does not convert the baseline builder to exit 0, continue its session, or fabricate the M7 result. The M7 subprocess received the frozen Muse M7 prompt with model `muse-spark-1.3`, effort `xhigh`, `snapback4@0.2.6`, and `snapback4-expo@0.2.1`, then exited normally.

## Assertion map and M7 suite

`coverage/m7.json` maps all nine M7 assertion IDs:

- Suite-required: `m7-a01`, `m7-a03`, `m7-a04`, `m7-a06`, and `m7-a07` map to 30 named M7 checks; `m7-a09` maps to the full regression run.
- Choreography: `m7-a02` and `m7-a05` map to the M7 choreography receipt.
- Grader: `m7-a08` points to the snapshot path and local comparison claim, but its executor remains `grader`.

`accept-m7.log` reports 31/31 pass. Its 30 assertion-mapped checks are accompanied by one setup check. The final report records command exit 0, and `suite-status.json` marks M7 pass and points to that log. The acceptance log SHA-256 is `e649e519fac247dd54b69e6bb2f1a156417274a58cb91cdee02f8c26230981e4`, and the final choreography segment summary links exactly that hash.

The suite checks poll creation and validation, group-only rules, three-option support, live and changed vote totals, idempotent replay, initial and disappearing message counts, maintained counts, settings display, and a UI vote observation. This is direct evidence for the five feature assertions at the source state that produced the log. It is not a post-correction rerun.

## Choreography attempts and linkage

The immutable first choreography capture preserves the original red. `m7-a02-live-poll-tallies` passed all three attempts, with settlement waits 497.0, 497.1, and 564.0 ms. The sole `m7-a05-offline-vote-reconciles` attempt failed after a 10,317.2 ms wait because the pending vote was not observable within 10,000 ms. It is classified `application`; the segment is `green: false`, `nonGreenCause: choreography-failed`.

The canonical final receipt is byte-identical to the immutable first-green capture. It retains all four attempts:

| Assertion | Attempt | Result | Duration | Settlement wait | Qualification |
|---|---:|---|---:|---:|---|
| `m7-a02-live-poll-tallies` | 1 | pass | 568.2 ms | 466.1 ms | visible 249.6 ms; selected |
| `m7-a02-live-poll-tallies` | 2 | pass | 616.2 ms | 498.4 ms | visible 256.1 ms |
| `m7-a02-live-poll-tallies` | 3 | fail | 10,384.8 ms | 10,285.6 ms | other-client tally timeout; `application` |
| `m7-a05-offline-vote-reconciles` | 1 | pass | 1,696.5 ms | 1,579.7 ms | pending clears after reconciliation |

The live-tally assertion passes under the frozen best-of-three rule because two attempts pass; the offline assertion passes its only attempt. The segment summary reports 2/2 required assertions passed and `green: true`. Its suite hash matches the 31/31 artifact, and its setup-identity hash matches the retained `setup-identity.json`. This is a best-of-three green, not an all-attempts green.

## Regression history and final-source binding

The immutable captures retain the correction history rather than only the last green:

- A first observed run records total 159, pass 158, fail 1; `m6-a04` fails after a subprocess cannot connect to the then-expected default backend port.
- Later 160-result artifacts retain `m5-a04-people` failing at a 20-hit page limit; one also records `live` and M6 suite errors after an overlapping run closed the browser.
- The default-port prefix reports a misleading `73/73` tally while also retaining suite errors; it is not a complete green run.
- `regression-final.log` reports all 160 checks passing across M1, M2, M3, M4, M5, live, M6, M7, and M8, with no `FAIL` or `SUITE-ERROR`. Its canonical bytes equal the immutable observer copy at SHA-256 `541860a8fbacfe1fb72722cd58be65882e377b4d12e97f9ee2d8afb5d237c01b`.

The final regression existed by observer epoch `1789381526.3112268`; the standalone M7 suite has source mtime `1789381752.3665204`. The public run log then records these later changes:

| Run-log epoch | Later event |
|---:|---|
| `1789381970` | Offline-pending correction: optimistic intent plus reconnect retry |
| `1789382284` | Device-pending correction: busy state reads `mine.pending` |
| `1789382315` | Final choreography green and local snapshot-compare claim |
| `1789382333` | iOS export output-path correction after the export clobbered web `dist/` |
| `1789382376` | Web bundle rebuilt and checked by bundle grep plus HTTP 200 |

The final choreography receipt has source mtime `1789382299.0411913`, after the first two corrections. It still binds the earlier unchanged suite hash. Neither the M7 suite nor the 160-check regression was rerun after those corrections. The output-path correction and web rebuild then occur after choreography, with no later semantic receipt. The final source may be correct, but these artifacts do not prove it as one qualified state; the separate source audit must determine the exact semantic deltas.

## Prior-green regression scope

The inherited builder report labels M1, M2, M3, M4, M5, M6, and M8 green and also reports the live suite green. It says the instrument choreography harness was not executed during that continuous builder, so those green labels rest on the lane's acceptance suites rather than choreography receipts. Assertion `m7-a09` specifically requires the acceptance suites of previously green milestones, making all seven numbered suite milestones the operational inherited subset for this M7 session.

The 160/160 regression artifact includes those seven suites, live, and M7 and therefore supports `m7-a09` for the pre-correction source state. The M7 final report's “there were no prior failures to preserve” is accurate only as “no unresolved prior suite failure in the inherited handoff”: the inherited report retains earlier post-green M4/M5 failures and their fixes, then declares its handed-over suite state green. This audit does not revise the independent baseline grade or turn earlier grader failures/not-runs into greens.

Because the regression artifact predates the two client corrections, `m7-a09` is not fully rebound to the final source state. The result remains strong regression evidence for the immediately preceding state, with a final-state freshness gap.

## Snapshot reset and comparison scope

The frozen packet has an instruction mismatch: the brief asks the orchestrator to export the pre-M7 snapshot before the M7 session, while the supplied M7 prompt tells the fresh M7 agent to seed and export it before changing anything. Muse followed the supplied prompt. The external M7 phase began at `1789376040`; the original snapshot was recorded during the session, before the schema check.

The immutable original prefix preserves the original eight persona files and manifest. The captured run log later claims the first migration comparison passed 48 checks with zero differences at `1789376692`, then records that a probe poll left residue and the store was wiped and reseeded. After the evolved backend restarted at `1789376731`, the pre-snapshot path was overwritten with a replacement export at `1789376740002` ms.

The canonical final `m7/pre-snapshot/` is byte-identical, all nine JSON files, to that replacement capture. It is not the original pre-migration baseline. The first-migration observer capture was itself taken after the reset and already contains the replacement bytes, so it does not retain the original comparison's post-migration inputs. The final run log claims another 48-check, zero-difference comparison after choreography, but the final lane retains no post-persona files or comparison-result file. Neither comparison can be independently recomputed from the final artifacts.

The replacement snapshot's observable scope is:

- Eight persona JSON files, five persona-visible inbox rows, five chat projections, 39 persona-visible message projections, and 15 unique message IDs.
- Non-null count values in all five inbox projections and all five chat-detail projections.
- Message objects with `kind` but no explicit `type` field. The M6 minimum manifest calls for a type; `kind` may be the app's representation, but the exact named field is absent.
- Zero receipt rows, zero reaction rows, and zero populated message media references. Preservation of populated message receipts, reactions, and media is therefore not exercised by this starter corpus.
- Nine asset-map projections representing three unique asset IDs, with byte length, SHA-256, and status. Only three of the eight direct profile-avatar references are covered by those asset entries; five direct avatar references lack retained byte hashes. There is no populated message-media byte case.

The replacement baseline can support local claims about the reseeded state surviving subsequent work. It cannot alone prove that the original state survived the first schema migration. The original first-comparison run-log line is contemporaneous builder evidence, while `m7-a08` remains independently ungraded because the packet schedules no post-M7 grader.

## Native artifact scope

The claimed M7 iOS Hermes artifact exists at `app-host/clique/dist-ios/_expo/static/js/ios/entry-ae6af08f792727e483a95577ebbb51e2.hbc`, size 2,805,530 bytes, SHA-256 `1893bec10e4b1992bca075eb6078dd4c1e19258fbc580f1b08dbaa3a037ce3f6`. Its mtime is `1789382349`, after the two choreography corrections and after the run log records the output-directory correction. Its name, size, and hash differ from the inherited builder's earlier iOS export, so it is a new M7-phase bundle artifact.

No separate export command receipt is retained in `m7/`, and the artifact has no simulator or device execution evidence. The setup identity explicitly says no separately qualified runtime binary. This supports a Hermes bundle-export claim only, not native launch, offline behavior, or simulator acceptance.

## Method conclusion

The exact received evidence supports individual builder results: M7 feature suite green, a broad regression green, final best-of-three choreography green, a local snapshot comparison claim, and an iOS bundle. Their timing and custody do not support an unqualified final-state all-green statement. Any curated result should label the outcome builder-reported green and carry these qualifications:

1. Suite/regression predate the final client corrections and later output-path change.
2. Final choreography is best-of-three with one retained application timeout.
3. The canonical snapshot is a post-reset replacement; the original migration comparison lacks retained post inputs.
4. `m7-a08` has no post-M7 independent grader execution.
5. Native evidence is bundle export only.
6. M7 ran under the exact recorded helper exception after the continuous Muse builder's exit 130; M7 itself exited 0.

No baseline grader result is changed by this M7 audit.

## Evidence identities

| Evidence | SHA-256 |
|---|---|
| `logs/muse-snapback4.m7.start.json` | `8d8898354286d9a70f3a1454381db90b2a6948b41ad5126f9257d00b5f6ade37` |
| `logs/muse-snapback4.m7.end.json` | `f8129bfedb2d71622f689a1183d595eb0ddd6917b20707ef8a7f22d38318849a` |
| `observed-milestones/muse-m7-exit130-override.start.json` | `eb6a3cf3d5feb3c86e205652d4e92e8f7d175814770403b875febe8a6b8fbbfe` |
| `observed-milestones/muse-m7-exit130-override.end.json` | `037f0e2a5af9cb19edcfc0d7da921dd7702a04f37d2bdb32c0bff13e617a80c1` |
| `lanes/muse-snapback4/m7/final-report.md` | `d6f40c070381294d5df1a1d783d404e2bf6b86eaa3013e5dffc262e311fabcd3` |
| `lanes/muse-snapback4/m7/run-log.md` | `1a602c8ed74d1ada4b564215f94ea8fe3d394c52bf5c7b1ab124be3e76c51146` |
| `lanes/muse-snapback4/coverage/m7.json` | `976610ce9a391596e02d058cdac1802c9d0ec2394de454f7eb8b122d9eb43b2a` |
| `lanes/muse-snapback4/m7/accept-m7.log` | `e649e519fac247dd54b69e6bb2f1a156417274a58cb91cdee02f8c26230981e4` |
| `lanes/muse-snapback4/m7/suite-status.json` | `629b34ef344aaa7c9dd4cb5465eb25d8440387125777fd44ac276c9d88a089f0` |
| `lanes/muse-snapback4/m7/regression-final.log` | `541860a8fbacfe1fb72722cd58be65882e377b4d12e97f9ee2d8afb5d237c01b` |
| `lanes/muse-snapback4/m7/regression.log` | `69bfa4ff87a1a4104ade6f18d8c71835ba0dc578f6a1c8bd04f5337026276994` |
| `lanes/muse-snapback4/m7/choreo-receipts.jsonl` | `03f53e49d10685f98eb7a8f5d5fd84d2679122b49107a7d0a57bf101010e6220` |
| `lanes/muse-snapback4/m7/choreo-receipts.jsonl.observations.jsonl` | `1b7066055e9e3116dbfddd5175e6a1653b29c082ed1af332e8c01a5de320f2f0` |
| `lanes/muse-snapback4/m7/setup-identity.json` | `368dd4ca05a57033c43b909e60183b3bd0b208fcd976f31d17b84808396b12db` |
| `lanes/muse-snapback4/m7/pre-snapshot/manifest.json` | `9c3255b78410b2b236aed481fd0a31edfb388617ea19367ada4904ff306d4d99` |
| M7 Hermes bundle | `1893bec10e4b1992bca075eb6078dd4c1e19258fbc580f1b08dbaa3a037ce3f6` |
| Inherited `lanes/muse-snapback4/final-report.md` | `db5252070d4fcd3d4df8788a12fdbcd378a02cf85243cdbcf40456cf18d24feb` |
| `observed-milestones/muse-m7-presnapshot-prefix/capture.json` | `c13907bf2588699a4436a6a9039eb631ab048919172dbe73875cb38567236de1` |
| `observed-milestones/muse-m7-first-migration-prefix/capture.json` | `985a14600090fd9841505f4601a9e1a8d8e37e4bd1cdd8eb640862088bd50afa` |
| `observed-milestones/muse-m7-replacement-snapshot-prefix/capture.json` | `942d1ca4f9bde3f8d00cf347685797b3ecaa1724ab86b9a7657be062bdc76b48` |
| `observed-milestones/muse-m7-regression-observer-history/events.jsonl` | `0613ccf5549f68701602e847dd9bf9a3b24c53025e132b59ea61ec12a40db039` |
| `observed-milestones/muse-m7-first-choreography-prefix/capture.json` | `07eab8b30f5a4a6c0db90b3c9631c35968d46109c41265cb938d8a7ae1734ae8` |
| `observed-milestones/muse-m7-first-green-choreography-prefix/capture.json` | `bb487d67ee8ce8dffdf32358b4d1ef3fa56eb7fc94657ef9b6f9e144969d9ee1` |
| `observed-milestones/muse-m7-snapshot-replacement-provisional.md` | `15fa6f624e8c8ca4e92ce9483d5006b1e0c8013468530ca738c13c2c1cb9d275` |
| `observed-milestones/muse-m7-choreography-provisional.md` | `ecc23361b66e58ee750f8fb5649220bb549dccd4bc5aa2ece7b52dae6dd65fdb` |
| `prompts/muse-snapback4.m7.md` | `77c2c010c10ad4eb5149a91259b9bb818494133f410aabfe84491333187e0d5b` |
| `instrument/social-messenger.md` | `129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6` |
| `instrument/schema/social-messenger/assertions.json` | `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
