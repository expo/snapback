# Astra 0.2.10 builder: source-discovery access audit

**Finding:** No explicit prohibited Snapback implementation/source content read, source-checkout access, or prior-run access was observed in **307 public command starts**. No explicit published `.d.ts` read was observed. The one installed implementation `.js` path was execution of the CLI shim with Node and `--help`, not a content read. Direct inspection of the lane's SQLite store is disclosed separately below.

This is an evidence audit of the completed Astra continuous builder, not an independent review, grade, full prompt-compliance judgment, or author ruling. Only this Markdown file and [its JSON receipt](./ASTRA-0210-ACCESS-AUDIT.json) were written. The frozen packet, other lanes, worktrees, source, git state, and rulings were not changed.

## Scope and method

Packet: `/Users/ccheever/clique-sb4-20260913-relaxed-3models`.
Builder: `gpt-6-astra`, medium, `snapback4@0.2.10` / `snapback4-expo@0.2.3`.
Runner PID 51228; started **2026-09-14 11:15:05 UTC**; ended **13:28:43 UTC**, actual exit **0**, monotonic wall **8,018.002 s**. Those facts are retained lifecycle metadata, not a claim of milestone success.

The supplied prompt excludes sibling lanes, Snapback/Exact source checkouts, any Snapback source, and prior Clique/Coterie implementations or records. It names installed package README, CLI guide/diagnostics, and generated `snapback/generated/api.ts` as the discovery surface. It separately requires use of the frozen instrument and installed runtime packages.

The audit follows the [0.2.6 public-source-access method](/Users/ccheever/projects/snapback-relaxed-record/benchmarks/runs/2026-09-13-snapback4-clique-0004/source-access-audit.json): inspect `item.started` events whose `item.type` is `command_execution`, using only public `item.command` arguments. All 307 arguments were screened for content-read/search operations, explicit package/checkout/prior-run paths, declarations, broad/path-building searches, and metadata/runtime use; candidate cases were resolved by their command semantics. Command result/output bodies, agent-message bodies, private reasoning, and other lanes were excluded. No complete multi-command argument or credential appears in either audit file.

The log parses as 676 JSON lines with zero parse errors: one `thread.started`, one `turn.started`, 307 `item.started`, 366 `item.completed`, and one `turn.completed`. The receipt indexes **every inspected command start** by event/item identity and exact line SHA-256, and gives detailed references for the boundary cases. Line hashes include the line terminator. Source log and prompt hashes remained unchanged at the end of the audit.

## Custody

All relative paths below are in the packet. These raw files remain outside this audit; only their identities are retained.

| File | Bytes | Lines | SHA-256 |
| --- | ---: | ---: | --- |
| `logs/astra-snapback4.ndjson` | 1,856,863 | 676 | `71685b871f90e555583f35881604e238659c1f95ac861bb3a621222787efbf71` |
| `prompts/astra-snapback4.md` | 6,182 | 31 | `606d8e2903e35aa3387589c023ccd2a73bd699680fdfc89c221e72408a84033d` |
| `logs/astra-snapback4.start.json` | 1,128 | 36 | `0bddde7642aab92f1945ca242a502b120da312cfd14badb6c8baa88480849016` |
| `logs/astra-snapback4.end.json` | 373 | 11 | `dcb4002cfae0c4899609576303799fa7e8cea1f192ec33aba281a5df321c8177` |

## Classification

