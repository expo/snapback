# Panel: LLP 1012 — Local-first v1 (Gemini 3.8 Flash (High), via Antigravity CLI — two samples)

**Reviewed:** `llp/1012-local-first-v1.spec.md` as landed at `9ffdf6dd0`, in a read-only capsule exported from that commit, with the engine, wire, client, evaluator, compiler, templates, the design RFCs it implements, the brief, and the rules.
**Family:** Gemini 3.8 Flash (High), via Antigravity CLI — two samples
**Provider/runtime:** Antigravity CLI (`agy --print --dangerously-skip-permissions`); sample A ran with the CLI's default model at `--effort high` (the author asked for "antigravity" as its own panelist), sample B with `--model gemini-3.8-flash-high`; both self-reported as Gemini 3.8 Flash (high reasoning effort), so they are two independent samples of one model, not two families
**Date:** 2026-09-04
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1012-local-first-v1.panel.brief.md`. Each sample wrote its own file and printed it. They are recorded as dated sections of one artifact, per the LLP 0005 rule that re-reviews by one family get a section, never a second file. The orchestrating session authored LLP 1012 and is not a reviewer; it verified every engine claim below against the tree before the synthesis (`1012-local-first-v1.panel.synthesis.md`).

---

## Sample A — Antigravity default model (verbatim)

Reviewer: Gemini 3.8 Flash (high reasoning effort) · Date: 2026-09-04 · Method: blind round-1, read-only capsule at 9ffdf6dd0

# Review: LLP 1012 — Local-first v1

## 1. Verdict

**NOT READY**

LLP 1012 establishes a disciplined, coherent architectural direction that honors the "not a replica" design principle and author rulings. However, it cannot be implemented as currently specified due to three blocking findings: (1) range queries in the engine do not emit absences for deleted or expired rows, which causes the `delivered-history` retention policy to preserve deleted and disappearing messages indefinitely; (2) the server wire protocol and owner execution pipeline have no mechanism to accept client-pinned ID blocks for mutation replay; and (3) the `POST /api/resume` contract is unbounded and risks stalling the single-threaded owner.

---

## 2. Blocking findings

### 1. Range scans cannot prove row absences; `delivered-history` preserves deleted and expired messages forever

- **Claim in spec (§5, lines 270, 275–278, and line 286):**
  > "| `delivered-history` | rows not in the fresh result are evicted **only on a receipt absence**; a row merely missing from the result is kept as history |"
  > "The one semantic the engine-core review must check: `delivered-history` depends on the receipt distinguishing *absent* (no row exists there) from *hidden* (a row exists the viewer may not see)... If a hidden row cannot be told from a deleted one in some receipt shape, `delivered-history` keeps it — keeping is the policy's whole point..."
  > "an expired message is an absence on the next resume of every range that held it"
- **Evidence (`path:line`):**
  `snapback2/crates/snapback2-core/src/engine/runner.rs:686-688`, `runner.rs:895-902`, `runner.rs:987-1008`, and `snapback2/crates/snapback2-core/src/engine/runner_ops.rs:818-822`.
  In `runner.rs:686-688` and `runner_ops.rs:818-822`, `receipt.absences` is strictly populated for failed point reads and point `Exists` probes where a row does not physically exist in SQLite. In contrast, during a range scan (`runner.rs:987-1008`), the engine emits a `ReceiptRange` carrying only `row_ids: returned_ids` and `absence: returned.is_empty()`. It does **not** trace individual row absences for rows that previously fell within the range bounds, nor does it record absences for hidden candidates (in fact, `runner.rs:898-900` explicitly truncates `receipt.absences` if a hidden candidate was probed).
- **Why it blocks:**
  In a messenger, messages are retrieved through range scans over the delivery log or thread history (`deliveries[viewer]...` or `messages[conversationId]...`). When a message is deleted on the server or expires under disappearing messages, the subsequent range scan simply omits that row from `returned_ids`. Because no point read occurred, the server emits no entry in `receipt.absences`. Under §5's rule ("rows not in the fresh result are evicted *only on a receipt absence*; a row merely missing from the result is kept as history"), the client interprets the missing row as historical content and keeps it held. Consequently, deleted messages are never deleted on the client, and disappearing messages never disappear, directly violating `benchmarks/briefs/social-messenger.md` M5 acceptance 1 and M6 acceptance 1.
- **What would resolve it:**
  Either:
  1. For `delivered-history` tables, model deletions, expiries, and revocations as explicit application-level log records or tombstones (e.g. `deliveries` row with `kind: 'delete'`, as already sketched in §3), and define client eviction as reacting to the delete log row rather than relying on receipt absences; or
  2. Specify that within a certified-uniform range that halted with `StopReason::Exhausted` over an index prefix, any previously held row whose index key falls within the scanned range bounds `[after, stop]` and is missing from `row_ids` is treated as deleted and evicted.

### 2. Pinned ID replay hook does not exist on the wire or owner

- **Claim in spec (§7, lines 342–344):**
  > "on replay the server applies the intent with its pinned ids through the hook LLP 1001 §8 already names ('deterministic replay contexts may inject their pinned ids directly'), refusing an id outside the session's block."
- **Evidence (`path:line`):**
  `snapback2/crates/snapback2/src/writer_auth.rs:152-156`, `snapback2/crates/snapback2/src/writer.rs:452`, and `snapback2/crates/snapback2/src/serve.rs:402-412`.
  While `Context.new_ids` exists in `snapback2-core/src/engine/mod.rs:23` for deterministic unit test fixtures (`runner_ops_tests.rs:38`), the live server does not expose it. In `writer_auth.rs:152-156`, `mutation_context` unconditionally executes `context.new_ids = self.runtime_mut().reserve_new_ids()?`. In `serve.rs:402-412`, `POST /api/mutation` parses only `op` and `args`, dispatching `Action::Execute`, which has no field or plumbing for client-provided IDs. There is no wire schema, session ID block ledger, or server-side validator in `snapback2`.
- **Why it blocks:**
  Lane O1 cannot implement pinned-id replay, and Lane O2 cannot flush queued offline inserts, because there is no API or owner mechanism to accept pinned IDs. If a client submits a mutation with pinned IDs today, the server ignores them, allocates fresh server IDs, and causes subsequent dependent intents (which reference the client-minted ID) to fail with foreign key or missing row errors.
- **What would resolve it:**
  Define the wire protocol for pinned-id replay in Lane O1:
  1. Update `POST /api/mutation` (or a dedicated replay endpoint) to accept `pinnedIds: string[]` and `sessionToken: string`.
  2. Implement an in-memory or durable session block registry in the owner (`writer.rs`) allocating `[start_seq, end_seq]`.
  3. Update `writer_auth.rs` to validate that all `pinnedIds` fall within the caller's allocated block before populating `Context.new_ids`.

### 3. Unbounded `POST /api/resume` threatens the single-threaded owner and lacks schema binding

- **Claim in spec (§8, lines 380–388):**
  > `POST /api/resume`
  > `{ epoch, held: [{ op, args, seq, digest }], want: 'receipt' }`
  > "The server re-executes every held `(op, args)` in **one read transaction** at one `seq` — it must, because re-authorization is what revocation means — and for each returns either `unchanged` when the fresh delivery's digest equals the client's..."
- **Evidence (`path:line`):**
  `snapback2/crates/snapback2/src/writer.rs:70-82`, `writer.rs:338-340`, `writer.rs:452`, and `snapback2/crates/snapback2-core/src/registry.rs:497`.
  All requests entering `snapback2` are serialized across an `mpsc::channel` into a single thread (`snapback2-writer`). `Runtime::execute` takes `&mut self` and executes inside a dedicated SQLite transaction (`snapback2-core/src/engine/mod.rs:734`).
- **Why it blocks:**
  1. The spec places no limit on `held.len()`. A client with fifty conversations and scrolled history could easily submit 100–200 held queries. Executing 200 queries sequentially in one request monopolizes the single writer thread for hundreds of milliseconds, starving all concurrent writes, subscriptions, and HTTP requests across the entire server.
  2. The request shape lacks a `schemaHash` or `generation` identifier. If the server underwent a schema migration while the client was offline, predecessor receipts and digests cannot be verified against the successor schema (`snapback2-core/src/client.rs:165-170`), leading to invalid comparisons or runtime panics.
  3. The response matches ranges by echoing `(op, args)`, which is fragile and expensive when argument objects have non-deterministic key ordering.
- **What would resolve it:**
  1. Impose an explicit ceiling on `held` (e.g. `maxResumeRanges = 32`); if exceeded, require batching or return `E_BOUND`.
  2. Add `schemaHash: string` to the request envelope; if mismatched, refuse with `E_SUCCESSOR_POLICY` or return all ranges as changed.
  3. Assign each held item a client-side integer tag `id: number` and echo `id` in the response for direct, efficient array indexing.

---

## 3. Material findings

### 1. Full closure receipts duplicate data and bloat the SSE wire
- **Claim in spec (§8, lines 402–405):**
  > `POST /api/query` and `GET /api/subscribe` gain `receipt=1`; when present, every response and frame carries the closure receipt beside `data`.
- **Evidence (`path:line`):**
  `snapback2/crates/snapback2-core/src/engine/mod.rs:88-92`, `223-232`.
  `ClosureReceipt` contains `rows: Vec<RowRecord>`, where each record has `{ table: String, id: String, row: Value }`.
- **Why it matters:**
  For any query returning 50–200 rows, every row value is serialized twice: once in the query result `data`, and once in `receipt.rows` (in addition to `row_ids` in `ReceiptRange` and potential copies in `halo`). Over an active SSE connection where live subscriptions deliver updates on every commit, sending redundant row payloads on every frame needlessly doubles wire bandwidth.
- **Resolution:**
  When `receipt=1` is requested, omit `receipt.rows` on the wire if the client can reconstruct row records from `data` and the schema, or return only the normalized row records and let the client project `data`.

### 2. The delivery-log recipe in §3 does not cover required messenger screens
- **Claim in spec (§3, lines 168–173):**
  > "One subscription, one long range, drains everything the viewer is owed, and the app opens any chat from held rows."
- **Evidence (`path:line`):**
  `benchmarks/briefs/social-messenger.md:575-592` (M5 chat customizations, backgrounds, people search) and `snapback2/packages/snapback2/templates/chat/snapback/schema.q:19-57`.
- **Why it matters:**
  The `deliveries` table in §3 links only `recipient`, `conversationId`, `messageId`, `kind`, and `at`. The `inbox` query joins only `messages[.messageId]`. It does not retrieve or hold:
  - `conversations` metadata (title, admin, accent color, background image upload from M5);
  - `memberships` (group participant lists and roles);
  - `profiles` (sender display names, handles, avatars);
  - `reactions` (message reactions from M6).
  In Lane O2 (stored-answer replay), an offline client opening a thread has no held answer for conversation metadata or sender profiles unless separate queries were run and held.
- **Resolution:**
  Update §3 to state explicitly that the delivery log is for message timeline ordering, and publish companion recipes/queries for holding conversation metadata and user profiles. Add `'reaction'` to the `deliveries.kind` enum or specify the reactions sync query.

### 3. FIFO outbox independent settlement causes orphaned dependent writes
- **Claim in spec (§7, lines 349–353):**
  > "A rejection settles that intent only; the drain continues."
- **Evidence (`path:line`):**
  `snapback2/packages/snapback2/templates/chat/snapback/messages.q:15-18`, `snapback2/crates/snapback2-core/src/engine/mod.rs:250-255`.
- **Why it matters:**
  If a user creates a group chat offline (Intent 1) and sends a message to it (Intent 2), and Intent 1 is rejected by the server (e.g. title too long, or permission check), independent settlement causes the client to proceed to Intent 2. Intent 2 attempts to insert a message into a non-existent conversation and fails with a confusing `NOT_MEMBER` or foreign key error. Similarly, an edit or deletion following an offline insert will produce incomprehensible failure states if the initial insert failed.
- **Resolution:**
  Introduce dependency tracking in the outbox: if Intent B references an ID minted by Intent A, and Intent A is rejected, Intent B should automatically transition to `rejected` locally with `reason: 'dependency-rejected'` without being sent over the wire.

### 4. Cold process-kill witness does not test mid-swap crash recovery
- **Claim in spec (§4, lines 247–248; §10, lines 431–436):**
  > "A crash mid-swap leaves the previous generation intact, which the kill witness (§10) asserts."
  > "2. Stop the backend. **Kill the process** (browser tab discarded; simulator app terminated), not `close()'."
