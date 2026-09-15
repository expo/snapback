# Grok 0.2.10 M7 — final evidence and access audit

Orchestrator audit, not a blind review, independent grade, rescore, or author ruling. The received M7 result is **green**: its final choreography binds the six-case suite receipt and passes both required browser assertions. The UI fix occurred after that suite; choreography and native export followed, with no later observed application edit. Preserve the failed choreography, retrospective run log, in-memory migration boundary, inherited grading qualifications, and explicit packaged-source accesses.

No new application requests, tests, store reads, signals, phase steering, or packet/source changes were made. Only this external report was written. Private model thought, plan/text bodies and raw tool-result bodies were excluded; access analysis uses public tool request metadata/arguments. No credential or raw multi-command content is reproduced in this artifact.

## Custody and timing

`P = /Users/ccheever/clique-sb4-20260913-relaxed-3models`; `L = P/lanes/grok-snapback4`.

`C = /Users/ccheever/projects/snapback-lanebriefs/cell-custody-0.2.10/grok`; `O = C/m7-observer`.

All four completed M7 narratives were read after matching the final parent capture. All **123 selected paths** in `C/m7-final-identities.json` also hash-match the completed lane observation used here. This selection includes evidence files, not 123 application-source files. Parent staged selected source/JSON separately; this audit did not recopy them or certify a complete runnable archive.

| Input | SHA-256 |
|---|---|
| `P/logs/grok-snapback4.m7.ndjson`, 4,271,512 bytes / 3,494 lines | `9e9cb55ae1c681c5f0be5fa91ef9ae2660be6d6efec810c599c81d9dc24f374d` |
| `P/prompts/grok-snapback4.m7.md`, 5,016 bytes | `adec3c8f6964ac9348f65a0d345852aa22c61eaa50fd193be747d538e4b6172d` |
| Runner start / end JSON | `719f4a4c71f10c666aa87daf4b9d2df8834d12c3c969d1579f5faac95c687285` / `66f1d5bd2f4c3c11a1409839a82fb692c673b84a45a56fb724bbcd5f5e479778` |
| `L/m7/final-report.md` | `6cdbbaf57baf4aa62fd6d98efa961f8908f2760c284f213eb59146440bae8cd8` |
| `L/m7/diary.md` | `176c1afff338e4827a0cfd16efeb2290f0f1b15afde33ea975da9ba3b6d79b69` |
| `L/m7/essay-paragraphs.md` | `17053f92eec426a69e289f491bb3855985b835fff550ed23a5446f6593e5a385` |
| `L/m7/run-log.md` | `182c52c7f4c97805e780ee79fd415834753b54fe44d5841e2182d996065fc86c` |
| [Final source/package identities](cell-custody-0.2.10/grok/m7-final-identities.json) | `db1b39e8e4f04965d1045f642f03f914c0262906108654776cee72e6cad902f8` |
| Completed [observer events](cell-custody-0.2.10/grok/m7-observer/events.jsonl), 99 lines | `ce09001b1f08a859e2d2631a07188f4b471732fa2fff956f4b687c6d808b0689` |

Actual runner: child **59663**, **2026-09-15 01:41:40–02:09:28 UTC**, exit **0**, monotonic wall **1,667.198 seconds**. Received report: `start=1789436514`, `end=1789438129`, **1,615 seconds** (01:41:54–02:08:49). Use runner wall for measured phase duration and retain the report’s distinct boundaries. Exit zero does not by itself prove milestone success.

The initial run-log line labels local 18:41:54 as `2026-09-14T18:41:54Z`, inconsistent with its UTC epoch. More materially, the observer sees the run log remain **236 bytes** from 01:42:04.756492 until 02:08:12.867521, when it becomes 4,513 bytes; its last update is 4,633 bytes at 02:08:59.212817. Most events/corrections were therefore entered retrospectively near the end, rather than appended contemporaneously as the prompt requests. Many lines have no timestamp, and the adoption line uses `1789437xxx`. Prefer retained receipt/observer times over reconstructed narrative chronology. This does not erase the received events or their attributions.