| Category | Observed argument-level finding |
| --- | --- |
| Implementation/source content | **0** explicit reads/searches of installed Snapback implementation `.js`/`.ts` or source checkouts. |
| Published declarations | **0** explicit `.d.ts` reads/searches. These would have been recorded separately, since the prompt specifically names generated API types. |
| Package README | **19 command events** request content reads/searches of the installed README. One of those also requests the `snapback4-expo` README. The JSON lists all event references. A README path only mentioned in a written log line is excluded from this count. |
| Generated API | **5 content-read/search events**, lines 59, 133, 234, 467 and 469, targeting the lane's `snapback/generated/api.ts`. Imports of generated API in written code are separate runtime/source references. |
| Guide and diagnostics | Public CLI use, including guide execution at line 39 and repeated guide/why/check operations; these are executable interface use, not implementation inspection. This audit does not certify that every requested lookup succeeded or that the full README was actually consumed. |
| Package metadata and listings | Package JSON, platform-binary directory and shim-link listings, file/xattr metadata, binary SHA-256, lockfile integrity and installed-version listing. The receipt supplies examples with event hashes. No implementation `.js`/`.ts` filename enumeration was observed. |
| Installed `.js` execution | Line 41 executes `node_modules/snapback4/bin/snapback4.js` with Node and `--help`. This is the sole command containing an explicit installed Snapback implementation `.js`/`.ts` pathname. It is not a source-content read/search. |
| Runtime asset | Line 62 copies `node_modules/snapback4/dist/wasm/snapback4_device_bg.wasm` into the lane's public directory. Copying runtime bytes is not implementation discovery. |
| Mere path references and imports | Written app/worker code imports installed package arms; some command arguments write report/log references. Normal runtime imports and written path mentions are not content inspection merely because an implementation supplies them. |
| Own generated schema | Line 241 inspects the application's compiled `/schema` metadata and a lane evidence file. This is generated application state, not the installed product's source. |
| Own store internals | Lines **417, 420 and 422** directly inspect the lane's `.snapback4/store.sqlite`: table names, the `r` table schema/sample row, and `_catalog` schema/sample rows. This is distinct from the prompt's enumerated README/guide/generated-API discovery examples. It exposes engine data layout but is not implementation source under the anchor classification. It remains visible as an additional boundary, without a separate grade/compliance adjudication. |

The command at line 427 also writes a scale verifier using the lane store; line 501 changes that verifier to the published `sql` CLI; line 503 writes a probe-clone path that copies the lane store. These are application-data inspection and code edits. They do not establish installed-source inspection, and this audit does not inspect their results or certify their runtime behavior.

## Event references for potentially misleading matches and boundary accesses

Every row is an `item.started` / `command_execution` event. No raw shell command, SQL argument, or row value is reproduced.

| Log line | Item ID | Classification | Exact line SHA-256 |
| ---: | --- | --- | --- |
| 41 | `item_23` | CLI shim execution plus binary metadata | `044aae100a1cf26d33f38f85f56983e9214f5d7ae627e9df1a93252bb77b2b71` |
| 57 | `item_29` | README path mentioned in a written knowledge log; not a README read | `29d73d28352254dd5e0ad3d74281010feb8df7842d4fdf2ad56a72db5546a776` |
| 62 | `item_32` | WASM asset copy; written client imports | `265c8e2b0760d98054414e5d4ac0e4fd0c7906be782e46ed4fe26a49117a9f88` |
| 241 | `item_128` | Own generated schema metadata | `321d6160c403343360417e9263687095b44c55e8fb7acca5dddfbd8f725300f9` |
| 417 | `item_225` | Own SQLite store table-name listing | `9f490e333a3b45a0f4f564c9d9638065de3a9ee83dca2b20d49c49d242bcb320` |
| 420 | `item_227` | Own store `r` schema/sample inspection | `c4d322cf42f5a597d63ad58be8048b7fe47dbcf0a4bcaf6fb73c00a8d51a8141` |
| 422 | `item_228` | Own store `_catalog` schema/sample inspection | `cb8a2ab6e294842b995db58a222abf63afaf2d738e29df71dfb63e0c92abc642` |

## Limits for comparison use

This is evidence of **explicit public command arguments**, not a blanket clean-source certification. It does not establish accesses through dynamically built paths, helper scripts, subprocess internals, symlink targets, excluded outputs, private reasoning, or unlogged activity. Individual commands may contain conditional operations; their requested read does not establish successful content delivery because result bodies and per-command outcomes were excluded.

The anchor's Astra row observed no prohibited source read in 393 command starts; this row observes none in 307. Those counts describe audit scope, not a productivity metric. Keep the direct-store boundary and access-method limitations with the result. This audit does not change builder results, independent grades, technical defect attribution, or any author decision.