- **Evidence (`path:line`):**
  `issues/20260806-expo-file-carrier-process-kill-witness.md:42-58`.
- **Why it matters:**
  Step 2 of the witness kills the app process *after* draining the log and viewing chats—when the carrier is idle and quiescent. It never kills the process during an active `RangeStore.swap()` or outbox enqueue transaction. This tests clean restart from a committed state, but completely fails to verify whether a mid-swap crash corrupts carrier state or leaves orphaned predicted rows.
- **Resolution:**
  Add a specific test harness hook in the Node/simulator runner that injects a process exit or worker abort midway through a multi-table `RangeStore.swap()` call, asserting that on relaunch the store cleanly reflects the prior generation.

### 5. View-once local invalidation missing for offline cold start
- **Claim in spec (§9, lines 415–418; §10, lines 438–439):**
  > "The asset client caches the bytes it actually fetched... under the owning row's lease: when a row leaves the store for any reason in §5... its bytes go in the same swap."
  > "M6 acceptance 1: a previously viewed view-once photo does **not** render."
- **Evidence (`path:line`):**
  `benchmarks/briefs/social-messenger.md:571-574`, `651-653`.
- **Why it matters:**
  Under §9, asset bytes are deleted only when the owning row leaves the store upon server resume. If a user cold-starts offline, opens and views a view-once photo while offline, closes it, and cold-restarts offline again, the backend was never contacted to revoke the row. The local store still holds the row, and the asset cache still holds the bytes. The photo would render again, violating M6 acceptance 1.
- **Resolution:**
  Specify a client-side view-once lease tombstone: viewing a view-once asset locally must immediately evict the bytes from `ByteCache` and record a durable local tombstone preventing re-render even while offline.

---

## 4. Minor findings

1. **Unimplemented Quarry syntax:** In §3 line 184, `retain delivered-history` is shown in `table deliveries:`. As noted in §1 line 78, Quarry v0.3 has no `retain` keyword; the compiler will reject it with a parse error until Lane O1 lands.
2. **Diagnostic family placement:** §8 places `E_RETAIN_POLICY` in the `offline` family. However, schema definition errors in `.q` files belong to the `schema` or `quarry` family (`snapback2/packages/snapback2/guide/families.source.json:15`).
3. **Inconsistent client option naming:** In §5 line 290 and §9 line 419, the spec introduces `fence: { days: 7 }` (a nested object) alongside `maxAssetBytes: 256 * 1024 * 1024` (a flat scalar). Normalizing to `maxOfflineDays: 7` or grouping them under `offline: { fenceDays: 7, maxAssetBytes: ... }` would be cleaner and more ergonomic.
4. **Name collision on `Generation`:** In §4 line 223, `RangeStore.swap(gen: Generation)` reuses the identifier `Generation`, which already represents the compiled schema/program generation in `snapback2-core/src/registry.rs:25`. It should be renamed to `StoreGeneration` or `RangeSnapshot`.
5. **Coupling `ByteCache` to `RangeStore`:** In §4 lines 227–228, `RangeStore` exposes `assets: ByteCache`. Byte caching is an asset client concern (LLP 1006 §9b, Lane O4). Nesting it inside `RangeStore` couples Lane O2 to Lane O4 prematurely.

---

## 5. Answers to the eleven questions

