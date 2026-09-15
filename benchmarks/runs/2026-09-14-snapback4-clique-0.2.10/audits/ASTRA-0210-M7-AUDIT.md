# Astra 0.2.10 M7 — final evidence and access audit

Orchestrator audit, not a blind review, independent grade, rescore, or author ruling. The received M7 result is green, supported by a completed seven-case suite and the sole M7 choreography segment. The full suite preceded a final UI-label change; choreography and build checks were repeated afterward. Preserve that sequence, the earlier failed attempts, installed-declaration accesses, and the snapshot qualifications below.

This audit reads completed custody, selected source, and only public command-start arguments from the raw M7 stream. It does not inspect private model reasoning, raw tool-result bodies, credentials, or stores, and performs no requests, tests, process operations, or packet/source edits. Only this external audit was written.

## Scope and identities

`P = /Users/ccheever/clique-sb4-20260913-relaxed-3models`; `L = P/lanes/astra-snapback4`.

`R = /Users/ccheever/projects/snapback-relaxed-record/benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/astra/m7` is the [selected M7 archive](../snapback-relaxed-record/benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/astra/m7). In that archive, `evidence-files/` preserves original lane-relative paths; `source/` holds selected source, with original/archive identities where redacted. Original narrative links still refer to the lane layout and are not a complete archive index.

| Identity | SHA-256 |
|---|---|
| Raw `P/logs/astra-snapback4.m7.ndjson`: 588,503 bytes, 203 lines | `0315729aa525e87222f7aba82e4f6731d5b8f4fc7bbdc6f7fdccb2b9547eb066` |
| `P/prompts/astra-snapback4.m7.md` | `a6a9274a4c24266598f8788269e4200f895c236ee27b5143c948ca15618fbad3` |
| Runner start JSON | `8a631f9043e2fc22958be1ebb355fa30d3cf781ffa8cbf7b5a8546cae3e1700c` |
| Runner end JSON | `b6b90e3b35cd68b56951075ad638148e4c80f9699a9912268e8cdd74810a0e7d` |
| `R/final-report.md`, original received text | `62d286eac4fc0a10e48e90ad0309be4d9f2573f070d7f682cfe725747dbdad20` |
| `R/diary.md` / `R/essay-paragraphs.md` | `b100dfef67f11d5f22b3d0404f462695a4652b494e6e586b8d340ccdb0940080` / `513a633ed111e117833fb04e8b36976dcd756e9bbea4063f14c74eab87b9ea6a` |
| `R/run-log.md` | `b5b03fffecb669c9f172d911f94a47249e81051c4805c17e846a156e96c94924` |
| `R/custody/m7-final-identities.json` | `6fc3d93053171e085eef2be9b06881f240344e4ee2f00fc5a9a3ac9114fb4186` |
| Completed `R/observer/events.jsonl` | `8f91f977c424a28e0bd24961f8b43bed4100136410a28b66b598383808610e90` |
| `R/observer/source-change-history.json` | `1f9a0ad1f3b81f1ad87dfeb33feb110e7bb023f4a949b1f5ff68fdc1ac627c73` |

Runner PID 74767 started **2026-09-15 00:52:06 UTC** and ended **01:39:57**, actual exit **0**, monotonic wall **2,870.258 seconds**. The builder’s received report uses `start=1789433536`, `end=1789436360`, wall **2,824 seconds** (00:52:16–01:39:20). These are different timing boundaries; use runner wall for the measured phase and retain the report’s own numbers as received. Exit zero alone does not establish the acceptance outcome.

The final parent observation at 01:41:01.673871 hashes 298 selected paths, reports seven changed original paths and no missing original paths. This selection includes evidence JSON, not 298 application-source files. It records all **35 installed `snapback4` client/package files and three platform-package files matching the published 0.2.10 control**, including binary SHA `af4e26be10419df9428bf6be0c7513de07d227e33f77cdb464c4d93dc2a0767d`. `snapback4-expo` is **0.2.3 metadata-only** in that comparison; the empty Expo file list is not a content check.