## Exact suite/choreography linkage and sequence

| Receipt under `L` / retained observer object | Received evidence | SHA-256 |
|---|---|---|
| `acceptance/m7.json` | Six mapped cases pass, **02:00:52.690 UTC** | `0e0c8797ebf6bcc1f6d5345934a348b1e72a0c5ef5327ef6c7c4be511a5d402c` |
| `acceptance/m7-coverage.json` | m7-a01, a03, a04, a06, a07, a09 | `9346affcaa0dbfeefd190e2f1d7858662d2e3b69bddd87554e35b24056e329d4` |
| First completed failed choreography [object](cell-custody-0.2.10/grok/m7-observer/objects/12bcbad37d0dd5be2372d0f11a0aecddce69df7a90ec21269e19577c1e5a9bd5) | Live-tally assertion passes; offline assertion fails; summary **02:02:49.253**, `outcomeClass: application`, `nonGreenCause: choreography-failed` | `12bcbad37d0dd5be2372d0f11a0aecddce69df7a90ec21269e19577c1e5a9bd5` |
| Failed-run observations [object](cell-custody-0.2.10/grok/m7-observer/objects/22286ef9f77c343d996c891b7e72b914d44a3fdf397c4bb4fcbd3b9efdceeaca) | Retained first failed run, not replaced by later green | `22286ef9f77c343d996c891b7e72b914d44a3fdf397c4bb4fcbd3b9efdceeaca` |
| Final `receipts/m7.jsonl` / [object](cell-custody-0.2.10/grok/m7-observer/objects/b4fb89e40170427b452a496801d540c2351ece1b081205d4e6d4b94936948ddd) | Both required assertions pass; summary **02:06:28.804**, green true, nonGreenCause null | `b4fb89e40170427b452a496801d540c2351ece1b081205d4e6d4b94936948ddd` |
| Final `receipts/m7.jsonl.observations.jsonl` | Retained final observations | `e1aa0ac667b0f5f39efc4215b77cc73ddbc63df743e02dbee416ad923a217729` |

The failed run is `567fe9a3-981b-4a14-b317-6b5c145f3755`; the final run is `d2738e48-98a5-4532-acd9-560974e96d31`. **Both summaries bind the exact same suite SHA `0e0c8797…`**, not merely a mutable filename. Final m7-a02 live tallies retains three passing trials; m7-a05 offline reconciliation passes. The suite’s six IDs plus the two choreography IDs do not supply an independent m7-a08 preservation grade; the final report correctly identifies that predicate as grader-owned.

A preceding Node-version setup refusal is reported in the narratives. Public requests show an initial default-Node choreography at raw line 2323 and a retry explicitly selecting Node 24.18.0 at 2373; final choreography at 2720 also explicitly selects it. That setup attempt is distinct from the subsequently retained browser/application failure. This audit does not substitute uninspected raw result text for a standalone setup receipt.

The final application change is **`src/PollMessage.tsx` at observer 02:04:12.738769**, SHA `a2a6fe01162897aa49fd9de468806377f58b061a9d756d748e82b8b1857cf69f`. Public replacement line 2529 and final source support the stated app fix: retain last options during offline/in-flight reads, avoid replacing equivalent option state, and pause refresh while an optimistic vote is pending. This follows the suite and failed choreography; final choreography follows the fix. The suite was **not rerun after this UI fix**. No later application/schema/assertion edit is observed through phase end; only narratives change after final choreography. The observer polls every two seconds and cannot exclude transient writes/restores.

## Prior-green obligations and assertion custody

The builder-execution prior greens were **M1 and M2**, so the M7 regression obligation is those two. The M7 `m7-a09` body launches the inherited acceptance script separately for `m1` and `m2` and requires each child’s actual exit status to be zero. Final nested receipts show:

