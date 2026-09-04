# Panel: LLP 1012 — Local-first v1, round-1 synthesis (orchestrator, author-side)

**Family:** Claude Fable 5.1 — the session that authored LLP 1012 as landed at `9ffdf6dd0`; **not an independent reviewer**, disclosed as the author-side voice.
**Provider/runtime:** Claude Code, model claude-fable-5-1.
**Date:** 2026-09-04
**Redacted:** No — everything read was in-repo; nothing left the machine beyond the models serving the six CLIs.
**Method:** Round 1 mutually blind on one brief (`1012-local-first-v1.panel.brief.md`), six panelists in six separate read-only capsules exported from `9ffdf6dd0`: Claude Fable 5.1 at effort max (a fresh session; same family as the author, disclosed), codex gpt-5.6-sol at ultra, grok-4.6 at xhigh, Muse Spark at ultra, and Gemini 3.8 Flash High twice (the Antigravity CLI's default model resolved to it, so the "Antigravity" panelist and the named Gemini panelist are two samples of one model). Records: `1012-local-first-v1.{fable,codex,grok,muse,gemini}.md`. **Every engine claim below was verified against the tree by the orchestrator before it was written here**, and the two claims that could be settled by running something were run: the §3 recipe through the compiler worker and through the `snapback2 check` of a built binary.
**Standing:** this document proposes; it changes nothing in LLP 1012 and sets no status. The author decides.

## 1. Verdicts

| Panelist | Verdict | Blocking | Words / `path:line` citations |
|---|---|---|---|
| Claude Fable 5.1 (max, fresh) | NOT READY | 4 | 2,656 / 16 |
| codex gpt-5.6-sol (ultra) | NOT READY | 5 | 2,195 / 17 |
| grok-4.6 (xhigh) | NOT READY | 2 | 3,050 / 24 |
| Muse Spark (ultra) | NOT READY | 3 | 3,264 / 14 |
| Gemini 3.8 Flash High, sample A | NOT READY | 3 | 3,687 / 19 |
| Gemini 3.8 Flash High, sample B | NOT READY | 4 | ~3,300 / 20 |

Six of six: **not ready as written; ready after a bounded list of spec edits.** No panelist disputed a ruling. Two invoked the brief's one exception — a ruling that cannot be implemented as the spec spells it — and both are recorded in §3 as questions for the author. Every panelist's "strengths" section named the same center to keep: result cache and never a replica; the fence as trust and not reading; `predicted` as a flag on `queued`; loud carrier refusal and no encryption claim; bytes under the row's lease; a physical kill as the bar's evidence; measurements that gate every deferral.

## 2. What every reviewer found, verified

**U1. Range receipts carry no per-row absences, so `delivered-history` as written never evicts a deleted or expired row.** Six of six. `ClosureReceipt.absences` is point-keyed, `Vec<(table, index, key)>` (`snapback2-core/src/engine/mod.rs:223-236`); `ReceiptRange` carries `row_ids`, `stop`, a whole-range `absence: bool`, and a halo (`mod.rs:191-208`); a hidden candidate's artifacts are truncated from the receipt (`runner.rs:895-902`); a point read of a missing row records an absence while a hidden row returns `Null` without one (`runner.rs:671-688`). A message deleted or expired on the server drops out of the fresh range with no absence, and §5's rule keeps it "as history". That fails M5 acceptance 1 and M6 acceptance 1. One engine fact cuts the other way and every panelist noted it: a range receipt is emitted **only for a certified-uniform site** (`runner.rs:985-987`, "only a certified-uniform range can carry an extent"), and the messenger's ranges are uniform, so a held id inside a fresh uniform range's bounds and missing from its `row_ids` is provably gone. Non-uniform ranges ship no range fact at all, which means the store can hold their *answers* but never their *coverage*.

**U2. Resume as spelled has no counterpart, no honest digest, and no bound.** Six of six. No `/api/resume` route (`snapback2/src/serve.rs:344-486`). Two digests exist, neither on the wire and neither bound to anything but data: `delivery_digest` over `(state, result)` (`snapback2-core/src/live.rs:17-19`) and `frame_digest`, the JSON frame minus `seq` (`snapback2/src/writer_values.rs:56-61`). Verdicts are bound to `auth_epoch` (`mod.rs:213-220`), so after a re-login the data digest is unchanged while every held verdict is dead. The owner is one thread over an `mpsc` channel (`writer.rs:70-82`) holding SQLite in `locking_mode = EXCLUSIVE` (`store.rs:97-108`), and each execution opens its own transaction (`mod.rs:734`). "One read transaction" is therefore not the unit; one owner action is, and it holds "one seq" by serialization. `held[]` is unbounded, which is both a stall and a denial of service.

**U3. Replay has no envelope, no idempotency, and no id plumbing.** Six of six. `POST /api/mutation` parses `op` and `args` only (`serve.rs:402-412`); `mutation_context` unconditionally overwrites `context.new_ids` from the store's reservation (`writer_auth.rs:152-156`, blocks of 1,024, `store.rs:294`); exhaustion is `RuntimeError::Input("newId envelope exhausted")` (`runner.rs:392-397`); nothing carries an intent id or `issuedAt`. Consequence, named by five: §7's own rule that a 503 after a commit stays `queued` makes the retry **double-send**, or, with pinned ids, hit the primary key and surface as `rejected` for a message that is on the server. Server-side deduplication on an intent id is required by the bar's own writes, independent of id blocks.

**U4. The recipe does not compile as written, certifies only at page 50, and one range does not cover the thread screen.** Five of six, and the orchestrator ran it. Bare `.` in a shape is `E_QUARRY_SYNTAX` (`parser.ts:816-832`; spread is `*`, a named field is `name: .`); `retain` is not a table word (`parser.ts:104-137`) and `delivered-history` cannot lex as one token (`lexer.ts:7,96`). With `delivery: .` and no `retain` line the compiler worker accepts it; the built binary's `check` then **refuses `first 200` with `E_BOUND`, output bytes 3,456,012 against the 1,048,576 ceiling** (Fable computed 3.4 MB by hand from `bounds.rs:53-56` before the run), and **certifies `first 50`** (19 operations). The `for` over a range read inside a mutation is accepted (`program.ts:188-195`); the fan-out's 51 writes fit the 2,048 ceiling (`certificate.rs:41`); member 51 of a group is silently undelivered. The log index `(recipient, at, id)` has no conversation prefix, so the thread is not that range: it is a JS filter over held log rows, or a second index. Reactions have no shape in the recipe.

**U5. The receipt on every frame duplicates the data and binds to nothing.** Six of six. `receipt.rows` is full `RowRecord`s (`mod.rs:88-92`), about 2× per frame; the receipt carries an optional `schema_hash` and no plan hash or generation; the twin's `ClientStore` clears absences on a schema mismatch (`client.rs:162-171`). Fable adds a disclosure finding the orchestrator verified: point-read absences are recorded unconditionally (`runner.rs:686-688`), so `receipt=1` would let an alternate-key point read distinguish "hidden" from "absent", the existence oracle LLP 1011 closed for writes.

**U6. The witness proves a quiescent restart, not what §4 claims.** Six of six. It never kills mid-swap, never enqueues before the kill it then asserts on, never boots with a refused carrier, and view-once byte exclusion has no owner because one-use delivery is deferred in LLP 1006.

**U7. Spellings and surface.** Five of six: `E_RETAIN_POLICY` is a check-time refusal and belongs to the `quarry` or `schema` family, not `offline`; `want: 'receipt'` duplicates `receipt=1`; bare `epoch` is ambiguous between auth epoch and generation; `fence: { days }` beside a flat `maxAssetBytes` is two spellings for one bag; `swap(gen: Generation)` collides with the engine's `Generation`; `assets` on the O2 interface couples O2 to O4.

**U8. Lanes.** Four of six: O2 "against a stub" of a receipt shape O1 may reshape builds the wrong store; freeze the wire receipt first. Three of six, and the orchestrator agrees: lane O3 is not needed for the offline bar as ruled, since cold-start reads are held answers, search is an app filter, and pending renders from arguments.

## 3. Findings one reviewer made that the orchestrator verified and accepts

- **Sessions are a hard thirty days with no renewal** (`identity.rs:15`, `SESSION_MILLIS`; no `UPDATE _sessions` anywhere), so §4's "wipe on terminal `E_AUTH_SESSION`" erases every user's messages and outbox monthly. Fable. Wipe on sign-out or principal replacement only; seal the partition until the same principal re-authenticates.
- **Disappearing messages have no server mechanism.** `schedule` is refused (`parser.ts:71`) and rules cannot read time, so "the server refusing expired content" is a caller-invoked purge mutation, and §5's "no new mechanism" holds only if that mutation also writes the log's `delete` rows. Fable. This is a dependency of M5 acceptance 1 that lives outside 1012.
- **"Server OCC" does not exist in the invoked path.** The request carries no base version; `execute` reads the current seq, opens a transaction, and runs against current rows (`mod.rs:728-756`); a grep for OCC, base seq, or trace validation in the engine, the client store, and the writer finds nothing. The design has OCC as a per-table `merge` mode and as trace validation of intents; neither is built. So §7's "an offline edit to a row someone else edited comes back `rejected`" is false today: it overwrites unless the mutation authors a compare. Codex. Ruling 4's intent, that the server settles and no merge modes ship, survives either reading; its spelling needs one.
- **A client `issuedAt` is not evidence of age.** Codex and Fable independently: the 30-day rule needs a server-recorded time, either a replay grant minted at resume or the id block's allocation time.
- **Two tabs, one partition.** Nothing names a single writer across browser tabs; Snapback 1 hit exactly this. Fable. Web Locks on the partition.
- **Eviction is per swap, not per range.** A row that shifted from one page to the next would be evicted by one and re-added by the other; the rule is "held by no range after the swap". Fable.
- **Mounted queries execute twice on reconnect**, once in resume and once when `subscribe` reopens (`live.rs:117-146`). Fable and Muse.
- **View-once must be excluded at view time, not purged later**, or an offline cold start re-renders it. Gemini, both samples.
- **The drain has no stated depth or rotation.** A tail page subscribed at a fixed cursor never advances; "everything on the phone" needs a stated drain-to-`next: null` policy. Codex and Muse.
- **`delivered-history` rows may be kept and still unrenderable under O3**, because the twin re-applies the read rule through epoch-bound verdicts; the policy needs a twin-side meaning ("a held row of this table is readable; delivery was the authorization") or the content moves into the log row where the viewer's own uniform rule covers it. Fable. Consistent with LLP 1001's receipt model; not independently re-derived by the orchestrator.

## 4. Splits, routed to round 2 as design tasks

The author asked that round 2 contribute designs rather than a second flaw hunt. These are the places where the six disagreed on the *fix*, not the fact:

- **S1. The purge design.** (A) `delivered-history` only on the delivery log; message bodies held by point read; point absences evict bodies (grok). (B) Delete and expiry as log rows the app reacts to (Gemini, Muse). (C) Extent eviction on uniform ranges, no engine change (orchestrator's reading of `runner.rs:985`, Fable Q1). (D) Content in the log row; `until-revoked` suffices and `delivered-history` becomes a twin rule or is dropped (Fable). (E) An explicit `evictions[]` negative fact keyed to held ids (codex).
- **S2. Ids and replay.** Session id blocks (grok, Gemini A); client-minted ids validated at commit (Gemini B); intent-id dedup only with blocks deferred because the bar's writes are plain inserts (Muse, Fable); a server-minted replay grant carrying time and ids (codex).
- **S3. Resume scope and digest.** Re-authorize every held page under a cap of 256 (grok) or 32–50 (Gemini); or resume only the log's watermark plus mounted queries (Gemini, Fable); one canonical server-issued digest over state, result, `next`, generation, schema hash, and authority cohort, echoed opaquely by the client (grok, Fable, codex).
- **S4. What the server checks when it applies a replayed intent** — the OCC question (codex).

## 5. What the orchestrator ran

| Test | Result |
|---|---|
| §3 recipe, compiler worker, as written | refused: `E_QUARRY_SYNTAX` at the bare `.` |
| same with `delivery: .`, no `retain` line | accepted, 209 ms |
| same with `retain delivered-history` | refused: `E_QUARRY_SYNTAX` "expected ':', got 'delivered'" |
| `snapback2 check` (built binary, `a26f3434b`), `first 200` | refused: `E_BOUND` output bytes 3,456,012 > 1,048,576 |
| `snapback2 check`, `first 50` | ok, 19 operations |

## 6. Edits that need no debate (revision (b) takes them as written)

Recipe: `delivery: .` or `*`; page 50; `retain delivered` as one bare word, or a spelling round 2 proposes; the fan-out bound equal to the group cap, or a refusal past it; a stated drain policy. Wire: drop `want`; name `epoch` as the auth epoch and add `generation`; a server-issued digest the client echoes; `held[]` capped; "executed serially on the owner at one seq" instead of "one read transaction"; receipts without duplicate rows; absences on the wire gated on structural readability. Client: one `offline` option bag; `E_RETAIN_POLICY` moves to the `quarry` family; `E_OFFLINE_FENCE` becomes a `TypeError` like every other bad option; `StoreGeneration` or a seq instead of `Generation`; `ByteCache` off the O2 interface; `coverage()` returning rows, ranges, absences, and verdicts for O3 instead of `rows()`/`ranges()`; wipe on sign-out and principal replacement only; Web Locks across tabs; eviction "held by no range after the swap". Witness: split O2 (rows, outbox, kill during a swap, enqueue before the kill) from O4 (images, view-once, simulator); add carrier-refused boot and the 503-after-commit replay. Lanes: O1 freezes the wire receipt before O2 starts; O3 moves behind the bar if the author agrees; the certified program's wire custody is named as O1 work; the purge mutation is named as a dependency. Prose: §1's commit reference; LLP 1001's deferred list and LLP 0329.014.007 F11 are struck when O1 lands; "the store is at one version" becomes "every swap is atomic at a seq".

## 7. Proposed next step

Round 2 as a **proposal round** on S1–S4 plus improvements, per the author's instruction of 2026-09-04, all six panelists, same capsules, the brief at `1012-local-first-v1.panel.brief-r2.md`. Then revision (b) folding §6 and the round-2 designs, then a short blind READY check on (b). Three questions only the author can answer, to be put after round 2 with the panel's designs beside them: whether lane O3 runs behind the offline bar; what ruling 4's "OCC" is to mean in v1; and whether `delivered-history` keeps §5's row-only meaning or takes the twin-rule meaning with content in the log.