## Proof sequence and exact receipts

All dates below are 2026-09-15 UTC. Receipt paths are under `R/evidence-files/` unless stated otherwise.

| Stage | Received result / timing | SHA-256 |
|---|---|---|
| Initial M7 suite, `m7/evidence/m7-suite-initial.json` | 7/7, 01:10:04.043; predates later adoption correction | `af0376a9e1b99a04ebbc3281127297dee95f2577ed74b2d862b7c99ca0f3feb7` |
| Failed adoption/setup, `m7/evidence/m7-suite-startup-failure.json` | Setup false, 01:10:29.903 | `f3ea11df53ac94a479b9722bae4a6e9ce79e3eb557cc32c85b213b3f9f09c659` |
| PID-ledger failure, `m7/evidence/m7-suite-ledger-failure.json` | Six feature cases pass; prior-suite regression case fails, 01:20:38.195 | `938fe9079c7f05b590bcd18efadc93e04eaa5ba7b7072dbc2dd7066cd4688497` |
| Its M8 receipt, `m7/evidence/m8-suite-ledger-failure.json` | Three reporting cases pass; scheduled-digest/restart case fails, 01:20:38.161 | `b1b2824d8ba21c65adfdd672d806b9e6ea851f782b4b9a489903305c3a4e04c6` |
| Final full M7 suite, `m7/evidence/m7-suite.json` | **7/7**, 01:32:04.102 | `6be5e8a5eabdab40a8938502db4eab3536a5692be52080360a6bffb945e5fe85` |
| `m7/coverage-manifest.json` | Six suite-required IDs mapped, `missing: []` | `b71b5ac924cad734768155d8b27b2d045cedb12a3bdd3d3a75f773bb3445261a` |
| First sole M7 choreography, retained observer object | Two required assertions pass; summary 01:32:59.498, run `6fd84931-fbcb-4bbb-9176-d9d2e6d673a1` | `94458153e1e46c18e7d8065f562f9f25290ff137b553741f241ceaaa341b6d5a` |
| Final sole M7 choreography, `m7/evidence/choreography.jsonl` | Two required assertions pass; summary **01:34:02.902**, run `d5028bc3-0a3d-4dd6-9ef1-92fa7232615b` | `476f423dcf5b85d8cf60b135b295d73167354ab41a25b59384df8eb421d5e0f7` |
| Final choreography observations, `m7/evidence/choreography.observations.jsonl` | Five observation rows | `ab9ad3441efe2758b76758e640a73cffca6ad7598b2e5a9670112a197e1fb394` |

The final six suite IDs are **m7-a01, a03, a04, a06, a07, a09**. Choreography receives **m7-a02-live-poll-tallies** and **m7-a05-offline-vote-reconciles** passed. All three retained live-tally trials pass; the offline trial passes. Both choreography summaries bind the exact final suite hash `6be5e8a5…`, and report `green: true`, `nonGreenCause: null`. This is received coverage metadata and execution evidence, not an independent assertion-semantic judgment. **m7-a08 is the separate grader preservation predicate**; this audit does not create a post-M7 grade for it.

The public edit at raw stream **line 182, item_104** changes only `text={m.text}` to `text={m.kind === "poll" ? "Poll" : m.text}` in `src/chat.tsx`. The observer first sees it at **01:33:58.712440**, after the full suite and first choreography. The final `src/chat.tsx` hash is `4d6777e4d5ea36f5e3c81489b7f1f20f3cca7d076269bda6692cb59e0dd953b0`; reversing exactly that one substitution reproduces the preceding observed hash `0970e0d8c320ba97205d53d86cccf6620d1e93b44b670e7c1a7bb9f19515696e`. Final choreography, screenshot capture, typecheck, and iOS export follow. **The full seven-milestone regression suite was not rerun after that label change.** The final choreography uses the earlier full-suite receipt, candidly described by the received report.