### 1. Absent versus hidden (§5)
For point reads, the engine distinguishes absent from hidden rows: in `snapback2/crates/snapback2-core/src/engine/runner.rs:686-688`, a non-existent row records a physical absence in `receipt.absences`, whereas a hidden row returns `Value::Null` without recording an absence (`runner.rs:674-676`). For rows inside a range scan, however, the receipt does **not** distinguish deleted rows from hidden or unreturned rows: `ReceiptRange` (`runner.rs:987-1008`) records only `row_ids: returned_ids` and `absence: returned.is_empty()`, and candidate probe absences are explicitly truncated (`runner.rs:898-900`). In a messenger, deleting a message or letting a disappearing message expire simply omits it from the fresh range scan without generating an absence in `receipt.absences`. Under §5's rule, the client treats the missing row as historical content and keeps it held indefinitely. The right design is to handle message revocations and deletions via explicit application log entries (`kind: 'delete'`) or by treating range exhaustion over an index prefix as proving the non-existence of missing intermediate keys.

### 2. The resume protocol (§8)
Re-executing every held `(op, args)` in one read transaction is neither bounded nor honest against the owner's threading model. All operations in `snapback2` are dispatched via an `mpsc` queue to a single worker thread (`snapback2/crates/snapback2/src/writer.rs:70-82, 338-340`). For an inbox with fifty conversations and two hundred held pages, executing 200 separate query programs sequentially would freeze the writer thread for hundreds of milliseconds, blocking all concurrent mutations and live subscriptions. Furthermore, the request shape lacks a `schemaHash` (vital for detecting schema migrations) and client correlation IDs (making range matching via serialized `(op, args)` brittle). The protocol must cap resume ranges per request, include schema versioning, and leverage the §3 delivery-log architecture so that an inbox only needs to resume a single primary range.

### 3. Ids (§7)
The claimed hook does not exist in code for live replayed client intents. While `Context.new_ids` exists in `snapback2-core/src/engine/mod.rs:23` and is used in test fixtures (`runner_ops_tests.rs:38`), `writer_auth.rs:152-156` unconditionally overrides `context.new_ids` with `reserve_new_ids()` from the server store, and `POST /api/mutation` (`serve.rs:402-412`) accepts no ID arguments. When an offline session exhausts its ID block, any further mutation that calls `insert` fails with `E_ID_BLOCK` until network connectivity is restored. When a device is wiped or signed out, unused session IDs become harmless gaps in the server's sequence, and any un-replayed intents are erased (`client.ts:137-142`). When two devices of the same principal race, their disjoint session ID blocks prevent primary key collisions; however, conflicting edits to existing rows fail cleanly via OCC rejections on the second device to replay.

### 4. The receipt on the wire (§8, `receipt=1`)
`ClosureReceipt` (`snapback2/crates/snapback2-core/src/engine/mod.rs:223-232`) derives `Serialize, Deserialize` and is serializable as-is. It carries `schema_hash` but lacks an explicit `seq` or `generation` field, relying on the outer `Execution` envelope (`mod.rs:236-244`). However, it is **not** small enough to ship on every frame of a high-frequency SSE subscription because `receipt.rows` contains complete copies of all returned row records (`RowRecord { table, id, row }`, `mod.rs:88-92`), duplicating the entire `data` payload. To make it wire-efficient, `receipt.rows` should be omitted when it mirrors `data`, and only range boundaries, absence keys, and verdicts should be sent alongside a receipt-level `seq`.

### 5. The delivery-log recipe (§3)
The recipe does not compile under Quarry v0.3 because `retain` is not yet a recognized keyword in `packages/compiler/src/quarry/`. The fan-out `for` loop (`first 50`) produces 51 writes (1 message + 50 deliveries), which easily fits within the default ceiling of 2,048 `write_rows` (`certificate.rs:41`), though it statically limits group sizes to 50 members. One range does **not** cover all messenger screens required by M5–M6: it omits conversation customization and settings (`conversations`), group member administration (`memberships`), user profiles and avatars (`profiles`), and emoji reactions (`reactions`). In Lane O2 stored-answer replay, thread views and chat settings cannot be opened offline from the inbox range alone. Finally, while a per-viewer delivery log avoids building relational CDC replication into the database engine, it is effectively an event-sourcing replication log constructed at the application layer.

### 6. The outbox and prediction (§7)
The `queued → committed | rejected | expired` state machine with a `predicted` boolean flag is minimal, correct, and sufficient. The "same carrier transaction" claim is achievable in IndexedDB because `IDBDatabase.transaction()` supports atomic multi-store transactions across an array of store names (e.g. `['outbox', 'rows', 'ranges']`), provided all operations are enqueued without waiting on external microtask ticks. However, FIFO with independent settlement breaks down on dependent writes: if an initial write (e.g. creating a conversation or posting a message) is rejected by the server, subsequent dependent writes (e.g. sending to that conversation or editing the message) still execute and fail with confusing foreign key or missing-row errors (`NOT_MEMBER`/`NOT_FOUND`). Dependent intents must abort locally if their parent write fails.

### 7. The fence (§5)
Nothing in the runtime or certificate assumes the older "store untrusted past the fence" reading; existing fences in `snapback2` pertain strictly to session epoch invalidation (`writer_auth.rs:207`) and client async operation ordering (`client.ts:323`). The server does not need the client's fence setting for any operation: client fences govern local prediction suppression and stale badges, whereas the server unconditionally enforces its own 30-day intent expiration limit (`E_INTENT_EXPIRED`) based on `issuedAt`.

### 8. Spellings
The schema spelling `retain until-revoked | delivered-history` is clean, declarative, and consistent with Quarry conventions (`immutable`, `public`). However, `E_RETAIN_POLICY` belongs in `family: "quarry"` or `"schema"` rather than `"offline"`, because all other `.q` authoring diagnostics belong to the compiler families (`snapback2/packages/snapback2/guide/families.source.json:15`). The client option `fence: { days: 7 }` is unnecessarily nested when compared to flat options like `maxAssetBytes` and should be flattened to `maxOfflineDays: number`.

### 9. Carriers and the witness (§4, §10)
The process-kill witness in §10 tests relaunch only from a quiescent state where all writes have settled; it fails to catch crashes that occur mid-swap (during an active IndexedDB or SQLite transaction) or mid-enqueue in the outbox. It also fails to test behavior under hanging network requests (where connection timeouts might stall the app in `hydrating` instead of entering `offline`), multi-tab IndexedDB locking races, and local storage quota exhaustion. The `RangeStore` interface in §4 is mostly appropriate for Lane O3, but coupling `assets: ByteCache` into `RangeStore` is premature and unnecessarily binds Lane O2 to Lane O4.

### 10. The lanes (§12) and the trade (§13)
The O1–O4 lane split cannot execute strictly in parallel as claimed: Lane O2 cannot pass its browser kill witness (step 4, which requires flushing queued writes on reconnect) without Lane O1's `POST /api/resume` and pinned-id replay. Furthermore, Lane O3 (wiring the TypeScript evaluator twin) is actually **not** required to meet the offline bar: M5 acceptance 5 and M6 acceptances 1–2 require only cold-start history rendering (Lane O2 stored answers), offline search over downloaded text (Lane O2 JS filter), and queued offline writes (Lane O2 outbox with `pending[]`). Conversely, the lanes omit a mechanism for local offline view-once consumption and range-based purge of expired disappearing messages.

### 11. Surface
The following elements add surface without paying for themselves and should be eliminated:
1. Nested `fence: { days }` object: Replace with flat `maxOfflineDays: number`.
2. `E_RETAIN_POLICY` in `offline` family: Move to existing `quarry` family.
3. `assets: ByteCache` inside `RangeStore`: Keep `ByteCache` as an independent client utility in Lane O4.
4. `receipt.rows` duplication on the wire: Strip redundant row arrays from `ClosureReceipt` on the wire when `data` already provides them.
5. Unbounded multi-query resume in §8: Restrict resume in v1 to primary delivery ranges, avoiding server-side multi-query execution floods.

---

## 6. Strengths

