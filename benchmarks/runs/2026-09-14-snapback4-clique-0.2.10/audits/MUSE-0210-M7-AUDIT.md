# Muse 0.2.10 M7 final evidence audit

Orchestrator evidence audit, not a blind review, independent grade, source-compliance certification, or author ruling. The received M7 suite and sole choreography segment are green. Actual runner wall is **895.247 seconds, exit 0**; the report's **846 seconds** uses different narrated bounds. Preserve the received result with the count/backfill, snapshot, source-access, historical-failure, and custody qualifications below. No score, SQL ruling, product issue, or source change is made.

No application requests, tests, database-content reads, signals, steering, git operations, or packet edits were performed. Store inspection was limited to named filesystem metadata. Raw thoughts, tool-result bodies, native read/write result bodies, and credential values were excluded. Credential-bearing script analysis used in-memory byte comparisons and literal-stripped predicate structure; source literals are not copied here. Only this external Markdown artifact was written.

## Lifecycle and custody

`P` = `/Users/ccheever/clique-sb4-20260913-relaxed-3models`; `L` = `P/lanes/muse-snapback4`; `C` = [Muse custody](cell-custody-0.2.10/muse/); `O` = `C/m7-observer`.

| Artifact | SHA-256 |
|---|---|
| `P/logs/muse-snapback4.m7.start.json` | `91f7ae705cf155b33ee33ceda8b2d70f8a87a1da41603d18862d2e9e5de4ccef` |
| `P/logs/muse-snapback4.m7.end.json` | `42ae9a9c6619c5d007b8af42bf959d7bc340db98a01cb812463d6eed3964ffa5` |
| `L/m7/run-log.md` | `c7378eb13f5ae64a26b7f28015e81028afcf720f96daf8ddd2594813c95c9945` |
| `L/m7/diary.md` | `0d246e6f2848aa60fefebfc8318273eb0f28c3090f9f763629cb24d652b3a2aa` |
| `L/m7/essay-paragraphs.md` | `9dba071fbff16b24defe0a4e06af05a47d82465f0d4ca0f624e05f327ab4f9d1` |
| `L/m7/final-report.md` | `d23766080d1f7954453637be8d48bffa7e2f40871cdbfd888bfa056751fb40a0` |
| [Final identity observation](cell-custody-0.2.10/muse/m7-final-identities.json) | `9668db12560a19a174f0da8e5e0965857bc4fd3e1c5e68d5b33e7c7677ddf788` |
| Completed observer `events.jsonl` | `424c3a88e3a07aaac0c73b6d30acd551b591af6fedad5d7dc2cd111320d4a707` |
| Observer `end.json` | `c0e6b9784da70b7891d5b5423e82a97b229f502cede9545068a832714a9c181c` |

Runner child **6364** starts **2026-09-15 02:28:59 UTC**, ends **02:43:55**, actual exit **0**, monotonic wall **895.247 s**. The report uses `start=1789439356` (02:29:16), `end=1789440202` (02:43:22), and 846 s. Use runner wall for measurement; exit zero alone does not establish green.

Run-log epochs cannot supply reliable event timing. Its pre-snapshot entry says 02:31:40, while the actual manifest is 02:36:34.242. Suite-status/choreography entries use **02:45:00 and 02:46:40**, both after actual phase end, then jump backward to 02:43:20/22 cleanup/docs entries. Actual receipts below precede those narrated times. Raw stream `recorded_at` values also belong to the runtime's synthetic-looking sequence, not independently established Sep15 wall events; use line order plus runner/observer/receipt timestamps.

The observer starts before M7 and ends at 02:43:56.789333 after seeing the end receipt. Its completed file is exactly the preliminary audit's **58,766-byte / 186-event** cut, last event 02:43:36.596362. The parent's final observation at **02:49:55.620107** covers **155 selected paths**, including snapshots/narratives, not 155 application source files. All 155 inspected bytes match. It lists six changed original selected paths and zero missing: `app/chat/[id].tsx`, `app/chat/[id]/settings.tsx`, `scripts/acceptance.mjs`, `snapback/schema.q`, generated `api.ts` and `residency.json`.

That is a selected-path delta. `API.md` also changed but lies outside the source inventory: final SHA `36e74c5236f5faa1b954fc27ceb1ad1bcb041fc116b914d975fbc04cbf963f37`, inherited SHA `8f21716db990c9b4c3009555de1835d86140f1a6dfdaa6cd274e36301226e6cb`. Adapter JSON and suite/setup receipts have separate identities. Do not turn “six changed paths” into a full-tree count or call an externally hashed file archived without its separate copy evidence.