The observer records no later application/schema/assertion changes through phase end; later changes concern evidence, diary/essay, report generation, and the final pointer. This is a two-second observation plus public-edit record, not continuous proof against transient writes.

## Previous assertions and served schema

Final regression receipts under `m7/instance/evidence/` show:

| Milestone | Cases | Recorded at | Final suite SHA-256 |
|---|---:|---|---|
| M1 | 6/6 | 01:24:45.224 | `c8348cb646fee74aa5b2bd17ca0e00eea9283c6164b6892f3d2f721939488ecb` |
| M2 | 10/10 | 01:24:49.478 | `ba71cce03fd0519e58a2030e95be45b8657758b4e173929a5ecc78a55355caca` |
| M3 | 5/5 | 01:24:52.753 | `3e23c993aa7e4bba02eef11689a7c954c9f38db12aad3270aba0a57ce0812b9f` |
| M4 | 6/6 | 01:25:55.306 | `5753afd6278919d46e5d7f8e649a5b3e880c679b76ff9cf89b5f5fff5c0a34fc` |
| M5 | 7/7 | 01:28:58.593 | `3b533ec6d5948ef2b2827411302ceb06c6edb34b0b5361a7e86918db20d95207` |
| M6 | 5/5 | 01:29:38.254 | `7a7b26265318bc51fb9aa3ce4874e5d8680eed384df4e528aafed70bf22e8618` |
| M8 | 4/4 | 01:32:04.055 | `b356615e58cfcce4bdbbbf784b3d3830dfc39e41dd894b6f5fb1c9c4e50f5d55` |

`m7/evidence/regressions.json` SHA `ba2b064f745c6016830183d4ec0819b2bcc1e0fa85d9f51e24c2ddb5c8fdaa6d` is identical to the initial successful summary because it omits per-run timestamps. The observer shows successful → failed → successful versions; the distinct timestamped final suite files above establish the later rerun. Do not mistake equal summary hashes for only one execution, or the inherited copies under `m7/evidence/m1-suite.json` etc. for these final instance receipts.

The six standalone assertion modules `scripts/acceptance-m2.mjs` through `-m6.mjs`, plus `-m8.mjs`, exactly match their pre-M7 hashes. **M1 is inline in `scripts/acceptance.mjs`, not a seventh standalone unchanged file.** That dispatcher changed from `a63b96c0b8b23bc38358594f24b0f66f41cd1b332d7741ea9f2c29b2f4fa3013` to `9a31cb6796cf15e5a2fdee0acc4ef9c3d5972cbc01f6cc3e630caf3ad3c9c788`. Removing exactly the two added M7 dispatch lines from the hash-matched final file reconstructs the complete original hash. Thus the prior M1 assertions are unchanged, while the containing file is changed. Public line 50 records that exact insertion.

`scripts/choreo.mjs` separately changes only adapter selection for M7 (`/m7/choreography-adapter.json`); the inherited harness is not rewritten. All 32 selected `ui/` files and 16 selected `choreography/` files match their initial observer hashes. This does not certify every frozen support file or erase inherited helper/import adaptations; `instrument/` and the support helper are not completely covered by that selected hash inventory. No public M7 command requests a frozen instrument/UI-kit content modification.

All **13 final root `snapback/*.q` files match their counterparts under `m7/instance/snapback/`** in the final custody and selected copied source. Public start commands target that instance, and the M7 regression wrapper runs the inherited suites there so their SQL/provider/restart paths use it. No source from the unrelated scale instance is used to establish this identity. These observations support final root/served-instance schema alignment; they are not an independent engine-state inspection.