1. **Clear fidelity to "not a replica":** The spec resists the temptation to turn the client into a mini-relational database or embed SQLite via WASM in the browser, adhering strictly to the result cache + outbox model.
2. **Authoritative fence model:** Reframing the fence to bound *trust* (suppressing prediction and intent replay) rather than *readability* (locking out the user) is an ergonomic and intuitive model for offline apps.
3. **Receipt-driven security boundary:** Retaining certified closure receipts alongside stored answers guarantees that local evaluations never synthesize facts outside server-verified coverage.
4. **Pragmatic offline search:** Stating plainly that offline search is a client-side filter over downloaded delivery logs avoids complex, premature local inverted token indexes.
5. **Durable, loud carrier contract:** Forbidding silent in-memory fallbacks when durable carriers fail ensures offline storage failures are caught immediately rather than masking bugs.

---

## 7. Open questions for the author

1. **Range Deletion Semantics for Delivered History:** If a table uses `retain delivered-history`, should message deletion and expiry be modeled strictly as application-level tombstone events in the delivery log (e.g. `kind: 'delete'`), or should the engine certificate support proving absences for missing rows within exhausted range boundaries?
2. **Scope of Lane O3 vs. The Offline Bar:** Given that the offline bar (M5 acc 5, M6 acc 1–2) can be satisfied with Lane O2 alone (stored-answer replay, client-side filtering, and outbox `pending[]` states), should Lane O3 (full evaluator twin integration) remain on the critical path for the offline bar, or follow it as an enhancement?

---

## 8. What to build first in Lane O1

If owning Lane O1, the very first deliverable is the **pinned-ID mutation replay plumbing on the owner and wire**. Specifically, add an optional `pinnedIds: string[]` field to `Action::Execute` in `writer.rs`, update `POST /api/mutation` in `serve.rs` to accept it, and implement the session ID block allocation check in `writer_auth.rs`. This immediately unblocks end-to-end testing of the offline outbox in Lane O2 before tackling `retain` compiler lowering or the `/api/resume` endpoint.

## Sample B — `--model gemini-3.8-flash-high` (verbatim)

Reviewer: Gemini 3.8 Flash (high reasoning effort) · Date: 2026-09-04 · Method: blind round-1, read-only capsule at 9ffdf6dd0

## 1. Verdict

**NOT READY**

LLP 1012 captures the right architectural intuition (a durable range store and result cache rather than a relational replica), but four blocking technical findings prevent it from being implemented as written:
1. The pinned-id replay hook claimed in §7 does not exist on the wire or in server mutation handling;
2. The `delivered-history` retention policy cannot distinguish deleted from hidden rows in ranges under the engine's receipt contract, which causes deleted and expired messages to be retained permanently in violation of the benchmark;
3. The §3 delivery-log recipe does not compile under Quarry v0.3 grammar due to invalid shape spread syntax (`.`) and an unsequenced compiler keyword (`retain`);
4. The `POST /api/resume` protocol starves the single-threaded owner and is completely unbounded against held queries.

---

## 2. Blocking findings

### 1. Pinned-id replay hook does not exist on the wire or in mutation handling

- **Claim in spec (§7, lines 342–345):**
  > "Intents consume from the block; on replay the server applies the intent with its pinned ids through the hook LLP 1001 §8 already names ('deterministic replay contexts may inject their pinned ids directly'), refusing an id outside the session's block."
- **Evidence:**
  - `snapback2/crates/snapback2/src/serve.rs:402–412`: The `/api/mutation` wire route only deserializes `op` and `args` from JSON into `Action::Execute { op, args, identity, expected }`. There is no field for client-pinned IDs.
  - `snapback2/crates/snapback2/src/writer.rs:824–826`: Mutations invoke `self.mutation_context(&authority, op, args)`.
  - `snapback2/crates/snapback2/src/writer_auth.rs:151–155`: `mutation_context` unconditionally calls `context.new_ids = self.runtime_mut().reserve_new_ids()?`, overwriting `new_ids` with freshly allocated server IDs on every mutation.
  - `snapback2/crates/snapback2-core/src/engine/runner.rs:392–397`: `Input::NewId` pops from `self.context.new_ids`.
  - In code, `context.new_ids` injection exists only in internal engine unit tests (`snapback2/crates/snapback2/src/test.rs:629`, `snapback2/crates/snapback2-core/src/engine/mod.rs:610`). There is no public API, wire field, or session-block validation anywhere on the server.
- **Why it blocks:**
  Client prediction and offline outbox replay rely on using pinned IDs so that dependent mutations (e.g. creating a group and sending a message to it) can reference newly created IDs before the server commits. Because the server HTTP handler does not accept client-pinned IDs and unconditionally overwrites `new_ids` with newly generated server IDs, every replayed mutation will be assigned a new, different ID on the server. The client's predictions, dependent queued mutations, and local store will immediately diverge.
- **What would resolve it:**
  (a) Extend the wire mutation request payload (`serve.rs:402–412`) and `Action::Execute` with an optional `pinned_ids: Vec<String>`; (b) implement session ID block reservation on `writer_auth.rs` / `identity.rs`; and (c) update `writer_auth.rs:151–155` to accept `pinned_ids`, validate that they fall strictly within the session's allocated ID block, and populate `context.new_ids`.

---

### 2. `delivered-history` retention retains deleted and expired rows forever in ranges

- **Claim in spec (§5, lines 270–278):**
  > "`delivered-history`: rows not in the fresh result are evicted **only on a receipt absence**; a row merely missing from the result is kept as history ... The one semantic the engine-core review must check: `delivered-history` depends on the receipt distinguishing *absent* (no row exists there) from *hidden* (a row exists the viewer may not see) ... If a hidden row cannot be told from a deleted one in some receipt shape, `delivered-history` keeps it — keeping is the policy's whole point — and the resume marks the range so the next read shows the age."
- **Evidence:**
  - `snapback2/crates/snapback2-core/src/engine/runner.rs:678–690`: For point reads, an absence is recorded in `receipt.absences` only when SQLite returns no row. When a row exists but read rule check fails (`visible == false`), lines 674–676 return `Null` without recording an absence.
  - `snapback2/crates/snapback2-core/src/engine/runner.rs:895–902`: In range scans, when candidate rows are hidden (`!allowed`), `receipt.absences` and `receipt.rows` are explicitly truncated to prevent leaking hidden data.
  - `snapback2/crates/snapback2-core/src/engine/runner.rs:985–1005`: In range scans, `ReceiptRange` only records `row_ids: returned_ids` and `absence: returned.is_empty()`. A row deleted from SQLite simply does not appear in `returned_ids`. Range scans never emit per-row absence entries into `receipt.absences`.
- **Why it blocks:**
  Under §5's rule, a row missing from a range result is kept unless the receipt contains an explicit absence proof for that row. Because range queries never emit per-row absence proofs for rows that disappeared from the range, any message deleted or revoked on the server will be treated as "still-delivered history" and retained permanently on the device. This directly breaks `benchmarks/briefs/social-messenger.md:565–570, 596–600, 651–653` (M5 Acceptance 1 and M6 Acceptance 1), which mandate that expired disappearing messages and revoked content must be purged from the client store and offline search upon sync.
- **What would resolve it:**
  Clarify that `delivered-history` operates in tandem with explicit event logs or point-read absence checks:
  1. For the delivery log (`deliveries`), deletions and expirations must be emitted as explicit tombstone rows (`kind: 'delete'`), as described in §3;
  2. For `messages`, specify that point reads (`messages[.messageId]`) yield point absences (`runner.rs:686–688`), triggering eviction of that specific message;
  3. Range results cannot use absence proofs to detect deleted items without tombstones.

---

### 3. Recipe in §3 fails to compile under Quarry v0.3 grammar

- **Claim in spec (§3, lines 184, 201):**
  > Line 184: `retain delivered-history`
  > Line 201: `return page { ., message: messages[.messageId] }`
- **Evidence:**
  - `snapback2/packages/compiler/src/quarry/parser.ts:816–835`: In `parseShapeFields()`, object spread syntax is explicitly `*` (`this.maybe("*")`), or `...<name>` for named spread (`this.at(".") && this.peek(1).value === "." && this.peek(2).value === "."`). A bare `.` is not recognized as spread and falls into `this.word()`, causing a parser syntax error.
  - `snapback2/packages/compiler/src/quarry/parser.ts:701`: `retain` is not in the Quarry parser grammar at all.