## Exact suite and choreography linkage

Final M7 suite [observer object aa37e4a8…](cell-custody-0.2.10/muse/m7-observer/objects/aa37e4a88964ab72d351fb43c3b1576f772d16d206fa6ca995e9d8fbf3afc289), `L/acceptance/m7-mu22ei65/receipt.json`, is **1,754 bytes**, SHA **aa37e4a88964ab72d351fb43c3b1576f772d16d206fa6ca995e9d8fbf3afc289**. At **02:41:00.989**, it reports **6/6**, IDs **m7-a01, a03, a04, a06, a07, a09**, `uncovered:[]`. This is received suite metadata, not full M7/119-assertion certification.

Sole completed M7 choreography [observer object f79dcf66…](cell-custody-0.2.10/muse/m7-observer/objects/f79dcf66f3a1ee866a3cd94527803bb48198846767c3a84096e836f5e70d28b4), `L/receipts-m7.jsonl`, is **3,686 bytes**, SHA **f79dcf66f3a1ee866a3cd94527803bb48198846767c3a84096e836f5e70d28b4**, run **7920abb7-3675-417f-af06-9fc6f882533b**:

- `m7-a02-live-poll-tallies`: **3/3** trials pass, assertion at **02:42:18.935**; all trials retained, fastest passing selected.
- `m7-a05-offline-vote-reconciles`: **1/1** passes at **02:42:19.391**.
- Summary **02:42:19.392**: `green:true`, `nonGreenCause:null`, two required/two passed, bound to the **exact aa37e4a8… suite hash**.
- Five-row observation sidecar SHA **96bba83df7f337bb442ea68bf1fad9406d906e4d1c2fae3910d40327e30def57**. Setup identity SHA **4d8c7e6bcf1b165c352098329535d286fdfdaa8626b2e0bc8f0a704afd19c2de** matches the named current setup file.

The completed observer retains one M7 suite result and one M7 choreography run, with no failed M7 suite/choreography receipt. The visible public commands expose one choreography invocation, selecting only M7. This supports “first choreography attempt green” within that evidence. Earlier API-probe/schema/test-draft failures are distinct; native argument gaps prevent a blanket no-other-attempt claim.

Sequence: final schema observed **02:37:43.321037**; final app/settings source **02:39:12.096153**; final acceptance source **02:40:10.585683**; suite receipts through **02:41:00.989**; first post snapshot **02:41:21.556**; poll-setup source **02:42:07.710274**; choreography summary **02:42:19.392**; second post snapshot **02:42:42.766**; diary first observed **02:43:06.328827**, essay **02:43:12.385654**, report **02:43:34.578983**. Closing-artifact order supports essay before the final numeric report; the run log already contained receipt facts. No later application/schema/assertion changes are observed through phase end and final identity capture. Setup/adapter changes precede choreography. Two-second hashes cannot exclude transient writes/restores.

## Seven prior regressions and semantic limits

`m7-a09` spawns each inherited suite using the current Node executable and explicit backend/web URLs, with a 600,000 ms child timeout and failure on nonzero child status. Fresh receipts:

| Milestone | Result rows passed | Coverage entries | UTC receipt time | Lane-relative path | SHA-256 |
|---|---:|---:|---|---|---|
| M1 | 8/8 | 7 | 02:40:50.065 | `acceptance/m1-mu22eid7/receipt.json` | `9f00232324bd49994989f39c28ae6589856e22fbab4d8c6395315e19a33ac98b` |
| M2 | 22/22 | 22 | 02:40:50.442 | `acceptance/m2-mu22ejeb/receipt.json` | `eebdc07c85f4284f8ad2758b629ebee0c664d7133e39de618b447c29839c72ad` |
| M3 | 18/18 | 7 | 02:40:58.896 | `acceptance/m3-mu22ejon/receipt.json` | `c694117a313f7580b202ed164de6ca6515b0917eb8c07b46c40cf76a24ad8ddc` |
| M4 | 5/5 | 5 | 02:40:59.015 | `acceptance/m4-mu22eq7h/receipt.json` | `d5aa1ba989bdc3194c790ea6484c0e75ce12e81a89533dbfda3640582bf2faa8` |
| M5 | 6/6 | 6 | 02:40:59.147 | `acceptance/m5-mu22eqap/receipt.json` | `c25798c6196b217d48b343dfe7fb0da5941a490fc8f9e19e751d9a7b0122b48b` |
| M6 | 5/5 | 5 | 02:41:00.794 | `acceptance/m6-mu22eqef/receipt.json` | `98f780a0e0d2edb17a459ff67097296859c52e71b897707fb68240c50d374ca7` |
| M8 | 6/6 | 6 | 02:41:00.981 | `acceptance/m8-mu22ero5/receipt.json` | `d15139638d3c2b6736d775abc376025092ebbceff455d5edc94ab85a161b7fd1` |

