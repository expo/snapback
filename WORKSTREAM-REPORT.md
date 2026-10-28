# Integration 30 — Snapback 4 0.4.46

Landing receipt: `~/sb4-loop/reports/integration30/landing.json` (records the pushed tip after the report commit). Final main integration: `dc4177b57f` (incoming `088c7b473e`, Postgres read-index serving).
Measured engine source: `7aef642aa38471d70eca0128d0a5ddd3b4cf518a`;
measured static production SHA-256: `e01da19c3cde5ba6c81dae725983e09a4441924fb91c800eeb37a3ea95778778`.
The complete incoming-main consumer chain uses source `dc4177b57f`, native SHA-256 `811295a71cd7929c93027fb31965ead2ccd2cc6ad154ed9f5333a88ef6ba4955`. The final guide-only correction `95baa87188` rebuilds native SHA-256 **`cd4f6de04dd5c972f88e6cff6ad89b32cd6f7bfa7b289cf905e5e9a04d98358d`**. All executable behavior and SDK inputs remain identical to the R4 source; the actual changed packed guide and shipping reading are freshly qualified below.
Root setup documentation subsequently landed in `7c1e781076`; its entire Snapback 4 tree is identical to the tested product tree (`89e625603dd822b1f85b1dcf3b33f202bef5e9b9`). Later metadata/main input equivalence: `incoming-input-binding.json`: unchanged check/deploy/security campaigns, compiler/planner and SDK inputs; Postgres HTTP/core/serving changes rerun separately on the main-integrated source. The entire final tree is not claimed identical.

## Merges and bump

Initial fetched-main merge: `95b664a563`; pre-merge main: `2034c0de728a21250fac5686b88987f64c113a44`.

| Lane | Merge | Result |
| --- | --- | --- |
| LAT1 | `8ab19e62b5` | Shared immutable campaign fixtures, compiler/report caches and ordered concurrent reduction; retains SEC11b/SEC13/SECP semantics. |
| REL4 | `d2cee1e66c` | Required-to-optional views, early actionable release refusals, safe forward activation and promotion. |
| SRV1 | `8325b57d63` | Parent-owned serving/proofs, signal forwarding, `stop`, holder diagnostics, starter production scripts and `prod:check`. |
| DX16 | `7f1351a99e` | Day-two routing, bounded section reads, frozen-v1 handoff, fresh proof identities and dormant `data --all` cells. |
| TOK3 | `ce0978b8d5` | One routed recipe, README pointer, declaration digests, editable starter regions and nullable idioms. |
| TOK2 | `cbbac56eef` | Bounded command/proof summaries, complete detail paths and repeat deltas. |
| CALLS1 | `84e66e6984` | Refusal-first proofs, exact `check --fix` repairs, one owned install wait and image upload options. |
| LAT3 | `7d4a5093c2` | Lazy browser imports and direct native proof execution. |

Version bump: `2ffe2911d7` (`snapback4 0.4.46: reduce tokens and latency across app and release loops`). SEC14 was not merged. One coherent `guide changes` entry covers the upgrade behavior and new commands. Existing stores need no migration beyond the 0.4.45 fence; frozen client behavior is covered by release/consumer proofs below. LLP 3000.037 records the integration.

## Seams and reviews

Campaign integration retains fixed work budgets, independent authority replay, every tier, source/decision guards and original ordered reduction. Guide material uses pointers/sections and declaration digests within existing budgets. Refusal-first details remain inside bounded layouts. Starters preserve app-owned edits while combining production lifetime, install and day-two handoff behavior. Generated censuses, registry, guide projections, declaration digests and inventories were regenerated, never hand-merged.

Only the authored conflict-resolution diff on seams 1–3 was reviewed: one Muse and one fresh Codex, both **READY**, source `e804cf6292`, diff SHA-256 `a6694ae887c6b071f7a984bb9919d53cffea43492d0ebab9f9cbdef5049c3566`. Verbatim reviews/transcripts and provenance are under `llp/reviews/3000.037.000-integration30-*`; exact diff/brief are under this report directory. Later item-9 engine fixes and metrology adapters are not claimed to be covered by those reviews. No additional reviewer rounds ran. The later fetched-main merge mechanically adds parser-clock installation before the existing bounded startup collector, and appends both journal histories; its serving and lifetime checks rerun below. Those incoming resolutions are not represented as part of the earlier reviewed diff.

## Item 9 — latency regression

`99755c7750` schedules strict-production SECP restoration concurrently with the report/witness campaigns. The exact original note vector must match before consuming the ordered restoration suffix; mismatch falls back to current replay, and post-replay source guards remain. SEC13 uses the shared batched campaign machinery. `7aef642aa3` computes immutable canonical declaration/source analysis once per report, retaining full note/coverage reduction. The previous complete matrix missed warm check (2.590462 s); its raw captures remain retained separately. The final full matrix below reran after the actual engine fix; no threshold or campaign budget was reduced.