The physical migration and snapshot chronology are separately established in [ASTRA-0210-M7-SNAPSHOT-AUDIT.md](ASTRA-0210-M7-SNAPSHOT-AUDIT.md), SHA `25e4b555084da74197b064fb7a2f55065c4ee0c2fcc94477e28401720c5604d5`: no inherited count structure; physical `messages.countWeight` backfill; persisted `conversationMessageCounts` maintain; projected API `conversation.messageCount`, not a physical conversation column. The maintained-ID adoption refusal and reversible old-schema recovery remain a product-defect receipt with an independent published-pin boundary check in [ASTRA-M7-AGGREGATE-ID-AUDIT.md](ASTRA-M7-AGGREGATE-ID-AUDIT.md). Current-main runtime applicability was not independently established there or here.

## Preservation, narratives, corrections, native evidence

The original baseline preserves 15 distinct starter messages across 39 persona projections, with all eight persona files present. Its media/expiry fields are null and reactions empty. The separate correction pair preserves 44 distinct IDs across 117 projections and is byte-identical across all eight before/after persona files. It has three distinct messages with populated media references, zero populated reacted messages, one distinct ordinary-photo byte hash, and additional sent/delivered/read states. It still does not witness live video or populated expiry; once-photo bytes are not hashed. The final report’s “3 distinct media messages / 0 distinct reacted messages” is consistent when “media” means populated references.

The received report qualifies the empty starter states and says “every **recorded** M6 message field.” Retain that restriction: the exporter’s 17 selected fields **omit documented `sender` and `quote`**, and collapse absent values into null. Neither the narrative’s “including the M6 message fields” nor the supplemental 18 post-only fixture-media checks establish a complete M6-field export. This is an exporter coverage gap, not a new grade. The frozen brief’s pre-session snapshot requirement also remains separate: the actual snapshot is after session start but before observed application edits. The later correction baseline must not replace it.

`m7/correction-loops.json`, SHA `db805d9c733223271715b90d6be7ad57c9dc1eeff49dca5397cf009b634eca4b`, is a **12-row grouped-episode ledger**. Its rows contain `id`, `attribution`, `description`, and evidence pointers; they are not individually timestamped normalized protocol loops. Received attributions are **10 agent-error, one environment, one snapback4-defect**:

| Received group | Named mechanism |
|---|---|
| Agent-error | `paths`; `rules-and-indexing`; `nullable-sum`; `expiring-mutation-scan`; `poll-label-revocation`; `failed-adoption-sequencing`; `pid-ledger-order`; `adapter-relative-path`; `duplicate-question`; `report-template-quoting` |
| Environment | `node-shim`: inherited shell selected Node 25.9.0; final named commands prepend 24.18.0 |
| Snapback4-defect | `generated-aggregate-identity`: write-accepted generated maintain ID refused during later schema adoption; derived tally cache replaced with indexed vote counts |

The run log contains multiple diagnostic/retry steps inside groups and additional bookkeeping/documentation notes. Do not equate 12 with every correction event or directly with another lane’s differently normalized total. The builder’s “independent reproduction” wording refers to a separate minimal project it authored; that builder repro is not independent grading. The separately commissioned orchestrator boundary reproduction is independently executed relative to that builder, with its own limitations.

Native evidence is **iOS Hermes export only**, not simulator/device execution. Archived `m7/evidence/ios-export-final.log` SHA is `20951c519750ab85d32ae9d16bcba2458a6bfd161bd2ce4b7f6ae604388b8ac1`; final typecheck log SHA `b4fce0e068cbf06902f15dba7eb964bc373038ccb78495a37ace692127e676e1`; toolchain log SHA `0319698187ab14b96f9df44b86ae660c7bb8fd1e2c42288becbe9b40e62d7885`. Received final bundle is `m7/artifacts/final-ios/_expo/static/js/ios/entry-014cfc6bb7f1f6071503f60be3a1d60e.hbc`, 2,700,438 bytes, SHA `1749e8f09b9f2ed6e592c0d043ed5ec2eec9228cc74126ca8631b636a23b9a88`; a read-only hash check matches those bytes. A bundle reference/hash is not a claim its bytes were copied into this selective archive.