- **Why it blocks:**
  §12 schedules Lane O2 to adopt the §3 recipe in the `chat` template in parallel with O1. As written, the recipe produces a compiler syntax error on `{ ., ... }`, and will fail `snapback2 check` on `retain` until O1 grammar changes land.
- **What would resolve it:**
  Correct the spread syntax in the recipe to `*`: `return page { *, message: messages[.messageId] }`. Explicitly sequence Lane O1 ahead of Lane O2 so that `retain` compiler support exists before template adoption.

---

### 4. `POST /api/resume` single-read-transaction starves the single-threaded owner

- **Claim in spec (§8, lines 380–388):**
  > "`POST /api/resume { epoch, held: [{ op, args, seq, digest }], want: 'receipt' }`
  > The server re-executes every held `(op, args)` in **one read transaction** at one `seq` — it must, because re-authorization is what revocation means — and for each returns either `unchanged` when the fresh delivery's digest equals the client's..."
- **Evidence:**
  - `snapback2/crates/snapback2/src/writer.rs:1–2, 71–82`: The owner is a **single thread** that owns `Runtime` and SQLite, receiving requests over a synchronous `mpsc::channel`.
  - `snapback2/crates/snapback2-core/src/live.rs:17–19`: Computing `delivery_digest` requires executing the full query program against SQLite.
- **Why it blocks:**
  Executing 200 held queries in a single transaction on the owner thread forces the entire backend to stall for tens to hundreds of milliseconds per reconnecting client. During this batch execution, no mutations, HTTP queries, or SSE ticks can be processed. Furthermore, the `held` array is unbounded: any client can send thousands of held queries, easily inducing a denial of service on the owner.
- **What would resolve it:**
  1. Add an upper bound to `held` (e.g. max 50 queries per resume request; return `E_RESUME_FANOUT` if exceeded);
  2. Scope resume to active/mounted subscriptions and the delivery log rather than all historically scrolled pages;
  3. Allow resume batches to span multiple reads if the server sequence `seq` has not advanced.

---

## 3. Material findings

### 1. `ReceiptRange` lacks retention policy, and streaming receipts duplicate row data
- **Spec claim (§5 line 264; §8 lines 402–408):**
  > "the receipt carries it per range so the client applies it without a second source of truth."
  > "`GET /api/subscribe` gain `receipt=1`; when present, every response and frame carries the closure receipt beside `data`."
- **Evidence:**
  `snapback2/crates/snapback2-core/src/engine/mod.rs:192–211`: `ReceiptRange` contains no `retention` or `retain` field.
  `snapback2/crates/snapback2-core/src/engine/mod.rs:223–232`: `ClosureReceipt` contains `pub rows: Vec<RowRecord>`.
- **Why it matters:**
  The client has no way to learn a table's retention policy from `ReceiptRange` today. Additionally, sending `ClosureReceipt.rows` along with `data` on every SSE frame duplicates the full JSON text of every row returned, doubling payload bandwidth on live streams.
- **What would resolve it:**
  Add `pub retain: RetentionPolicy` to `ReceiptRange`. On subscription frames, omit duplicate rows from `receipt.rows` if they are already present in `data`.

### 2. View-once suppression on cold start is required by M6 Acceptance 1 but deferred in §9
- **Spec claim (§9, lines 421–423):**
  > "Rows whose delivery is not cacheable — one-use delivery when it lands; anything served under a fenced audit — refuse the cache at the row, not the byte."
- **Evidence:**
  `benchmarks/briefs/social-messenger.md:651–653` (M6 Acceptance 1): "Cold-start offline (iOS simulator, backend stopped): history and previously viewed media render; synced-message search works; a previously viewed view-once photo does **not** render."
- **Why it matters:**
  If view-once media gating is deferred "until it lands", the local byte cache and store will retain and render viewed view-once media offline on cold restart, failing M6 Acceptance 1.
- **What would resolve it:**
  Define in v1 how view-once media references are marked in the store and excluded from `ByteCache` once viewed, or explicitly handle view-once deletion on first view.

### 3. The process-kill witness in §10 tests quiet restart, not atomic swap durability
- **Spec claim (§4 lines 247–248; §10 lines 431–435):**
  > "A crash mid-swap leaves the previous generation intact, which the kill witness (§10) asserts."
- **Evidence:**
  `llp/1012-local-first-v1.spec.md:431–435`: Step 1 runs until queries settle ("drain the delivery log; open three chats; view two images"); step 2 terminates the idle process.
- **Why it matters:**
  Killing an idle process verifies cold-boot hydration from disk, but fails to test carrier atomicity or corruption recovery during an active `swap()`.
- **What would resolve it:**
  Add an explicit test hook to crash during `RangeStore.swap` to verify that interrupted swaps roll back cleanly to the prior generation.

### 4. Independent settlement in FIFO outbox creates cascading errors for dependent writes
- **Spec claim (§7, lines 352–353):**
  > "A rejection settles that intent only; the drain continues."
- **Evidence:**
  In chat applications, writes frequently form causal chains (e.g. `createConversation` pinned as `conv-1` followed by `sendMessage(conv-1, ...)`).
- **Why it matters:**
  If `createConversation` is rejected, continuing the drain immediately sends `sendMessage(conv-1, ...)`, which is guaranteed to fail on the server with `NOT_FOUND` or `NOT_MEMBER`. Furthermore, in conversational messaging, sending later messages when earlier messages fail inverts message order and meaning.
- **What would resolve it:**
  Specify that on an intent rejection, the outbox drain pauses and reports the failure to the client/UI rather than blindly submitting dependent intents.

---

## 4. Minor findings

1. **Option naming inconsistency:** §5 lines 290 and 296 refer to `maxOfflineAge`, but the client option spelling is given as `fence: { days: 7 }`. Consistently use `fence: { days: number }`.
2. **Diagnostic family alignment:** Grouping `E_RETAIN_POLICY` in the `offline` family mixes a compile-time schema diagnostic into a runtime offline family. Under `snapback2/crates/snapback2/src/protocol.rs:8–27`, schema errors belong to family `schema`.
3. **Monolithic `RangeStore`:** In §4, `RangeStore` combines query results, `OutboxStore`, and `ByteCache`. On Expo, SQLite handles queries/outbox while disk handles asset bytes; separating `RangeStore` from `ByteCache` would be cleaner.
4. **Digest representation on the wire:** In §8, the client sends `digest`. The engine currently has two digest formats (`live.rs:17` sha256 of `(state, result)` vs `writer_values.rs:56` JSON string without seq). The wire resume format must specify the exact digest algorithm.

---

## 5. Answers to the eleven questions

1. **Absent versus hidden (§5).** As implemented in `snapback2/crates/snapback2-core/src/engine/runner.rs:678–690`, point reads distinguish absent from hidden: missing rows emit into `receipt.absences`, while hidden rows return `Null` without an absence entry (`runner.rs:674–676`). However, for rows inside a range, `runner.rs:895–902` truncates receipt artifacts on hidden rows, and deleted rows simply do not appear in `returned_ids` (`runner.rs:985–1005`); ranges emit **no** per-row absence facts. If §5 treats missing range rows as "kept as history" unless an absence is proved, deleted and expired messages will never be evicted. The right design is to make deletions and expirations explicit events/tombstones in the delivery log (`kind: 'delete'`), and use point reads for message entity verification.

2. **The resume protocol (§8).** The protocol is not bounded as written. In `snapback2/crates/snapback2/src/writer.rs:1–2, 71–82`, the owner is a single thread. Executing 200 held pages for a 50-conversation inbox in one read transaction executes 200 full SQL queries sequentially, blocking all concurrent traffic on the owner thread. An unbounded `held` list creates a trivial DoS vector. A read transaction is safe for engine consistency, but the request shape lacks a limit on `held.len()` (must be bounded, e.g. ≤ 50) and lacks pagination for large stores.