Paired adjacent production binaries, rotating order, four workers, the same shared-host window. Actual dist 0.4.44 SHA `e4f5d315884ee5c6b06579dc76f4625134ce1614371ccce9f5287c1758a7a8aa`; retained Integration-29 0.4.45 SHA `e5488d6298ab87783662a776eb2781a8d506ff0e1ee6b36e996a04332b61c43a`; merged SHA above. Private source/fixture copies only. Exactly 63 cases / 1,890 invocations / 63 hash-bound raw captures; zero tool failures. Sample54 follows Integration28's JSONL protocol; nine exact wave33 day-two cases follow its source-only release protocol.

Cells are cold median/p90; warm median/p90 seconds.

sample54

| Command | 0.4.44 cold; warm | 0.4.45 cold; warm | 0.4.46 cold; warm |
| --- | --- | --- | --- |
| check | 3.909/9.810; 2.992/8.346 | 10.749/27.695; 6.096/15.514 | 2.866/5.834; 2.104/4.565 |
| staging | 4.285/10.164; 0.559/1.183 | 12.668/26.805; 1.389/2.560 | 2.877/5.866; 0.078/0.128 |
| production | 4.421/11.071; 0.557/1.777 | 18.602/33.591; 1.404/4.108 | 2.808/5.996; 0.076/0.172 |
| preview | 0.570/1.784; 0.571/1.786 | 1.423/4.229; 1.403/4.155 | 0.113/0.220; 0.112/0.220 |
| review | 3.978/9.789; 3.045/8.170 | 11.661/30.437; 6.212/15.847 | 2.975/5.961; 2.181/4.441 |

day2-nine

| Command | 0.4.44 cold; warm | 0.4.45 cold; warm | 0.4.46 cold; warm |
| --- | --- | --- | --- |
| check | 5.691/10.438; 3.464/9.952 | 17.577/34.555; 6.036/21.465 | 3.295/5.588; 1.988/5.390 |
| staging | 6.129/11.424; 0.899/2.377 | 18.322/38.510; 1.969/6.143 | 3.370/5.487; 0.108/0.226 |
| production | 5.274/10.491; 0.924/5.244 | 25.051/46.755; 2.000/6.335 | 3.143/5.648; 0.108/0.521 |
| preview | 5.637/11.636; 4.461/11.061 | 26.126/45.916; 11.853/35.321 | 3.631/7.602; 3.593/6.407 |
| review | 5.794/10.743; 3.550/10.202 | 17.996/35.294; 6.103/21.594 | 3.332/6.149; 2.339/5.992 |

All requested bars pass: sample54 cold check p90 **5.834 s**, warm check median **2.104 s**, staging cold p90 **5.866 s**; day-two preview cold/warm p90 **7.602 / 6.407 s**. Every reported median, p90 and maximum is below 0.4.44. Four sample54 preview preparations refuse for the same genuine sources on all three versions (waves26/27 asphalt;30/31 garage); all nine day-two predecessor preparations succeed. Full source/hash/method bindings are in the retained latency artifacts. Latency tickets: both Integration28 and SEC13 latency tickets are closed with the complete matrix and identity qualification; the separate whole-proof-loop wall-time ticket remains open.

## Identity and product evidence

Full waves15–34 census: **1,020 schemas, 6,120 paired comparisons / 12,240 invocations** against the uncached sequential control. **6,091 literal matches; 29 upload-ID nonce-only pairs across 17 schemas; zero unexplained differences, errors or input changes.** The producer's literal exit1 is retained. All nonce differences reproduce with two independent unchanged-control executions per affected schema and are confined to the existing upload-ID ticket. Current verdicts, tiers, question/witness IDs and all other payload fields/order remain exact. Each disposition ID appears exactly once: 13,451 advisories, 1,455 questions and 7 gates in the cold-check census. Strict typed/source-bound adapters, original helper hashes, 9 original controls, 16 copied-upload controls and 13 warm-administration controls are retained; no general string/ID/array normalization. The third warm-administration case has literally equal empty security envelopes; only the pre-existing administrative event-time/duration projection applies. Details and verbatim tools are in `identity-summary.json` and `metrology/`.

Final product survey on private source/JSONL copies: **1,020 schemas; 980 source-hash-identical Integration29 comparisons; zero byte-identical day-two skips. Zero false gates or new production refusals.** All 7 gates, 20 fresh production refusals and 21 enforced refutations match individually source-reviewed baseline cases; no unclassified/new refusal or missing prior gate/witness effect. All witnessed question/gate IDs appear in actual default output. Default check lines median/p90 **3/6** (max 16); deploy **3/3** (max 5), meeting all requested bars. Full raw results remain externally retained with SHA-256 `df7b6690fda320728db63ee825fb335eb5e3e9e1920623dac675e5a4cfce7f08`.