## Bounded public-command access audit

The raw stream parses into 203 JSON lines without parse errors: one thread start, one turn start, **84 `item.started` command executions**, 116 completed items, and one turn completion. Only those 84 public command arguments were inspected, using the anchor’s request-level method. Result bodies, private reasoning, and other lanes were excluded; requested reads do not by themselves prove successful content delivery.

The prompt forbids other lanes, Snapback source checkouts, prior implementations/runs, and inherited `diary.md`/`essay.md`; it expressly permits inherited code/API/README/acceptance/run-log/final-report and the published README/guide/why/generated-types route.

| Access class | Observed requests |
|---|---|
| Installed Snapback implementation or source-checkout content | No explicit content read/search observed. Runtime package/CLI imports or execution are not content inspection. |
| Installed public declarations | **Two content-search events**: line 46 searches `dist/*.d.ts` for mutate; line 50 searches `contract.d.ts`, `local.d.ts`, `client.d.ts`. **One filename listing**, line 48, enumerates package `.d.ts` paths. These are installed declarations, not the lane-generated API; retain this additional discovery surface separately from implementation-source access and from the builder’s earlier zero-declaration-read audit. No author compliance ruling is made about “generated types.” |
| Published docs | Five README content-search/read command events (11, 13, 16, 26, 44); guide/why requests at 16, 35, 96. Generated app checks/residency are executable interface use. |
| Inherited lane files | App/schema, own acceptance/harness, API/README, run-log/final-report, suite/fixture metadata; permitted by this M7 prompt. |
| Prohibited inherited diary/essay, prior/sibling runs | No explicit content read observed. Line 191 writes the new `m7/diary.md` and `m7/essay-paragraphs.md`; line 200 checks their file size only. Report-generation references to their paths are not inherited diary/essay reads. |
| Application data boundary | Line 96 copies the owned instance store before recovery; lines 98 and 102 invoke public SQL over `pollVotes` / `pollTallies`. These are app-data/recovery operations, not implementation-source reads. This audit inspected neither store contents nor command result bodies. |
| Instrument/UI-kit and package mutation | No explicit requested M7 modification of frozen instrument/UI-kit or installed SDK source. Own dispatcher/adapter and app edits are separate; selected frozen-copy identity is qualified above. Final installed control match establishes end-state content, not absence of every transient edit. |

Selected command-start references below bind exact raw lines (SHA includes its line terminator). No complete multi-command argument, credential, or raw stream is copied here.

| Raw line | Item | Boundary | Exact line SHA-256 |
|---:|---|---|---|
| 46 | `item_24` | Declaration content search | `5562c998d5b9251da357010346a9bbc2b97db9c7c7e8d749222ac7515b491258` |
| 48 | `item_25` | Declaration filename listing | `77b62af93c0cee8ca6efa71e7749a37f6ad854c40e78930b2c2d720fe0ad65e4` |
| 50 | `item_26` | Declaration search; own M7 dispatcher/instance support | `05975389dd13c5dfc96bd0b8280288b4a33077aaaaa98cbf46dd33c9e3ce3dc2` |
| 96 | `item_53` | Owned store copy and old-schema recovery request | `cebbf06056bb64e27608e1cd37b2424086220d169e6b00f63432b025f4f21046` |
| 98 | `item_54` | Public SQL over owned votes | `fe8ad9bca55ebf929fded1211334400442f7bb8ef443dbf21d4272fb3d867b6c` |
| 102 | `item_56` | Public SQL over maintained tally identities | `69c44d7f2831a8bc7a1046fd0f6d18255abba0f33a31e41e56b854c2ab0aa714` |
| 182 | `item_104` | Final UI-label edit and subsequent focused checks | `97a47eb42f9deb0c1a27a02816c456f0feebf89ba3c903a35341ead6553fcc64` |
| 191 | `item_109` | New M7 diary/essay writes and explicit cleanup helper | `b2b06be619d9484eef0b644fb2fa24acad137e272760ff566636e7da6d4694df` |
| 200 | `item_114` | New narrative file-size checks; own final report/log reads | `b6efb6e032b34125b09df1be52b343fd364c889e8986941b0eb58f5e4dfc993d` |