| Prior suite | Received rows | Timestamp | SHA-256 |
|---|---:|---|---|
| `acceptance/m1.json` | 7/7 | 02:00:51.882 | `da16286ad17e8ac95383e59ef5c57d5e6c640defe13b93097f810222097481eb` |
| `acceptance/m2.json` | 22/22 | 02:00:52.673 | `3711c72c11cd916e042a73705ca287cb7ef96b488107e21a7652b599cabc3c37` |

The final report’s “nested plus direct” wording should not imply an additionally established direct M1/M2 rerun: the inspected public requests show the M7 command and its source-defined nested M1/M2 children; the separate direct loop at raw line 2260 targets **M3, M4, M5, M6, M8**. Those optional suite receipts are received pass at 02:01:23.665–02:01:24.690 (7, 5, 6, 5, 6 result rows respectively). Their prior choreography failures were not rerun or upgraded.

All acceptance assertions reside in a changed common file. Reversing its three recorded M7-only public replacements in memory exactly reconstructs the pre-M7 hash:

| Source | Pre-M7 SHA | Final SHA | Verified change |
|---|---|---|---|
| `scripts/acceptance.mjs` | `40c7d7ba2996abe2b488f59104e47f027aa905709cb1e9baf4d2205138eb8690` | `cc06cff221fb44949d9afaf5fcc54c65d81fd4b576d25e0ed1e7bf7a917b9d95` | Add spawnSync import, M7 coverage list and M7 tests; prior test bodies remain unchanged. |
| `scripts/lib/replay-core.mjs` | `4a6dd23d87d428f8dd6e41137222997093320028c1fc81f0f351f41595d69bba` | `d9f6e3347942ecc176b231dc09e378d29334dbe93d878a5b30c71caafe216a44` | Add two mutation and three query handles for polls; reverse both additions reproduces original hash. |

These comparisons were performed without copying script bodies into an artifact. They establish unchanged prior test bodies, not newly honest assertion mappings. The pre-M7 independent Grok grade’s M2 capability failure for tautological mappings remains received evidence; M7 rerunning the same tests does not overturn it. See [GROK-0210-GRADE-AUDIT.md](GROK-0210-GRADE-AUDIT.md). No independent numerical verdict changes here.

The M7 count test’s scope is also concrete: m7-a06 queries Alice’s first inbox/history pages, compares nondeleted returned history length with `conversation().messageCount`, and requires the named starter group count at least nine. m7-a07 sends one text message and checks +1. These are useful received numeric checks, but do not themselves test all-persona pagination, tombstone/expiry transitions, or settings UI visibility. Do not convert the six-row coverage manifest into a broader independent semantic certification.

## Route, schema adoption, and snapshot boundaries

Final parent identity lists eight changed original paths and one missing path. The missing `app/conversation/[handle].tsx` is accounted for by the M7 route conversion: public writes create `[handle]/index.tsx` and `[handle]/settings.tsx`, then line 1993 removes the old file. Comparing immutable old source to the new index shows adjusted relative imports and an added DM settings link; it is a **move with a small behavior addition**, not a byte-identical rename or unexplained deletion. Final index SHA is `f04b9762dfe431a2aac772a015df21a856a90b76e5132adee8ae4b97f31aa622`; settings SHA `9f2c9354b8e36bfe8b3076eef0a42b59c0eb780c6ccbdcd46b0d8fbed41fc75f`.

The inspected schema remains SHA `2040a14bbbd282db27e9ff9456d43acc13e149c0587e88e39aec765bcbb7017f`, first observed at 01:54:25.943658. The actual count mechanism is a new engine-maintained aggregate over `messages` grouped by `conversationId, deleted`; `conversation()` projects the false/tombstone group as `messageCount`, and the maintain is `online only`. No physical conversation counter or explicit count-backfill job is added. Optional `messages.pollQuestion`, an index and poll tables are other schema additions. Inherited schema has no conversation message-count structure.