Calibrated M coverage is unchanged: waves30–33 **11/14, 12/16, 6/8, 6/15**. Matching requires the actual operation/material/role/old-new condition and the witnessed decision ID in default output; unrelated advice receives no credit. Calibration/source hashes and every assessment are retained.

REL4 replay: **150 stores / 728 successful moves / 22 expected refusals / 294 consistent rollback populations; zero new false refusals, unexpected refusal codes, timeouts or hidden v1 rows.** Every five-move outcome matches Integration29. All 32 rollback populations with physical predecessor-name absences have exact baseline shapes plus explicit source-declared rename/extraction into actual served fields/children; 68 negative controls reject lost declarations/target fields. An initial audit incorrectly required physical old column names even for declared renames/extractions, and its literal failure is retained. The corrected audit enforces the guide's logical retained-view contract plus exact baseline equality for every column/shape difference, never ignoring a new loss. Packed frozen-v1 consumer proofs separately exercise retained values and denied writers. Raw capture SHA-256 `470e7a5976e772e2eba4f6f31fecfb6d9ceef3ce1c2e429f64f3d8024546eece`.

Final main-integrated binary reading replay **PASS**: day-one docs before schema **2,937 tokens <=10,000**; four day-two strict totals **10,092 /8,564 /11,577 /10,969 <=12,000**. Every retained CLI/init/help command is replayed; only the two historical wrong-section attempts deliberately retain exit1 and count their refusal text. All four checks exit0. The strict total retains the original non-CLI documentation, replaces every CLI read, and counts the **entire current check output**, including current change notes/security ceremony, as a conservative upper bound. `o200k_base`; no budget was raised and no new whole-agent session is claimed. Source, binary/tool/capture/output hashes are in `reading-summary.json`; these totals are rerun on the final `cd4f...` guide-corrected native.

## Item 10 — deterministic reds repaired

- Restored the shared promote/rollback command-table order without changing its ordering assertion.
- Real product defects: dense literal guide hits were lost when one paragraph exceeded the budget (`f337b89f57`); explicit detailed human output now streams for source-change observation (`f6c031a0ea`); token-mint busy refusals name the actual held-store owner (`9d85b0fcbf`); clean declaration-digest builds create their output directory before writing (`978e13fb8e`).
- Guide/starter fixture expectations now follow bounded `--full` section indexes, explicit `--repeat`, README-to-reference routing and deferred local install setup. Detailed witness assertions select documented detail flags while default visibility/budgets remain independently asserted.
- Store ownership fixtures now hold a real flock; recovery still proves exclusion and retained rows. Installer assertions retain the 11-second silent failing child, one owned install, two status lines and exit7, replacing polling chatter expectations.
- Declaration goldens were regenerated for comment/index changes; signatures and schema goldens remain asserted. Packed security follows the paved README/start/workflow route and retains row/price/hidden-field and excluded-caller assertions. Stale-recovery narration is required; the Playwright fake implements the real response event; current device/sync fixtures pin 0.4.46 while historical engine fixtures remain.
- Incoming main introduced inaccessible LLP and checkout-only Rust-file citations into `guide release-json`. The unchanged guide assertions caught both; `95baa87188` states the same supported-writer/revision/fence contract in self-contained operator prose. All 134 guide tests pass. A fresh packed old/new counterexample reads the section **and its bounded continuation**, preserving every contract assertion and the reading budgets. The first packed attempt read only the first section and its literal failure is retained; no product paragraph was dropped.
- Restored the repository's existing root workspace-hoist precondition after Bun install; full guide and inventory targets then pass. `7c1e781076` documents that step and regenerates root guide projections, preventing the same fresh-checkout setup failure. No dependency, assertion or budget was weakened.

## Verification receipts

Scoped affected product source `7aef642aa3`, base `2034c0de728a21250fac5686b88987f64c113a44`: complete CLI/core/language Rust crates; 40/40 client files (**502 passed, 8 existing skipped, 0 failed**); fixtures, client/chat/Expo typechecks and all root/wasm checks pass. The conservative selector's original broad plan and exact omitted commands are retained. This matches Integration29's commissioned lean scope; **canonicalComplete:false**, not a full selector/client/model-pool qualification.