3. **Ids (§7).** The hook does not exist in code for client intents. In `snapback2/crates/snapback2/src/writer_auth.rs:151–155`, `mutation_context` unconditionally overwrites `context.new_ids` with `self.runtime_mut().reserve_new_ids()?`. The server wire handler in `serve.rs:402–412` does not accept pinned IDs. When a session block is exhausted, the client must pause and request a new block; if a device is wiped, uncommitted pinned IDs are lost; if two devices of one principal race, independent session blocks avoid ID collisions, but server OCC settles data conflicts.

4. **The receipt on the wire (§8, `receipt=1`).** `ClosureReceipt` in `snapback2/crates/snapback2-core/src/engine/mod.rs:223–232` is serializable via serde, but it is not generation-bound (it carries only `schema_hash`, not generation ID) and is far too large to ship on every frame because `pub rows: Vec<RowRecord>` duplicates the entire query payload already present in `data`. On subscription frames, `receipt.rows` should be omitted when identical to `data`, internal `verdicts` should be stripped, and `ReceiptRange` must add `pub retain: RetentionPolicy`.

5. **The delivery-log recipe (§3).** The recipe does not compile under Quarry v0.3: `{ ., message: messages[.messageId] }` is invalid syntax (`parser.ts:820–826` requires `*` for spread), and `retain delivered-history` is not yet a parsed table modifier (`parser.ts:701`). The fan-out `for` loop with `first 50` produces 51 write rows, safely below `Ceilings::default().write_rows = 2_048` (`snapback2-core/src/certificate.rs:41`). However, one range cannot cover the entire app: scrolling an individual chat needs a second range on `messages[conversationId]`, and reactions require additional schema. A per-viewer delivery log is functionally an event replication log modeled in the application layer, shifting replication complexity from the engine to Quarry program logic.

6. **The outbox and prediction (§7).** The state machine `queued → committed | rejected | expired` with an orthogonal `predicted` flag is sound, minimal, and matches the eight client states of LLP 1002 §9. Writing to both outbox and predicted store in one IndexedDB transaction is possible across multiple object stores, provided all reads are completed in memory before initiating the transaction (avoiding microtask transaction auto-commit). Independent settlement is problematic for chat: if an initial mutation fails (e.g. creating a conversation), replaying dependent messages blindly produces orphaned errors and confusing out-of-order deliveries.

7. **The fence (§5).** Nothing in `snapback2-core` or the certificate assumes the old "store untrusted past the fence" reading; "fence" in current code refers only to session epoch logout fences (`writer_auth.rs:207`) and schema migration fences (`test_authority.rs:19`). The server does not need the client's fence (`fence: { days }`); the server only enforces its own hard 30-day ceiling on `issuedAt`.

8. **Spellings.** `retain until-revoked | delivered-history` fits Quarry table syntax well (`LLP 1010`). For client options, `fence: { days }` and `maxAssetBytes` are clean, though prose should avoid mixing `maxOfflineAge` and `fence`. For error codes, `E_OFFLINE_CARRIER`, `E_OFFLINE_FENCE`, `E_INTENT_EXPIRED`, and `E_ID_BLOCK` belong in the `offline` family, but `E_RETAIN_POLICY` is a compiler diagnostic and should reside in the `schema` family (`protocol.rs:17`).

9. **Carriers and the witness (§4, §10).** The §10 witness fails to test mid-swap crashes (it only terminates the process when completely idle), multi-tab IndexedDB locking, storage quota exhaustion, and transport drops occurring during outbox replay. The §4 interface is larger than necessary for Lane O3: bundling `ByteCache` and `OutboxStore` inside `RangeStore` creates unnecessary carrier coupling.

10. **The lanes (§12) and the trade (§13).** The O1–O4 ordering has a dependency bug: O2 cannot adopt the delivery-log recipe in the `chat` template in parallel with O1 because `retain` in Quarry will not compile until O1 lands. For the offline bar (`social-messenger.md` M5/M6), Lane O3 (local IR evaluation via the twin) is actually not strictly required: stored-answer replay and FIFO outbox drain (O2) plus asset caching (O4) satisfy all specified acceptance criteria. Conversely, view-once suppression is required by M6 Acceptance 1 but missing from v1.

11. **Surface.** Surfaces that add unnecessary complexity: (1) Complex server-issued ID blocks (`idBlock: { from, count }`) when client-generated monotonic UUIDv7/prefixed IDs would eliminate allocator roundtrips; (2) Sending full closure receipts (`receipt=1`) on every SSE subscription frame; (3) Re-executing all 200 historically held queries on resume instead of only active subscriptions and the delivery log.

---

## 6. Strengths

1. **Honest security boundary:** Rejecting a full client replica preserves authorization integrity; the client never evaluates what the receipt did not cover.
2. **Result cache with range validity:** Replaying certified answers for identical `(op, args)` (Lane O2) provides an immediate, robust offline UX without needing complex client-side query engines.
3. **Receipt-driven invalidation:** Digest-checked re-authorization at reconnect (§8) turns unchanged query validation into a cheap hash comparison.
4. **Zero WASM constraint:** Avoiding SQLite-in-WASM on the web keeps the client bundle under 10 KB gzip.
5. **Physical process-kill bar:** Demanding an actual process-kill witness rather than a clean teardown test prevents persist-debounce traps.

---

## 7. Open questions for the author

1. **Client ID Generation:** Can client intents mint random unique IDs (e.g. UUIDv7 or `principalId:outboxSeq`) validated at commit time, eliminating the stateful session ID block allocator (`idBlock: { from, count }` and `E_ID_BLOCK`)?
2. **Outbox Drain on Error:** Should an outbox rejection pause the drain and notify the user (recommended for chat where messages depend on prior context), or must the client strictly continue draining independent writes?

---

## 8. What I would build first if I owned Lane O1

If I owned Lane O1, I would first implement `retain until-revoked | delivered-history` in the Quarry compiler (`snapback2/packages/compiler/src/quarry/`), update the static certificate to record table retention policies, and add `retain` to `ReceiptRange` in `snapback2-core`. Then, before touching resume or wire streaming, I would implement the missing server mutation hook: adding optional `pinned_ids` to `/api/mutation` and plumbing them through `Action::Execute` into `context.new_ids` in `snapback2/crates/snapback2/src/writer_auth.rs`, with a unit test demonstrating that a replayed mutation commits with its exact client-pinned ID. That establishes the authoritative contract required for all subsequent lanes.



---

## Round 2 — proposals (2026-09-04, later the same day; verbatim)

**Method:** round 2 on the brief preserved at `1012-local-first-v1.panel.brief-r2.md`, which carried the orchestrator's verified round-1 synthesis and asked for designs rather than critique, per the author's instruction. Gemini 3.8 Flash High, one sample this round at the author's instruction (the duplicate Antigravity default-model run was stopped before it finished).

Reviewer: gemini-3.8-flash (high) · Date: 2026-09-04 · Method: round 2, proposals, read-only capsule at 9ffdf6dd0, after the verified round-1 synthesis

# Panel: LLP 1012, Local-first v1 — Round-2 Contribution

---

## 1. The Purge Design

The receipt model established in round 1 confirms that point reads record absences, hidden rows return null without an absence, and range receipts are emitted exclusively for certified-uniform sites (`snapback2-core/src/engine/runner.rs:985-987`) with no per-row absence facts (`snapback2-core/src/engine/mod.rs:223-236`).

To satisfy M5 acceptance 1 and M6 acceptance 1 cleanly, we combine **(C) Extent Eviction on Uniform Ranges** for active views with **(B) Tombstone Events in the Delivery Log** for historical and background purges.