The public start request uses **`dev --port 49340 --fresh`**, and the received narratives explicitly describe a live **in-memory** store, generation 2 Additive adoption in 13 ms, maintained aggregates rebuilt, and starter counts 6/9. The README’s `--fresh` contract confirms this is an in-memory backend. A stored maintain here means an engine table in that working store; it is not a demonstrated disk-persistent migration or migration-at-scale. The 13 ms/generation/6-and-9 adoption detail is received narrative evidence in this audit; the raw terminal result body was excluded. The suite adds the bounded count checks described above. No store was independently opened and no adoption operation was rerun.

Preserve [GROK-0210-M7-SNAPSHOT-AUDIT.md](GROK-0210-M7-SNAPSHOT-AUDIT.md), SHA `86912ee90797594205ec3b4b3eb76c076dcee7b38bc78deadd46ef0e69a48a7f`, as the fixed preliminary witness:

- Original pre snapshot completes 01:50:24.763; first observed application edit is 01:53:37.598. Snapshot is after session start, retaining the frozen pre-session versus prompt pre-edit mismatch.
- Eight persona files in each set; 15 distinct messages / 39 projections; 24 distinct receipt rows / 66 projections. All payloads match after removing export timestamps.
- Media and editedAt are null, reactions empty, tombstones false, all receipt delivered/read flags false. This is nonempty initial receipt identity evidence, not delivered/read or populated-media preservation.
- Exporter captures 14 named fields; comparator omits poster and media metadata and checks subset/set inclusion. Broader returned author/quote/expiry fields are not exported; Grok’s explicit M6 prose list is narrower than the full returned row.
- Neither snapshot exports `messageCount`. The final suite’s numeric count checks are separate evidence, not part of the snapshot pass.

The final diary/report’s general “same messages, media, receipts, reactions” should carry those populated-state and field limits. The report’s explicit m7-a08 grader boundary is retained; this audit creates no post-M7 independent grade or author migration ruling.

## Received correction labels and an attribution qualification

The final report and retrospective run log list **four numbered corrections**: three **agent-error** (sync horizon index, narrowing optional poll labels, unstable/offline poll-option UI) and one **environment** (Node setup-identity mismatch). There is no separate normalized event ledger. These are received grouped labels, not proof that only four diagnostic iterations occurred and not directly comparable to another lane’s differently normalized total. No new Snapback-defect label appears in the M7 tally.

The offline UI failure is consistently classified as application/agent-error: the retained first choreography has `outcomeClass: application`; source changes keep the options mounted rather than treating an offline read as an empty option list. The final essay correctly limits its offline evidence to the online client’s in-memory queued write surviving a link interruption. It does not establish queue durability across navigation, process loss, or restart; the earlier M8 verdict is unchanged.

**Potential attribution correction, separate from grading:** the report says jobs cannot page expiring `messages`, and the essay generalizes that jobs may not scan expiring tables. That is overbroad. The published README’s job surface describes `chunk` sweeps over an immutable/id index; the separate Astra M7 evidence has an actual successful published-0.2.10 `counts.backfill` job chunking the expiring message table by `byId`. Ordinary mutation scans and particular unsupported loop/index forms must be distinguished from the documented job form. The Grok source uses a maintain successfully; its broad claim does not establish a product gap or a new defect. Retain the original narrative wording as received and qualify it in the surrounding record; no product fix, issue, SQL decision, or author ruling is commissioned here.

## Package and public-source access custody

The final 02:28:04.965544 parent package comparison has all **35 `snapback4` client/package files** matching the published 0.2.10 control. Two platform metadata/notice files match; the native executable is the **previously development-re-signed** 7,701,616-byte binary, SHA `929be28d4907839a25b88d9ec456b2a1a18c44921e8e223f86e6982c64cb8ed2`, not published full-binary SHA `af4e26be…`. The prior [signature observation](grok-signature-observation-20260914.json) establishes matching compared section payloads and differing signing/load-command custody. It does not make the binary pristine or prove re-signing caused a launch repair. Expo remains **0.2.3 metadata-only** in this file comparison. No new signing or installed-SDK edit request was identified in this M7 stream.