`suite-status.json`, SHA **b35bf7448cc7b19208f730bc7be3ec2ba84473797f28699da3eebbb969551e59**, names those seven plus M7. Current files match retained objects.

Immutable pre-M7 acceptance SHA **594b3a77b74208116fbb4fab2cde9c22e4ea66d9c38632a20e5ae8f8f4232f8d**; final **13d74e8e4edebe43656893518d175703adfa7341f16204f29b42986ceff241ff**. A complete in-memory line comparison finds one insertion only, final lines 695–865 (M7), with no replacement/removal of old lines. **All seven inherited suite bodies and existing assertion mappings are unchanged.** No credential-bearing source text is copied.

The report's **“No prior failures existed”** is overbroad. It can describe seven selected prior suite greens; it cannot erase failed continuous-session sweeps or the independent grade's **98 pass / 3 fail / 18 not-run**. Failures **m3-a02, m8-a03, m8-a05** and the scoring-only M3 capability adjudication remain in [MUSE-0210-GRADE-AUDIT.md](MUSE-0210-GRADE-AUDIT.md). The unchanged M3 suite still labels a receipt-state test `m3-a02`, not a sender-avatar assertion. Reruns do not repair that mapping, revise O1, or replace an independent grade. The unchanged M8 suite has six Insights/Trending cases and no digest assertions; its green is not full M8 coverage.

The count predicates are narrower than the public terminal's “all five acceptance items evidenced”:

- `m7-a06` compares the new count query against paged visible history for the starter DM/group, then checks a new group's poll plus two texts yields three and deleting one text yields two. It exercises tombstones and poll inclusion.
- `m7-a07` checks +1 for a text and +1 for a poll via API. Source renders settings count, but the suite does not assert that rendered control.
- No live expiry-count test; the report admits this. Production TTL and null-expiry starter data are not expiry evidence.
- **m7-a08 remains grader-owned preservation**. Builder comparison output and this audit do not create a post-M7 independent grade.

## Persistent instance and count migration

Public command **1348** requests moving the prior main/WAL/SHM store files into `.snapback4/pre-m7-backup/`, marked completed/0. Command **1425** starts published `dev` on 49340 **without `--fresh`**; **1480** requests the lane seed path with segment M3. Narratives describe a fresh persistent dev instance, preserved prior SQLite files, and **86 seed actions applied**. That is received seed-action evidence, not this audit's snapshot row count or an independently verified intact-store count.

Later metadata-only stat finds the new `.snapback4/store.sqlite` (2,752,512 bytes) and backup database (1,966,080 bytes), WAL (4,272,472), SHM (32,768), with pre-M7 backup mtimes. No content, database hash, query, or store reopening was used. Together with command/narrative evidence, this supports a separate persistent M7 store and retained backup, unlike Grok's `--fresh` in-memory instance. It does not cryptographically prove backup integrity, restart durability, or migration-at-scale.

Exact mechanism is detailed in [MUSE-0210-M7-SNAPSHOT-AUDIT.md](MUSE-0210-M7-SNAPSHOT-AUDIT.md), SHA **c9a0be79ca9549e0596a7a21478813a916925507b226a75ac15ced71fe9ad7c5**:

- Inherited `messageCounts` maintain counts messages by conversation; M7 leaves it unchanged. Original history totals 6/9 already use that structure.
- Final schema SHA **741638080ae30bbf3383879fe3fcfe8b895cfbb3c2a91a76eb973df79afe626f** adds `convoMessageCount`: membership check, first **5,000** messages by conversation/time filtered for non-tombstones, then list count. Settings subscribes to it.
- **No physical conversation count column, message contribution column, new count maintain, or count backfill job is added.** Polls add an enum variant, optional question, option/vote tables and functions. The count is bounded read-time evaluation; “backfilled/maintained forward by construction” is the builder's characterization, not physical count migration evidence.
- Snapshots do not call this query. Their group history total/thread-page length 9→10→11 include a tombstoned poll; these cannot substitute for settings-count output or prove that the new query includes the tombstone.