This is not a blanket clean-source certification: dynamically constructed paths, helper/subprocess internals, symlink resolution, excluded results, and unlogged activity remain outside the method. The 84 command count measures audit scope, not productivity or compliance magnitude.

## Cleanup and selective archive limits

Received `m7/evidence/server-cleanup.json`, SHA `c126ab1ea167840f4b45c5c5453389bdff08cf6ff228d523ad3fd827d450427b`, names 15 owned process entries: two SIGTERM actions and the remainder already exited. Received port-check SHA `4bd6f7d715fc2351891d01c9559907bbf516942a60706de27c8d4203538add94` records no listeners on the used ports. Parent’s **01:41:02.332121** [late process observation](../snapback-relaxed-record/benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/astra/m7/custody/m7-late-process-observation.json), SHA `029fd075785019e8509fde98ad72cb7579d9f2714e2d9011682d59f21a3b68da`, finds all 16 selected PIDs absent (including phase child) and no assigned-range listeners. These support teardown at that observation time; they do not prove all possible descendants, prior absence, or future absence. No audit cleanup was performed.

The inspected `custody/astra-m7-copy-manifest.json` SHA is `a78c5ebdae3b34a0944d3c11c140d49ba2c616bb4fdb061e9f789c7dcbf8f7c4`: **352 entries, 321 unique destination paths**, all archived bytes matching their listed hashes. Repeated entries are not distinct files. It selects 119 observer objects and 72 source paths; scripts remain hash-only, source contents may be separately redacted, intermediate original source manifests remain external, and raw streams/stores/most generated outputs are omitted. The derived history is evidence of those original manifests, not a full source-version archive.

The first manifest did not inventory these four files by their original lane source paths. At **01:50:28.294945**, the parent explicitly selected all four under `R/evidence-files/<lane-relative path>` in `custody/astra-m7-terminal-logs-copy-manifest.json`, SHA `b32dfc6ba22e947f5245829248e7cb0539f46cc279d113eb8d2fa9c946985fe5`. This audit verifies all four archived hashes below. The parent reports the PID destination already existed with identical bytes; the earlier inventory gap is not a claim that those bytes were absent. None was copied by this audit.

| Lane-relative file | Bytes | SHA-256 | Use |
|---|---:|---|---|
| `m7/evidence/acceptance-final.log` | 463 | `db84216a1d0bb6bae7a0c5c3d64a21d0bc760d934f3a2e94408a5d05d72efac7` | Exact final command’s terminal result; explicitly linked by received report |
| `m7/evidence/acceptance-startup-failure.log` | 201 | `9c1e6e8092bd15bfd65412e16fa627b990491e7ea800bdec7cfc7ebfbd84e20f` | Retained failed-adoption/setup attempt |
| `m7/evidence/acceptance-ledger-failure.log` | 567 | `ec930c276d74dddea18dc70ea0f82f885b26fab9348b3a6e52e45431d943f109` | Retained regression/PID-ledger failure |
| `m7/pids.jsonl` | 2,699 | `463eeaf3bf809247e9d71d5dc6f7706898718563c2f6bd0ede7affb42b75b94a` | Fifteen explicit process-metadata rows supporting cleanup provenance |

The final typecheck, toolchain, iOS-export and choreography logs are already in the inspected archive. Original failed suite receipts, migration logs, final receipt hashes, narrative attributions, native limits, and the separate snapshot coverage/timing qualifications should remain with any reported M7 green result.