All 32 selected `packages/social-ui/` files and 15 selected `choreography/` files match the initial observer hashes; no explicit M7 instrument/UI-kit mutation request was observed. This is not an assertion that the inherited copied instrument is identical to frozen input: the earlier import/support adaptations remain qualified in [GROK-0210-ACCESS-AUDIT.md](GROK-0210-ACCESS-AUDIT.md).

The raw stream parses without malformed lines. The audit inspected **204 public `tool_call.rawInput` records**: 28 terminal requests, 94 file reads, 23 greps, eight directory listings, 12 writes, 33 replacements, two output-poll requests and four todo updates (todo content not used). Other events were counted by envelope only. The prompt’s permitted discovery route names published README/guide/why/generated types and inherited app code; prohibited prior/sibling/source-checkout and inherited diary/essay reads are separately screened.

| Discovery class | Observed public requests |
|---|---|
| Explicit installed implementation content | **Seven events, five reads plus two greps:** CLI shim `bin/snapback4.js` once; `dist/client.js` four reads and two searches. These are content access, not executing a wrapper or a generated API read. |
| Broad installed-package searches | **Two additional recursive/package-root greps**: migration/backfill terms and `mintId` function discovery. Keep their broader requested scope separate; result paths were excluded. |
| Installed declarations | **One explicit read**, `dist/react.d.ts` at line 1645. Distinct from implementation and the lane-generated API. |
| Published docs | Eight direct README read/search events; public guide requests through inherited `scripts/sb4.py`. |
| Generated API | Seven explicit read/search requests to `src/api.generated.ts`; normal copies/imports are not additional content-discovery events. |
| Inherited lane and instrument | Own code/API/README, allowed run-log/final-report, acceptance, UI kit, choreography and fixtures. No explicit prohibited inherited diary/essay read or sibling/prior-run/source-checkout content request identified. New M7 diary/essay writes are required phase outputs, not inherited reads. |
| Other host support | Line 1030 reads the installed Grok long-running-background-tasks skill. Record as host-agent support, not Snapback implementation or prior-app evidence. |
| Store/path references | Early command lists existing own-store/PID metadata, including the old scale PID filename; this is not a demonstrated scale-store content read or reuse. Actual M7 start requests a fresh backend. Dynamic subprocess/returned-content behavior remains outside this method. |

Thus the source-custody record must retain **explicit packaged implementation discovery outside the prompt’s enumerated documentation/generated-type route**. No blanket clean-source or complete compliance claim is supportable. No raw arguments, credentials, or source bodies are copied below.