### Design and Mechanics
1. **Extent Eviction on Active Uniform Ranges:** Because the engine emits range receipts *only* for certified-uniform sites (`runner.rs:985`), there are no hidden candidates within an evaluated range. The receipt carries the range bounds (`prefix`, `after`, `before`, `gt`, `gte`, `lt`, `lte`) and `row_ids` (`runner.rs:990-1008`). When `ClientStore` applies a fresh range delivery covering key interval [lo, hi], any previously held row r whose index key falls within [lo, hi] but whose ID is missing from `row_ids` is mathematically proven to be deleted or expired on the server. The client store evicts r immediately.
2. **Log-Driven Historical Purge:** For messages outside the actively subscribed viewport, or when clients are closed during expiry (M5 acceptance 1), the server purge mutation inserts an explicit tombstone into `deliveries`:
   ```q
   insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'delete', at: now }
   ```
   When the phone reconnects and drains `deliveries`, it processes `kind: 'delete'` and removes the referenced `messageId` and its cached asset leases from `RangeStore`.

### Retain Policy and Engine Impact
We eliminate `retain delivered-history` from Quarry syntax entirely. All tables use the default `retain until-revoked`. Messages are retained locally because the append-only `deliveries` log references them; they are purged when an extent eviction or a `delete` log row arrives. The Rust engine (`snapback2-core`) requires **zero changes**; eviction logic lives entirely within `ClientStore::apply_swap` in `packages/snapback2`.

*Alternative rejected in one sentence:* We reject (E) (explicit server-side `evictions[]` negative facts) because tracking per-client delivery state on the server violates the scale-to-zero stateless owner principle.

---

## 2. Resume a Phone Would Love

The Snapback 2 owner is a single thread over an `mpsc` channel (`snapback2/src/writer.rs:70-82`) holding SQLite in `locking_mode = EXCLUSIVE` (`snapback2-core/src/store.rs:97-108`). Executing hundreds of held queries on reconnect would serialize and stall the server. 

### Reconnect Protocol
The client sends its schema hash, auth epoch, delivery log watermark, and a capped set of currently mounted queries (maximum 8). Cold held pages are not sent.

```json
// POST /api/resume
{
  "schemaHash": "a1b2c3d4e5f6",
  "authEpoch": 3,
  "watermark": { "at": 1725400000000, "id": "del_018f3a" },
  "mounted": [
    { "op": "inbox", "args": {}, "digest": "d_8f12a4b9" },
    { "op": "conversation", "args": { "id": "c_42" }, "digest": "d_3c71e902" }
  ]
}
```

### Server Execution Sequence
1. **Header Validation:** Validate `schemaHash` and `authEpoch`. If stale, respond immediately with `E_SCHEMA_STALE` or `E_AUTH_SESSION`.
2. **Fast Watermark Index Probe:** Execute a single indexed query:
   ```sql
   SELECT 1 FROM deliveries 
   WHERE recipient = ? AND (at > ? OR (at = ? AND id > ?)) 
   LIMIT 1;
   ```
   If no rows exist, the user's message universe has had zero inserts, edits, or deletes.
3. **Fast-Path Response:** When the watermark check confirms no changes, the server bypasses query execution and returns in < 0.3 ms:
   ```json
   {
     "seq": 2048,
     "logUnchanged": true,
     "idBlock": { "prefix": "s_a91b_", "start": 1, "limit": 128 },
     "mounted": [
       { "op": "inbox", "args": {}, "unchanged": true },
       { "op": "conversation", "args": { "id": "c_42" }, "unchanged": true }
     ]
   }
   ```
4. **Slow Path:** If new deliveries exist, re-execute only the mounted queries (capped at 8) in one read transaction and return full results with receipts only for changed queries.

### Canonical Digest and Schema Changes
The canonical digest is bound across the complete execution state:
```rust
canonical_digest = sha256(&(schema_hash, plan_hash, auth_epoch, &execution.state, &execution.result, next_cursor));
```
On a schema generation change, the server returns `schemaStale: true`. The client clears absences per `client.rs:162-171`, marks held answers `stale`, and re-queries fresh.

### Cost for Clique Inbox
- **Bytes:** ~260 bytes request, ~140 bytes response on the fast path.
- **Owner time:** ~0.2 ms for a single SQLite index seek, keeping writer latency near zero.

*Alternative rejected in one sentence:* We reject re-executing all 200+ held ranges in one transaction because it causes 50–100 ms exclusive write-lock stalls on the owner thread during client reconnection storms.

---

## 3. Ids and Replay, the Smallest Correct Scheme

Offline writes require deterministic IDs for local joins (e.g., creating a conversation and immediately sending a message to it). Network retries after a 503 must never double-insert (`snapback2/src/serve.rs:402-412`).

### Wire Shape and Deduplication
The mutation request envelope is extended to include `intentId` and optional `pinnedIds`:

```json
// POST /api/mutation
{
  "intentId": "018f3a9b-7c1e-7000-8000-000000000001",
  "op": "send",
  "args": { "conversationId": "s_devA_1", "body": "Hello offline" },
  "pinnedIds": ["s_devA_2"]
}
```

### Server Execution and Injection Point
In `snapback2-core/src/store.rs`, create a system table:
```sql
CREATE TABLE IF NOT EXISTS _intents (
  intent_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  result TEXT NOT NULL,
  committed_at INTEGER NOT NULL
);
```

In `snapback2/src/writer_auth.rs:150-156`:
1. Check `_intents` for `intentId`. If present, return the stored result immediately without re-executing the mutation.
2. If `pinnedIds` are supplied, verify they match the session's allocated prefix (`s_<sessionId>_`) and remain within the allocated count.
3. Instead of reserving new IDs from `store.reserve_new_ids()` (`store.rs:294`), populate the execution context directly:
   ```rust
   context.new_ids = VecDeque::from(pinned_ids);
   ```
   The engine runner pops these via `Input::NewId` (`runner.rs:392-397`).
4. On commit, record `(intentId, seq, result, now)` in `_intents` in the same SQLite transaction.

### Failure Shapes
- **Block Exhausted:** Client counter reaches the allocated limit offline. The outbox rejects further offline inserts with `E_ID_BLOCK_EXHAUSTED` (edits and reactions continue).
- **Device Wiped:** Local state is discarded. On re-authentication, the server grants a fresh session ID and disjoint prefix (`s_devA2_`); orphaned intents are gone, preventing collisions.
- **Two Devices of One Principal:** Each device authenticates under its own session token, receiving disjoint prefixes (`s_devA_` vs `s_devB_`), eliminating cross-device collision.
- **Parent Intent Rejected:** If intent 1 fails commit (OCC/validation), intent 2 referencing its pinned ID fails during execution with `NOT_FOUND`. The client outbox marks child intent 2 `rejected` with `reason: 'parent_rejected'`.

*Alternative rejected in one sentence:* We reject uncoordinated client-minted UUIDv7s without session prefixes because they permit cross-tenant ID spoofing and break SQLite clustered B-Tree insertion locality.

---

## 4. Make It Feel Like WhatsApp

Three concrete improvements inside NOT-DOING that elevate the offline experience for both the user and the agent builder:

### 1. The Offline Simulation Harness Primitive (`harness.transport.sever()` & `reconnect()`) [Rank 1]
- **What it is:** A network fault injection API built directly into `snapback2/test` and the Node client harness. It allows test scripts to sever HTTP and SSE transport cleanly while leaving the in-memory client, storage carrier (IndexedDB/expo-sqlite), and UI component tree intact.
  ```ts
  const harness = await createTestHarness({ app });
  await harness.transport.sever();
  await harness.client.mutate('send', { body: 'Offline message' });
  expect(harness.client.outbox.peek().state).toBe('queued');
  await harness.transport.reconnect();
  await harness.drain();
  expect(harness.client.outbox.peek()).toBeUndefined();
  ```
- **Cost:** ~85 lines of TypeScript in `packages/snapback2/src/test_harness.ts`. 0 bytes on the wire; 0 production runtime overhead.
- **What it pays:** Transforms offline verification from a multi-second ordeal involving OS process kills (`SIGKILL`) and native simulator restarts into a deterministic, 200 ms in-memory test. Agents building on Snapback 2 can author and verify M5 acceptance 5 and M6 acceptance 2 in CI hermetically.
- **Proof:** A test `tests/offline_harness.test.ts` where the test severs transport, enqueues two writes, asserts `queued` status, re-establishes transport, and verifies in-order settlement.