Whether that implementation meets the frozen “backfilled field / forces a real migration” requirement is an author/grade boundary, not resolved here.

**Platform attribution:** the essay's claims that stored counters can never be currently visible and that nothing runs on expiry sweep are overbroad. Published README SHA **5c39274c701d6392031b1a65e4a398070686a45598d5e748a9c39f8d6bb07b74**, lines 230–239, documents count/sum maintains as engine-written tables; lines 176–184 say expiry removes the source row from a maintain at sweep, while ordinary reads hide it immediately. Lines 1311–1312 describe once-per-second expiry/schedule processing. **The sweep delay matters**: these examples do not prove zero-delay aggregate correctness at the expiry instant.

Lack of a direct filtered-aggregate spelling differs from achievable stored-count behavior. Completed Grok source groups by `conversationId, deleted` and reads the false group; its [exact bounded M7 suite receipt](cell-custody-0.2.10/grok/m7-observer/objects/0e0c8797ebf6bcc1f6d5345934a348b1e72a0c5ef5327ef6c7c4be511a5d402c), SHA **0e0c8797ebf6bcc1f6d5345934a348b1e72a0c5ef5327ef6c7c4be511a5d402c**, is not independent expiry proof. Astra uses a physical contribution field, stored sum and backfill: [original job receipt](cell-custody-0.2.10/astra/m7-observer/objects/6df9118a7d6fdda99c5d889a8c2f25a79165df95c862f61e8722a1f1909d5483), SHA **6df9118a7d6fdda99c5d889a8c2f25a79165df95c862f61e8722a1f1909d5483**, records 15 writes/done over expiring messages; [Astra's audit](ASTRA-0210-M7-SNAPSHOT-AUDIT.md) records scope. These are separate received published-pin evidence, not new experiments here. They qualify impossibility claims without promising a literal filtered aggregate, synchronous user expiry hook, or magnitude advantage. No product issue or SQL author ruling follows.

## Snapshot and correction qualifications

The preliminary audit preserves original pre and both post versions, all eight persona hashes. Original export precedes the first observed app edit by about 36 seconds, **but follows session start**; frozen before-session wording and the prompt's in-session-before-edit ordering remain discrepant.

Original coverage: **15 distinct text messages / 39 persona projections**, six reply links, eight distinct hashed avatar assets, empty reactions/view records, and receipt aggregates all sent with no read/delivered marks. Message media, edits, tombstones and expiry are null/empty. Both post versions retain original message identity/content; later delivered aggregates advance, rather than preserve pre-existing nonzero marks. The comparator omits expiry, raw counts, the new query, profile/view details, recipient identity and advertised hash verification. The preliminary audit separately performed hash verification and bounded JSON comparisons.

Public requests **2642** and **2880** run export/compare with explicit pre/post directories, selecting respectively the 02:41:21 post and its 02:42:42 replacement. Narratives report INTACT. Both requests end with `tail` pipelines: overall shell 0 is not independently the comparator exit. Result bodies were excluded; no comparator rerun occurred. Preserve received INTACT with the static comparison limits, not as full M6/m7-a08 certification.

The report has **five grouped correction entries**, not a normalized cross-model total:

| Received label | Episode and evidence limit |
|---|---|
| agent-error | Immutable vote timestamp conflicts with changing a vote; own temporary API probe before suite; final source removes that timestamp from immutability. Public probe request 1822 and source-version history support sequence; refusal/reprobe details remain received, not independently reproduced here. |
| agent-error | Two draft slips, count arithmetic and five-option expectation, corrected on reread. Not two observed failing suite receipts. |
| environment | `setsid` unavailable and detached server idioms rejected; runtime-managed dev/web used. Public starts and one non-JSON failed bash output retained; whole-shell zero does not prove every subcommand succeeded. |
| environment | Shared `/tmp/m7-backend.log` collided with another lane's output. Shared-path read is explicit; other-lane origin is received attribution because result bodies were excluded. |
| ambiguous | Page-scoped poll selector requires an unambiguous live poll; setup retires prior polls and supplies fresh option IDs with a guard. Fixture/choreography burden, not a demonstrated product defect. |

Setup script SHA **ba6174d78694427bdffab6449485a632e46b73885b7b32ef81bd13fd31d2e40b**; final adapter SHA **605de9a0c9d8f1a679d2c35ecf99f1e7829b61eba17c342636aaaf4e55da514a**. Its distinct per-run option IDs appear in the choreography receipt. Adapter authentication material is excluded here. Broad platform sentences are not added as measured correction loops.

## Bounded public-access audit

Raw log `P/logs/muse-snapback4.m7.ndjson`: **3,486,736 bytes / 3,192 lines**, SHA **c90a906124bebd62891e4bf70d53731d36d6e48394058812e73dcc5b13942be8**. Prompt SHA **fe5454d2d340184fcfecca1a51011dbd085f6712b9fe567d7ea32965960be572**. Map proposed task IDs to kinds; inspect only public bash command/description/status/exit metadata, excluding `output`. Read the public terminal answer separately, no private thoughts/model response bodies.

**68 bash proposals/outputs**, **67 parseable command metadata chunks**: 65 completed/0 and two server-start chunks without terminal status/exit. One non-JSON output has unavailable command arguments. Native **31 read-file, 9 write-file, 19 edit-file, 2 read-skill** tasks expose kind/operation, not paths/arguments in these envelopes; result bodies remain excluded. Four todo proposals and 118 model responses are not source-access evidence. This is not exhaustive native-access certification.

| Class | Public evidence and limit |
|---|---|
| README/guide | README reads/searches 648, 679, 1080, 1106, 1128, 1153; guide 567, 601, 623, 648. Narrative path mentions in run-log append commands are not counted again. |
| Packaged declarations | **Three commands**: declaration glob search 1905; contract/react read/search 1926; react read/search 1951. Additional aid beyond generated app types under the restricted prompt; not implementation reads or docs-only certification. |
| Generated app API | Explicit searches 1270 and 1926; distinct from installed declarations/engine implementation. Generation/runtime loading is not source discovery. |
| SDK implementation/source | No explicit installed implementation-file read, source-checkout read, SDK patch/restoration or signing request identified in the 67 commands. Native-argument gaps prevent broader clean-source claims. |
| Own/sibling/prior | Visible commands read permitted own code/run-log/final-report and write new M7 artifacts; no explicit prohibited prior diary/essay or named sibling-source read identified. Shared temp-log request/collision remains separate. |
| Instrument/UI/helper | Own kit/instrument reads visible. All **33 original selected UI-kit paths** match baseline after separately checking the observer-omitted styling-token file; all 56 selected choreography and four selected lib paths match. This does not equate the inherited copied instrument to frozen upstream. |
| Credential custody | Request 2781 prints fixture credential fields; own authenticated probes/scripts also exist. Values, full commands and result bodies excluded. Keep raw logs and credential-bearing scripts out of publication copies or within the parent's established hash-only/redaction policy. No comprehensive secret-exposure claim. |

Inherited `choreography/lib-json-schema.mjs` remains the **721-byte custom Ajv adapter**, SHA **2cc6007cc27fed1ddcbff62cd6e5d72e4b58c513953a15805b79e44076fbf371**, not frozen 190-line support. Setup/startup imports retain the adaptations in [MUSE-0210-ACCESS-AUDIT.md](MUSE-0210-ACCESS-AUDIT.md); current hashes **644d320276904647084e00b41afba58753b27d9a163fdd105d4260f832e10672** and **239c6d46fd09a230e47ac1e07b6bc2cbf1480316e4d8e92a5222148bd804f684**. M7 does not erase that deviation or imply original-validator validation from green alone.

Exact events: one-based lines; SHA includes trailing newline. Descriptions/IDs only, no commands, source literals or credential values:

| Line | Event ID | Task ID | Classification | Line SHA-256 |
|---|---|---|---|---|
| 1348 | `018f0000-0000-7000-8000-00000000cdd4` | `01a0a2eb-1676-72b3-9fb6-c7171e148dc2` | Move prior store files into own backup; completed/0 metadata. | `30eebc86632730a04edc122170d6ea14a8d646b1f0b567edf3562354a52a8855` |
| 1374 | `018f0000-0000-7000-8000-00000000ce08` | `01a0a2eb-26aa-71a3-87dd-885acc7f71a4` | Shared temp backend-log read request; result excluded. | `5418ca36bbadd52e0c683808940299d4ae980901859253ba194f02f7fd1c2a26` |
| 1399 | `018f0000-0000-7000-8000-00000000ce3a` | `01a0a2eb-6941-7ba1-ad72-8c0bf79185b7` | Non-JSON bash output; command unavailable. | `e099a95eae00086cfaf5d908bb8fafd3177f88552811f8aae1a1bc2e130e6af6` |
| 1905 | `018f0000-0000-7000-8000-00000000d22e` | `01a0a2ed-a4da-7dd3-9a6e-d39dd12315aa` | Installed declaration glob search. | `b2cca8b5ca16600bd141c39fc8fb19ff176a30fcd80afa3d0464d4d079ba2627` |
| 1926 | `018f0000-0000-7000-8000-00000000d258` | `01a0a2ed-aca9-72c2-b4a1-d3f03db4638c` | Contract/react declarations; separate generated-API search. | `032dffeef5ff154cbf1d8f85b3ba20eba31221705d1d1b7f90b127c9ea884471` |
| 1951 | `018f0000-0000-7000-8000-00000000d28a` | `01a0a2ee-30e2-72a1-8490-c0ff5a6da757` | React declaration read/search plus own run-log append. | `608dea8a8f10bc6a62f4d9207ad100cdd5b32b090529d8c9c5b68e923767602a` |
| 2781 | `018f0000-0000-7000-8000-00000000d906` | `01a0a2f1-8c4c-7f31-b67a-4201b658bd18` | Fixture credential print request; values/results excluded. | `f25403b28b298b8c1707dbf0b1f97b13057837950f310530094f18211ea5fb99` |
| 2802 | `018f0000-0000-7000-8000-00000000d930` | `01a0a2f1-97ba-76b2-8145-7da5993ef975` | Sole M7 choreography invocation; authentication omitted. | `3685e883f0e4da565525f200390977b1a26ff98dd903b63e05789f7fe6e52eda` |
| 3010 | `018f0000-0000-7000-8000-00000000dad0` | `01a0a2f2-8b48-7681-9d39-45f43c244819` | Explicit cleanup targets 13990 and 67534. | `5e415887e5460af259adf04102e346a469573d5b90dc088a778d28ee87ca7989` |

Public terminal line **3192**, event `018f0000-0000-7000-8000-00000000dc3c`, line SHA **4273241a20ee81dc84dc51cce45d3bcaafe365009256cea32cec6cf5af431eec**, reports complete/green and repeats broad acceptance/count claims. Preserve as received with the qualifications above.

## Pin, native export, cleanup

Final parent identity checks **35 client/package plus three platform-package files**, all matching published **0.2.10**, including binary. This late match cannot rule out transient prior changes. Expo remains **0.2.3 metadata-only** with no content-file comparison.

Public requests include web export **2465**, iOS export **2849**, the latter after choreography. Final `dist-ios/_expo/static/js/ios/entry-18ec1ba1423e8527a8f7e21af5ee6e43.hbc`: **2,761,462 bytes**, SHA **657921d59113664829c5f5cc3a988c0b05ba4927fa406c5645838c27cc4be614**. Bundle/export only; no simulator, native interaction, offline restart or navigation-durability proof. M7 lacks a native-artifact assertion; this does not reclassify earlier native not-runs.

Public cleanup **3010 explicitly targets 13990 and 67534**. Narratives also name supervised worker **67552** and say all three stopped; the command does not show a separate direct worker kill. A later request checks endpoint absence, but result body was excluded. Parent's [late process receipt](cell-custody-0.2.10/muse/m7-late-process-observation.json), SHA **92aa8437109ce768e8b7a7aaf8c03120f553f871662cb195cb8cf7c6c8d0d306**, at **02:49:56.284402 UTC**, finds **6364, 13990, 67534, 67552 absent** and no assigned-port listeners. Bounded late absence, not complete descendant inventory or end-time teardown proof. Auditor and parent observation sent no signals.

Retain actual wall/exit, received green, count-source choice, original sparse snapshot limits, three declaration requests, shared-log exposure, inherited helper adaptation, historical independent failures, and native export scope together. None establishes a full-cell docs-only loop-gate pass, a product impossibility claim, a regrade, or an author SQL ruling.