| Raw line | Public tool-call ID | Request | Exact line SHA-256, including terminator |
|---:|---|---|---|
| 509 | `call-0adfb6e9-21ec-4bcc-9da6-496b4312cd48-49` | Broad package migration search | `165bc6b726643f246ceff42f8d8ce7cf5cb91cd250b17cd81e29872fca9b6168` |
| 648 | `call-f084d360-e2dc-4c6e-8546-e210eb430a2a-59` | CLI implementation read | `5c3ef68e6d1510f9e66498f21de2b4de3d5ddb8e38058754f766de5ab88cd050` |
| 847 | `call-8473e781-c0cc-40e7-977f-be47c58ec586-78` | Client implementation read | `23a667cab1241d954006a5688b1e06789232e89a92166c6d295995ea0a264da2` |
| 849 | `call-8473e781-c0cc-40e7-977f-be47c58ec586-79` | Broad package function search | `f66e20107ef4adeffb5b734b0c5aa457633daeb74012c602609e6564f883bb44` |
| 904 | `call-bb6e5277-9545-4773-981f-d13e52f47a25-81` | Client implementation read | `3c1f8659386e36ff74b9cb3c45fac9d3dc0d5315e5d2205265bbedcd0a0ee1c5` |
| 906 | `call-bb6e5277-9545-4773-981f-d13e52f47a25-82` | Client implementation search | `428233d951365946929643b4a059ef8feef460fe65c669aa1a9ae32eaf8574e6` |
| 927 | `call-54877399-7ad2-43e1-b60d-f5072931bd13-85` | Client implementation read | `5bb12198b5e5242a2211da12661c2b2895ce67511c7c6b3bc9da75b90af2102e` |
| 1645 | `call-54dfcb3e-f4fa-462b-9af9-5e2167ebeb9f-123` | React declaration read | `691392f90e0ba664718a277e81ca608af9706fd863e9dcf7985b7ea85d3bce3c` |
| 1672 | `call-6b55e902-bb4d-4e87-8c60-014d6a86f212-124` | Client implementation search | `f19aee4186359ba64191052a0da49d1316c864e49fd4f3c30f6c15c307d4dc82` |
| 1674 | `call-6b55e902-bb4d-4e87-8c60-014d6a86f212-125` | Client implementation read | `c97332932cd104d6446c7d57526f731f5f1798a6d3075924c95ac939887949f3` |

These are requested accesses; excluded results mean the audit does not prove successful delivery of every requested range. Dynamic paths, symlinks, subprocess internals, unlogged activity and transient edits remain outside a blanket negative finding. Raw streams and fixture-authentication script bodies should remain outside the selected public artifact archive; metadata and hashes suffice for these findings.

## Native export and teardown

Public line 2851 selects Node 24.18.0, invokes inherited `scripts/export-ios-hermes.mjs`, and copies its output to `dist/ios-hermes-m7/`. Both final bundle paths have identical **3,154,470 bytes**, SHA `514dec5638e2da5a453b37caaa72413ea2a7adfa69db077017f442dbbf93588e`, filename `entry-71432f226675a54956f6d5f02611ef4c.hbc`. Native evidence is **Hermes export only**; simulator/device execution was not run, as the final report states. The export follows the final PollMessage fix. A byte identity is not a claim that the entire bundle was copied into the selected benchmark archive.

Public line 2974 requests cleanup of six explicit current backend/Expo PIDs followed by checks; earlier line 2565 requests termination of three older Expo PIDs, and line 2611 another three. Those requested checks are not substituted for uninspected results. Parent retained read-only observations provide the later boundary:

- [Initial late helper](cell-custody-0.2.10/grok/m7-late-process-observation.json), SHA `cb690ff83a7e49fa4465cc00e55ac1494fe2fe45368b7ef831f276dfdb424bad`: **02:28:05.624392**, four selected PIDs absent and assigned-range listeners absent, before Muse starts.
- [Full report/runner PID observation](cell-custody-0.2.10/grok/m7-full-report-pid-observation.json), SHA `6564b8ea55e15d27a9bac9ad5e941988158dd8fd07b3676d0ea5a9eade860034`: **02:29:24.523385**, all 11 named report/runner IDs absent.
- [Additional cleanup IDs](cell-custody-0.2.10/grok/m7-additional-cleanup-pid-observation.json), SHA `6c9832f8c36ce807b4ed7e234bb8c9dd48f02a1415cb6280d0a78aad6f5e6348`: **02:31:55.738412**, IDs 76534 and 76697 from public line 2611 absent; they were omitted from the final report table.

The 13 explicit IDs across those sources are accounted for at these late observations. This is not a complete process inventory at 02:09:28, and the later PID-only observations make no shared-port vacancy claim while Muse is active. Neither this auditor nor the parent observation helpers sent cleanup signals. Preserve the received cleanup narrative, actual public requests, and these later absence observations as distinct evidence.