### 2. The Unified WhatsApp Delivery Lifecycle Hook (`useMessageState`) [Rank 2]
- **What it is:** A React client hook that reconciles outbox intents with query-delivered rows, tracking the four canonical states:
  - `queued`: clock icon (held in outbox)
  - `sent`: single grey check (server committed via `_intents`)
  - `delivered`: double grey check (delivered to recipient log)
  - `read`: double blue check (read receipt acknowledged)
  It maps temporary client intent IDs to permanent message IDs, eliminating UI flicker when an outgoing message transitions from `pending[]` outbox arguments to query stream results.
- **Cost:** ~45 lines of TypeScript in `packages/snapback2/src/react.ts`. 0 wire bytes.
- **What it pays:** Eliminates optimistic UI jumpiness and provides the classic WhatsApp visual contract out of the box for agent-built UIs.
- **Proof:** Playwright browser test asserting seamless DOM transition from `.icon-clock` to `.icon-check-single` to `.icon-check-double` without component re-mounting.

### 3. Viewport-First Prioritized Drain Policy (`drainPolicy: 'viewport-first'`) [Rank 3]
- **What it is:** A client-side sync scheduler that coordinates delivery log draining. On cold start or reconnect, the client prioritizes:
  1. The currently open conversation;
  2. The latest message for the top 20 inbox conversations;
  3. Background idle draining of deep message history via `requestIdleCallback` (web) or `InteractionManager` (Expo).
- **Cost:** ~60 lines of TypeScript in `packages/snapback2/src/drain.ts`. 0 server bytes.
- **What it pays:** Cold-start time-to-interactive remains under 40 ms even with thousands of backlogged messages, preventing thread jank on low-end mobile devices.
- **Proof:** Benchmark measuring frame rate and time-to-first-paint on a seeded account with 5,000 pending delivery rows.

---

## 5. Steal One Thing

### Stolen Mechanism
**Replicache's and Linear's Transaction-Bound Intent Deduplication Log (`_intents` Table).**

### Why It Fits
Snapback 2's writer already processes mutations sequentially within exclusive SQLite transactions (`snapback2-core/src/store.rs:97-108`, `snapback2/src/writer.rs:70-82`). In Replicache and Linear, every mutation envelope carries a client-assigned `mutation_id`. When committing, the engine records `(mutation_id, seq, result)` in an internal table inside that same database transaction.

This adheres strictly to Snapback's core principles:
- **Result cache, never a replica:** It requires no client-side relational storage or CRDTs.
- **Certificate as the gate:** Mutations execute under normal engine authority and permission rules.
- **Exact, never invented:** Retried mutations return the exact committed result without re-execution.

### What It Replaces
It completely eliminates the U3 double-send vulnerability (`POST /api/mutation` retries after 503 or network drops) and removes the need for bespoke, application-level deduplication code.

*Alternative rejected in one sentence:* We reject Replicache's client-side scan/diff engine because running local relational queries turns the client into a full replica, violating Ruling 2.

---

## 6. Cut

To simplify v1 and reliably hit the offline bar, we cut two components:

### 1. Cut Lane O3: The Client Twin / Local Evaluator (`packages/evaluator`)
- **Rationale:** Round 1 verified (U8) that the offline bar (M5 acceptance 5, M6 acceptance 1 & 2) does not require Lane O3:
  - Cold-start offline reads are satisfied by stored answers in Lane O2 (`answer(op, args)`).
  - Warm and cold offline search is an in-memory JavaScript filter over held delivery log rows.
  - Offline pending writes render directly from mutation arguments (`pending[]`).
- **What it unblocks:** Cutting Lane O3 eliminates the need to compile and ship bytecode evaluator machinery into the client runtime. It eliminates JS/Rust engine drift risks, reduces mobile bundle size, and removes complex prediction overlay reconciliation logic.

### 2. Cut `retain delivered-history` from Quarry Syntax
- **Rationale:** As established in Task 1, `delivered-history` created the U1 flaw (failure to evict deleted/expired messages). Message retention is an application data pattern—an append-only delivery log under the uniform `until-revoked` rule—paired with extent eviction.
- **What it unblocks:** Removes new grammar keywords, compiler parsing changes (`parser.ts:104-137`), certificate schema modifications, and `E_RETAIN_POLICY` error machinery.

*Alternative rejected in one sentence:* We reject cutting asset caching (Lane O4) because M6 acceptance 1 explicitly mandates offline rendering of previously viewed media.

---

## 7. Lane O1 on One Page

### Deliverables
1. **Engine and Store (`snapback2-core`):**
   - In `snapback2-core/src/engine/mod.rs`, update `ClosureReceipt` to include `schema_hash: String` and `auth_epoch: u64`. Strip duplicate `rows` from the receipt when already present in data. Ensure `ReceiptRange` exposes evaluated bounds for uniform extent eviction.
   - In `snapback2-core/src/store.rs`, add `_intents` table and session ID block allocation helper (`allocate_id_block(session_id, 128)`).
2. **Server and Wire (`snapback2`):**
   - In `snapback2/src/serve.rs`, add route `POST /api/resume`.
   - In `snapback2/src/serve.rs`, update `POST /api/mutation` to parse `intentId` and optional `pinnedIds`.
   - In `snapback2/src/serve.rs`, support `receipt=1` query parameter on `POST /api/query` and `GET /api/subscribe`.
   - In `snapback2/src/writer_auth.rs`, check `_intents` for deduplication and inject `pinnedIds` into `context.new_ids`.
3. **TypeScript Wire Types (`packages/snapback2/src/types.ts`):**
   - Freeze wire interfaces: `ClosureReceipt`, `ResumeRequest`, `ResumeResponse`, `MutationEnvelope`.

### Wire Contracts
```ts
interface ResumeRequest {
  schemaHash: string;
  authEpoch: number;
  watermark: { at: number; id: string };
  mounted: Array<{ op: string; args: Record<string, unknown>; digest: string }>;
}

interface ResumeResponse {
  seq: number;
  logUnchanged: boolean;
  idBlock: { prefix: string; start: number; limit: number };
  mounted: Array<{
    op: string;
    args: Record<string, unknown>;
    unchanged?: boolean;
    result?: unknown;
    receipt?: ClosureReceipt;
  }>;
}

interface MutationEnvelope {
  intentId: string;
  op: string;
  args: Record<string, unknown>;
  pinnedIds?: string[];
}
```

### Landing Order
1. **PR 1: Receipt Wire Types & TypeScript Contracts:** Freeze `ClosureReceipt` and export wire types in `packages/snapback2/src/types.ts`.
2. **PR 2: Idempotent Mutation Path & ID Blocks:** Implement `_intents` deduplication and `pinnedIds` context injection. Unit test in `tests/mutation_dedup.rs`.
3. **PR 3: `/api/resume` Endpoint:** Implement the fast-path watermark index probe and canonical digest check. Unit test in `tests/resume_fast_path.rs`.
4. **PR 4: Integration Verification:** Add end-to-end integration tests in `snapback2/tests/api_resume_and_replay.rs`.

Lane O2 can start immediately against PR 1's frozen TypeScript types and PR 4's recorded JSON fixtures.

*Alternative rejected in one sentence:* We reject building Lane O2 against a temporary stub receipt shape because changing receipt field custody after O2 is built would invalidate the underlying range store schema.

---

## 8. If I Could Change One Ruling

I would change Ruling 8, which introduced `delivered-history` alongside `until-revoked`. Syntactic retention policies in the database schema broke the clean mathematical properties of closure receipts by making deletions indistinguishable from unread history. In real-world messengers, durable history is an application data pattern—an append-only delivery log—rather than an engine-level storage primitive. Relying solely on `until-revoked` paired with extent eviction over certified-uniform ranges cleanly evicts deleted and expired rows while preserving older log entries. Retiring Ruling 8 eliminates new Quarry keywords and compiler diagnostics while providing a simpler, more robust offline retention model.