The first complete source-unchanged receipt literally failed only guide/inventory due missing ignored workspace links. It remains unchanged. `ensure-workspace-hoist.mjs` repaired the environment; a source/input-digest-identical target retry passes both checks (guide 22/22). `affected-final-verdict.json` combines these explicit attempts, all 23 selected stages passing. Native semantic tests did not need repetition for ignored links. The later docs-only commit also passes stock `affected.mjs --base7aef --run` plus inventory checks.

Incoming main then runs complete CLI/core/language crates and all root/wasm checks again. The original complete, source-unchanged receipt is a literal FAIL: only the language guide target (132 pass / 2 fail on inaccessible references) and my five nonexistent client path spellings failed. Every other Rust target/stage passes. The guide-only repair passes the unchanged full guide target **134/134**, and the actual client selection is corrected to **10 unique files / 157 tests: 154 pass, 3 existing skips, 0 fail** (three original real targets plus seven corrected/expanded tracked targets). No product assertion or skip changed. Feature-gated Postgres core tests also compile successfully; live private-PG qualification stays bound to the incoming lane's retained evidence. `incoming-affected-summary.json` preserves the original failure, exact results, correction scope and final semantic qualification, with `canonicalComplete:false`.

Complete final packed `qualify-linux.mjs --consumer-only` **PASS again after the incoming-main merge**: source `dc4177b57f`, native `811295a7...`, all host helpers/frontends/starters/audits, Expo configuration-merging regressions, release/promotion/security/migration/staging and clean Ubuntu/Alpine consumers. R4 consumer receipt SHA-256 `1913ff6d09e030ca54dcd5a9b528be9f568e86cb4b11fff77ec4a136abc61271`; `publicationQualified:false`, `suite:not-run`, as required. SDK/Expo immutable packs retain their exact tested package tree and integrity hashes. Earlier R3 source 7aef/native e01 complete PASS receipt remains unchanged. The final `95baa87188` delta changes only release-guide prose and its journal record. Reuse R4 for the unchanged executable behavior/SDK/proof inputs under LLP0232; a **fresh packed SDK/platform old-versus-new guide proof** checks the final `cd4f...` bytes, requires zero inaccessible references across both bounded sections and the complete supported-writer fence/revision contract, and reproduces the previous-package counterexample. Its actual source, tarball/SDK/native hashes and command capture are in `packed-guide-closure-summary.json`. Shipping reading also reruns on those final bytes. No final-binary complete-chain receipt is claimed for this prose-only delta. Disposable dependency trees were pruned only after each chain completed, with symlink targets excluded; receipts, logs, audits, source and packs remain.

Ordinary difftest: **2,000 cases / 120,026 executions / 9 oracles, exit0, zero disagreements/errors/unexpected binder refusals**. Lean build passes; `run-lean` literally exits1: 2,000 generated, 5,680 executed, 1,658 pass, 324 unsupported, **18 existing open model-contract disagreements**. Every oracle counter and all 16 saved case `.q`/`.json` hashes match Integration29 exactly. These are the documented next/continuation and E_RULE-vs-NOT_FOUND model questions, outside publication's test.sh; no oracle or assertion was weakened and no new disagreement was waived. Full logs/cases and literal exits are retained.

Wasm: **2,416,593 raw / 738,507 gzip / 555,739 Brotli bytes**; budget **739,007**, exactly measured gzip+500B (tightened 258 B). Generated-artifact, diagnostics, inventory, guide, reference, documentation-budget, release-guard and selector checks pass. Final metadata/incoming-main checks: incoming source-bound results above; final report/LLP/journal/metrology-only changes pass the selector's four documentation targets, explicit inventory checks and a fresh no-record wasm measurement. The tracked lane-local `WORKSTREAM-REPORT.md` alone triggers the conservative full fallback; exclude only that report from target selection while retaining it in the full observed-file/input digest and preserving the original broad plan. All native/SDK/build objects must equal qualified95baa87188; the actual selector `runPlan` receipt remains scoped (`canonicalComplete:false`). Exact post-report receipts, native-input-object equality and pushed tip are recorded in the external `landing.json`. The final native/SDK/build input objects are pinned in `final-native-inputs.json`.

## Retention and deferrals

Raw captures, copied executables, commands, input/capture/tool hashes and complete receipts are retained under `~/sb4-loop/reports/integration30/`; compact evidence and this durable report are committed here. Source stores were never opened, owner/token sidecars were excluded from store copies, and publication outputs/worktrees were untouched. Root `WORKSTREAM-REPORT.md` is the lane-local copy of this report.

Publication owns the full client/reverse-dependency battery, non-consumer qualification, Mac/devices/20k campaigns and npm publication. Wave35's equal-task five-arm run and the Snapback-only wave34 rerun measure whole-session tokens/calls/wall time after landing; this integration makes no replacement whole-session claim.

Final git status: clean; post-push porcelain and remote-tip equality are recorded in the external landing receipt.
