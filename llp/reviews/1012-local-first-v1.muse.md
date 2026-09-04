# Panel: LLP 1012 — Local-first v1 (Muse Spark (Meta), served id `muse-spark`)

**Reviewed:** `llp/1012-local-first-v1.spec.md` as landed at `9ffdf6dd0`, in a read-only capsule exported from that commit, with the engine, wire, client, evaluator, compiler, templates, the design RFCs it implements, the brief, and the rules.
**Family:** Muse Spark (Meta), served id `muse-spark`
**Provider/runtime:** Muse CLI 1.0.2 (`muse exec --reasoning-effort ultra --approval-mode never --disable-write`), the `--model muse-spark-3.1` id was refused, so the default model served; self-reported as "Muse Code powered by Meta Muse Spark"
**Date:** 2026-09-04
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1012-local-first-v1.panel.brief.md`. The panelist could not write to the requested output path from its sandbox and staged the file in its own temp dir; the review below is its final message, verbatim, including that note. The orchestrating session authored LLP 1012 and is not a reviewer; it verified every engine claim below against the tree before the synthesis (`1012-local-first-v1.panel.synthesis.md`).

---

## Round 1 review (verbatim)

Note: the requested output path was not writable in this session (`Operation not permitted` on write to `/Users/ccheever/projects/snapback-1012-panel/out/`), so the review file is staged at `/tmp/muse.md` (112 lines, ~3,200 words) for the orchestrator to collect. The complete review follows verbatim.

---

Reviewer: Muse Code powered by Meta Muse Spark · Date: 2026-09-04 · Method: blind round-1, read-only capsule at 9ffdf6dd0

# LLP 1012 (Local-first v1) — round-1 panel review

## 1. Verdict: NOT READY

Three blocking findings: the `delivered-history` eviction rule keys off a receipt signal (per-row absence for range members, including expiry-as-absence) I could not verify the engine emits; `POST /api/resume` as specced (one read transaction at one `seq`, digest-compared) matches no existing wire, snapshot, or digest primitive and its digest is generation-unbound; and the id-block / pinned-replay / `issuedAt` machinery the 30-day intent rule needs does not exist in `Context`, the store, or the mutation wire. All three are fixable without touching the thirteen rulings. The rest is directionally sound — several sections are right and should survive.

## 2. Blocking findings

### B1. §5's eviction rule depends on absences the receipt never carries for range members

Spec claim: "`delivered-history` | rows not in the fresh result are evicted **only on a receipt absence**" (§5 table), plus "an expired message is an absence on the next resume of every range that held it" (§5, disappearing messages).

Evidence: `ClosureReceipt.absences` is point-keyed — `pub absences: Vec<(String, String, Vec<Value>)>` (`snapback2/crates/snapback2-core/src/engine/mod.rs:223-236`); `ReceiptRange` carries `row_ids`, `stop`, `absence: bool`, `halo` (`engine/mod.rs:191-208`) but no per-member absence list. LLP 1001 is explicit that under non-uniform rules range facts do not disclose and hidden rows "remain absent from the receipt" (`llp/1001-query-engine.spec.md:174-208`), and the twin-side check (`snapback2-core/src/client.rs:117-139`) only tests absences against point lookups. I found no code or spec text where a range re-execution emits an absence for a formerly-present member id, and no expiry concept anywhere in LLP 1001 or the engine — expiry-as-absence is asserted only by 1012 §5 itself.

Why it blocks: lane O2 cannot implement the §5 table as written — the "only on a receipt absence" arm never fires for range members, so `delivered-history` degrades to keep-forever and the app's log-`delete` row becomes the only purge path, which the spec never states. Expired/disappearing content then relies on app code the recipe does not write.

Resolve: either (a) define absence emission for certified-uniform exhausted ranges (a missing member of a uniform `Exhausted` range is provably deleted, not hidden — 1001's uniformity certificate already supports this distinction), with a test that a deleted interior row produces one; or (b) change the rule to generation-swap diffing and say the log-`delete` row is the prompt purge while swap-diff is the backstop. Either way, cite the mechanism.

### B2. §8's resume has no counterpart in the tree, and its digest compares the wrong thing

Spec claim: "The server re-executes every held `(op, args)` in **one read transaction** at one `seq` … returns either `unchanged` when the fresh delivery's digest equals the client's (the digest the subscription machinery already computes, LLP 1000 'state-aware digests')" (§8), shape `POST /api/resume { epoch, held: [{ op, args, seq, digest }], want: 'receipt' }`.

Evidence: no `/api/resume` route exists — `serve.rs` routes exactly query, mutation, subscribe, manifest, auth, channels, upload, asset (`snapback2/crates/snapback2/src/serve.rs:344-486`). The existing digest, `delivery_digest`, hashes `(state, result)` only (`snapback2/crates/snapback2-core/src/live.rs:17-19`) with no generation/schema binding, and lives as per-subscription in-memory `last_result_digest` (`live.rs:47-52,117-148`), not as a client-comparable primitive. Execution takes `&mut self` through the single serialized writer (`writer.rs:21,76-77,324-336`; all HTTP actions funnel through `handle.call`), and I found no snapshot/read-transaction primitive pinning one `seq` across N sequential re-executions — a commit landing mid-resume moves `seq` between held ops, so "at one seq" is unimplementable as spelled.

Why it blocks: a generation change with identical data compares digest-equal, yielding false `unchanged` — the client keeps a stale receipt (`rule_hash`, `schema_hash`-bound absences) it believes freshly re-authorized. That is a correctness bug in re-authorization, the one thing resume exists for. Without a one-`seq` snapshot, revocation re-authorization is not atomic either.

Resolve: bind the digest to `(generation, state, result)` (and document whose `epoch` the request/response carry — auth epoch and generation differ and §8 uses `epoch` bare); define the one-`seq` mechanism (pin `commit_seq` plus snapshot reads, or refuse interleaved commits for the resume on the single writer); page the resume — fifty conversations with held pages is hundreds of `(op, args, digest)` in and full changed pages out of one response.

### B3. §7's id blocks and intent-age enforcement have no plumbing to land on

Spec claim: "On every successful resume the server allocates the session a **bounded id block** … on replay the server applies the intent with its pinned ids through the hook LLP 1001 §8 already names ('deterministic replay contexts may inject their pinned ids directly')" (§7), and "an intent whose `issuedAt` is older than 30 days is refused `E_INTENT_EXPIRED`" (§5/§7).

Evidence: the hook exists only narrowly — `Context.new_ids: VecDeque<String>` (`engine/mod.rs:17-27`) plus the 1001 sentence that replay contexts "may instead inject their pinned ids directly" (`llp/1001-query-engine.spec.md:611-618`), fed today from a committed high-water mark (`store.rs:294`, `registry.rs:510-511`). There is no session, no block allocation, no `E_ID_BLOCK`, no block-membership check, no `issuedAt`/`issued_at` anywhere in `Context`, the store, or the mutation wire (grep over `engine/mod.rs`, `store.rs`, `registry.rs` finds only `new_ids`), and no replay envelope — replay is "one intent per request" (§7) but no request shape carries pinned ids or `issuedAt`, so the server cannot distinguish replay from fresh mutation.

Why it blocks: `E_INTENT_EXPIRED` and pinned-id replay cannot be built as specced — O1 must invent the session/block store, the replay wire, and the `Context` fields with no design. The named failure shapes (block exhausted, device wiped, two-device race) are undesigned: a wipe rotates the id namespace (`store.rs` `_meta` namespace), orphaning pre-wipe pins with no specified server behavior.

Resolve: define the replay envelope (mutation request carrying `intentId`, `issuedAt`, `pinnedIds`), the `Context` additions, the per-session block allocator over the existing high-water mark (or defer blocks — see M8), and wipe/race semantics. At minimum specify server-side dedup on `intentId`: §7's "a 503 after a commit must never look like a rejection" keeps the intent `queued`, so retry replays a committed send — without idempotent re-application keyed on intent id, offline retry double-sends.

## 3. Material findings

### M1. The delivery-log recipe cannot carry edits and has no reactions shape

Claim: "Edits and deletes are further log rows (`kind: 'edit' | 'delete'`), which is how a phone learns of them" (§3). The `deliveries` table's immutable columns are `recipient, conversationId, messageId, kind, at` — no body/new-text column, so an `edit` row cannot propagate content; and no reactions shape exists, though M6 offline writes queue "likes and reactions" (brief §M6 spec) and toggles must be idempotent set-state intents (brief Global rulings). Fix: add the edit payload (or point at the mutated `messages` row plus its receipt) and a reactions shape before the `chat` template adopts the log.

### M2. The fan-out `for` is grammar-adjacent but unverified, and `first 50` is a silent membership cap

Claim: the `send` fan-out `for m in memberships[conversationId] first 50 by byConversationPrincipal:` "to be verified by `snapback2 check` in lane O2" (§3). `parseFor` accepts an explicit binding and an expression domain to `:` (`parser.ts:498-506`; `generatedBinding` reads a user word, `parser.ts:330-343`), and range-postfix (`first N by`) exists for reads (`parser.ts:742`) — but the only range-in-`for` precedent is the separate merge-lane grammar (`feeds.q:13`), while statement-`for` precedent iterates a list argument (`groups.q:8`). I could not verify a statement-level `for` over a range-read domain lowers to `LoopDomain::Page`. Separately, `first 50` silently drops member 51+ with no diagnostic. Fix: verify-or-repair the lowering in O1 before O2 builds on it, and refuse-or-page fan-out beyond the bound instead of truncating. (Budget fit is fine: ~51 writes vs the 2,048 default ceiling, `certificate.rs:28,41,341`.)

### M3. `receipt=1` on every subscription frame roughly doubles subscription bytes

The closure receipt embeds full rows (`RowRecord { table, id, row: Value }`, `engine/mod.rs:88-92`) alongside `data`, on "every response and frame" (§8). No `receipt=1` handling exists on the wire today (responses are `{state,data,seq,next}`, `llp/1002-dev-loop.spec.md:378-380`; `serve.rs` has no receipt parameter). Per chat-thread frame, data + receipt.rows is ~2x. The receipt is serializable as-is (all-`Serialize`; its missing generation binding is B2's bug, not size). Keep it, but add the generation binding and consider ranges+absences+verdicts per frame with rows only where the frame's data does not already carry them — or measure first per §14 and let the number decide.

### M4. Resume-at-scale serializes on the single writer with no paging

Even fixed per B2, fifty held pages means hundreds of sequential certified re-executions inside one writer action while mutations queue behind it (`writer.rs` single `mpsc` pump; HTTP worker classes bound SSE/upload/control in `serve.rs:146-208` but JSON/query shares the one pump). Per-op bounded (certified ceilings), but time-to-fresh for the Clique inbox will be seconds of owner stall per reconnect, and one giant response risks transport limits. Fix with B2: page the resume (held-set chunking with a continue token) and record the §14 reconnect-bytes number as the gate for candidate 3, as the spec already intends.

### M5. The witness proves durability, not atomicity, and skips the adversarial cases

The §10 kill witness is the right bar and learns from Snapback 1's unqualified carrier (`issues/20260806-…`, `guide/sync/offline-and-retention.md`). As written it kills at rest (proves the last swap persisted) but never kills mid-`swap` (the atomicity claim in §4: "a crash mid-swap leaves the previous generation intact"), never exercises the `E_OFFLINE_CARRIER` refusal path, never asserts view-once bytes never touched disk (brief Global rulings: "view-once media is never durably cached at all"), and never crosses a generation/successor boundary (where `client.rs:162-171` clears absences). Strengthen: kill-during-write, carrier-refused boot, disk-scan for view-once bytes, post-upgrade cold start.

### M6. Cold global search needs a drain depth the spec never sets

M6 acceptance 1 requires synced-message search cold-offline (brief §M6 acceptance 1); §6's offline search filters held rows. But held rows are only pages the app drained online, and the delivery-log inbox must be paginated to arbitrary depth to make global search complete. The spec never says how deep the seed drain goes, so cold search is partial-by-construction with no label for the unheld tail (the `held` completeness label is deferred, §6). Fix: define the seed-drain policy (e.g. drain inbox to N pages, scope-label the "in downloaded messages" result) so M6's search probe is deterministic.

### M7. Lane O2 builds against an O1 receipt "stub" that O1 may move

O1 owns "receipt … receipt=1 … resume … id blocks" while O2 builds "row-per-range rather than an opaque blob" (§8) "parallel with O1 against a stub" (§12) — and row-per-range is exactly what B1–B2 may reshape (absence emission, generation binding). Freeze the receipt wire shape (with B1/B2 resolutions) as O1's first deliverable and hold O2 to it, or O2's store gets rewritten mid-lane. Related: O3 inherits the evaluator-wiring ticket's acceptance list (§6), an external dependency with no owner named here — name its owner or O3 has no entry condition.

### M8. Id blocks may not be needed for the bar at all

M6 acceptance 2 is two messages in an existing chat — plain inserts, no cross-intent id references. Blocks plus pinned replay serve create-group-then-send-offline, which no cited acceptance exercises. Given B3's cost (session allocator, replay wire, `Context` surgery), defer blocks to "when a brief asks" (§11 already holds harder things for less reason) and replay offline sends as ordinary mutations with client-generated `intentId` dedup (B3's fix, which the bar needs for 503-retry safety). Keep the `Context.new_ids` queue; drop the session-block allocator from v1. (If the author wants offline group-create in v1, record that ruling.)

## 4. Minor findings

- `want: 'receipt'` (§8) is a constant masquerading as a parameter — delete it; `receipt=1` already negotiates.
- `epoch` in the resume response (§8) is ambiguous (auth epoch vs generation vs `seq`); the wire already has `seq` and the manifest has `generation` (`llp/1002-dev-loop.spec.md:372-383`). Name both or drop it.
- `page { ., message: messages[.messageId] }` (§3): bare `.` has no precedent — `feeds.q` shapes pages as `page { post: ., author: … }`. Use a named field or verify bare-`.` parses.
- The `offline` family (`E_OFFLINE_CARRIER`, `E_OFFLINE_FENCE`, `E_RETAIN_POLICY`, `E_INTENT_EXPIRED`, `E_ID_BLOCK`) follows the family+rewrite+page convention with O1 promising its page. Prefer a single `E_OFFLINE_*` prefix for all five: observed runtime codes group by subsystem (`E_SCHEMA*`, `E_RULE`, `E_OP*`, `E_BOUND*`, `E_STORE*`, `E_AUTH*`, `E_ASSET*` across `snapback2-core/src`), and all five are one subsystem's codes.
- `retain <policy>` as a table-block line fits the schema dialect (`immutable`, `read <-`, `schema.q`); `fence: { days }` and `maxAssetBytes` as client options are correctly client-side (the server needs only the 30-day constant). Nothing to move.
- "IndexedDB gives this per object-store transaction" (§4) is backwards: IndexedDB transactions can span stores; the real constraint is no interleaved awaits. Reword; cover the expo-sqlite/IndexedDB atomicity difference in the witness (M5).
- Twin-size number: NOT-DOING claims a 9.7 KB gzip twin while `evaluator.ts` alone is 1,556 lines / ~14 KB gzipped as source. Build/minification may explain it; §14 already plans the measurement — ensure it measures the shipped bundle, not source.
- Could not verify, as instructed saying so: the eight-candidate mapping against `llp/0329.014.008` in full (checked §11's table against candidate titles only), and LLP 1000's "state-aware digests" phrase (did not read LLP 1000 whole; the digest verified is `live.rs:17-19`).

## 5. Answers to the eleven questions

1. **Absent vs hidden.** No — not for rows inside a range. Point reads have absences (`engine/mod.rs:223-236`; `client.rs:117-139`), but range interiors under non-uniform rules deliberately carry no absence signal (1001 §3; hidden rows "remain absent from the receipt"). §5's fallback (keep, mark range with age) is safe for availability but wrong as a steady state for revocation: without B1's fix, deleted/expired rows kept as "history" have no verified eviction event, so a messenger accumulates revoked content offline and its local search keeps returning it. Right design: absence emission on uniform-exhausted ranges (B1, option a).
2. **Resume protocol.** Not bounded where it matters: per-op bounded (certified ceilings) but unbounded in count (hundreds of re-executions), unpaged in response size, unpinned in `seq` (no snapshot primitive; single `mpsc` writer, `writer.rs:21-336`), and dishonest across generations (digest excludes generation, `live.rs:17-19`). Fifty conversations / two hundred held pages costs hundreds of sequential full query executions on the thread that also serves mutations. A read transaction is the right unit only as a pinned snapshot; otherwise it is a long write-excluding lock by another name. Missing: generation in the digest, named `epoch`s, resume paging, `idBlock` sizing, per-range `next` cursors.
3. **Ids.** The narrow hook exists (`new_ids` queue, `engine/mod.rs:23`; inject-pinned sentence, 1001 §8; high-water-first reservation, `store.rs:294`). Nothing else does: no session, block, exhaustion error, wipe/race semantics, replay wire, or `issuedAt` field. Failure shapes today: exhaustion impossible (ambient ~1,024-id reservation, `tests/store.rs:449-450`); a wiped device silently mints a fresh namespace orphaning old pins; two devices share one principal high-water mark with no disjointness rule. All need B3's design.
4. **Receipt on the wire.** Serializable yes (all-`Serialize`), generation-bound no (B2), small no — full `RowRecord` rows duplicate `data` on "every response and frame" (§8). Cut rows where `data` already carries them, or make full receipts resume/query-only; add generation; keep `schema_hash`-bound absences and verdicts (the custody the evaluator ticket needs).
5. **Delivery-log recipe.** Mostly compilable-shaped (table dialect; `enum('…')` single-quote style per `schema.q:33`; `text <=4000`; multi-column `immutable` per `schema.q`; `c: cursor ?` per guide p.120) but: statement-`for` over a range domain is unverified (M2); `first 50` truncates silently; `retain …` has no grammar yet (expected O1 work); bare `.` in the page shape is unprecedented (`feeds.q` uses named `post: .`); one range covers inbox + thread + search-over-held only with a deep drain (M6), and reactions/edit-content/view-once need M1. It is not a replica by another name: N× fan-out rows are app-authored denormalization inside certified programs and the client holds only dealt receipts — F11 survives. The N× write amplification still deserves a §14 number.
6. **Outbox/prediction.** `queued → committed | rejected | expired` plus orthogonal `predicted` is the right minimal machine and matches 1002's reserved `queued` (`llp/1002-dev-loop.spec.md:658`). Same-carrier-transaction is achievable on IndexedDB in one multi-store synchronous transaction (the spec's phrasing is backwards, see Minors). FIFO-with-independent-settlement is honest for idempotent toggles and plain sends, but yields user-invisible states at the edges: head-of-line stall behind one failing intent, `expired` vanishing with no server trace, and dependent-intent confusion (create-rejected, send-to-nothing still replays). Needs the B3 dedup rule and UX copy for `expired`/stalled drain.
7. **Fence.** I found no runtime/certificate code assuming any fence reading (no `maxOfflineAge`/fence concept outside 1012; `Context` has no such field), so the trust-only reading arrives clean. The server needs the client's fence number for nothing; it needs only its own 30-day constant, which needs B3's `issuedAt` plumbing to enforce.
8. **Spellings.** Consistent: `retain` belongs in schema (table-block line, matching `immutable`/`read <-`); `fence`/`maxAssetBytes` belong client-side; the five-code `offline` family follows the family+rewrite+page rule with O1 promising its page. Nits in Minors (single prefix; drop `want`; name `epoch`).
9. **Carriers/witness.** The §4 interface is close to minimal — `open/wipe/swap/answer` for O2, `rows/ranges` joining at O3, `outbox`/`assets` attached — though `swap(gen: Generation)` names a `Generation` type never defined here. Loud `E_OFFLINE_CARRIER` is the right lesson from Snapback 1's silent memory fallback. The witness misses kill-during-swap, carrier-refused boot, view-once-bytes-on-disk, and post-upgrade cold start (M5).
10. **Lanes/trade.** Order is right (wire → store → twin → bytes) but O2-against-a-stub while O1 may reshape the receipt (B1/B2) invites a mid-lane rewrite — freeze the receipt shape first (M7). Nothing in v1 is gratuitous except possibly id blocks (M8: defer). For the bar as stated (M5acc5 + M6acc1–2 + witness), M1's reactions/edit-content and M6's drain depth are the likeliest missing pieces; push seam / custom-client API / scale adapter are M6-but-not-bar and correctly excluded.
11. **Surface to delete.** `want: 'receipt'`; bare `epoch`; the session id-block allocator (defer per M8, keep `intentId` dedup); silent `first 50` truncation (refuse or page); any server use of the client's fence number (none — keep it that way). Everything else in v1 (two policies, FIFO+flag, digest resume, `ByteCache`+one ceiling, witness) earns its place against the bar.

## 6. Strengths (do not lose these)

Result-cache-not-replica discipline with the receipt as the single coverage truth; trust-not-reading fence closing the old ambiguity cleanly; `unchanged`-by-digest as the cheap refinement of decision 5 keeping candidate 3 deferred behind a measurement gate; prediction-as-overlay excluded from digests and discarded on settle (the right isolation); bytes-under-the-row's-lease with one-use refusal (privacy-by-construction answering the brief's view-once rule structurally); loud carrier failure instead of silent memory fallback; the §11 decline-table plus §14 measurements making every deferral falsifiable; the trade written into NOT-DOING's Moves ledger the same day.

## 7. Open questions for the author

1. Is offline group-create (the only shape needing id blocks) in v1, or do blocks defer per M8 with `intentId` dedup only? (Load-bearing for O1 scope.)
2. What is the seed-drain depth for cold global search (M6), and is partial-scope search labeling acceptable in the bar?
3. May statement-`for` fan-out beyond its bound refuse rather than truncate (is a loud large-group send acceptable)?

## 8. What I would build first if I owned lane O1

The receipt wire shape, frozen, before anything else: generation-bound digests, `receipt=1` on query/subscribe, absence emission for uniform-exhausted ranges with a regression test proving a deleted interior row produces one, and the replay envelope (`intentId`, `issuedAt`, pinned ids) with server-side `intentId` dedup — because O2's store layout, §5's eviction table, and §8's resume all type-check against that shape, and B1–B3 show it is the least-defined load-bearing surface in the spec. Everything after that (retention lines, resume paging, blocks-or-deferral) becomes mechanical.

---

Delivery note: the file could not be written to the requested `OUT` path (sandbox denied the write); the identical content is staged at `/tmp/muse.md` for collection.



---

## Round 2 — proposals (2026-09-04, later the same day; verbatim)

**Method:** round 2 on the brief preserved at `1012-local-first-v1.panel.brief-r2.md`, which carried the orchestrator's verified round-1 synthesis and asked for designs rather than critique, per the author's instruction. Muse Spark, same runner as round 1. It reported that it could not re-verify `path:line` citations this round and drew engine facts from the verified synthesis; its Quarry sketch in §1 is not valid Quarry and is recorded as a sketch.

Reviewer: Muse Code powered by Meta Muse Spark · Date: 2026-09-04 · Method: round 2, proposals, read-only capsule at 9ffdf6dd0, after the verified round-1 synthesis

Note on method: the capsule layout in front of me renames the round-1 paths (crates are `snapback-engine`, `snapback-server`, etc., not `snapback2-core/src/...`), so I could not re-verify `path:line` citations this round. Every engine fact below is taken from the orchestrator's verified round-1 synthesis and I flag anything I did not independently observe.

## 1. The purge design: tombstones in the log, extent as garbage collector

**Design: (B) primary, (C) backup, point-absences for bodies only.** The messenger phone learns a message is gone from a positive, certifiable fact — a tombstone row in the delivery log — and uses extent reasoning only as a garbage collector for tombstones that have themselves aged out. No engine change.

The log is already the one range the messenger holds that is certified-uniform (round-1 U1: only uniform ranges carry an extent fact, `runner.rs:985-987`, and the messenger's ranges are uniform). So put the negative signal where positive facts already flow: the server-side purge mutation that deletes or expires a message (round-1 §3: schedule/time rules don't exist, so expiry is a caller-invoked purge mutation) **also writes a `delete` row into the log for that message id**. The app holds the log tail as a uniform range, sees the tombstone inside certified bounds, and drops the body locally. Message bodies themselves are held by point read, so a re-point-read that returns an absence confirms the drop (round-1 U1: point reads of missing rows record absences, `runner.rs:671-688`).

What the app author writes (valid-syntax sketch, no bare `.`, no `retain` line):

```
table log {
  shape { id: ., kind: ., ref: ., at: . }
  read recent(thread): where thread == $t order by at desc first 50
}
table messages {
  shape { id: ., body: ., sender: . }
  read one(id): where id == $id
}
```

plus a twin-side rule, in JS, not in Quarry: "when a held `log` row has `kind == 'delete'`, evict the held `messages` row whose id equals `ref`; when a held id sits inside a fresh uniform log extent's bounds and is missing from its `row_ids`, evict it too." The second clause is the (C) backup: it can only fire on uniform ranges with an exhausted stop, which is exactly the certified extent claim, so it never invents a deletion.

State machine per message id: `live → tombstoned → evicted → (tombstone aged out, extent confirms absence) → forgotten`. Eviction is evaluated per swap over the whole held set ("held by no range after the swap," round-1 §3), never per range, so a row sliding between pages is not flapped.

What it costs: one extra log row per delete/expire (tens of bytes), one uniform range the app already holds, zero new engine facts. What it pays: M5 acceptance 1 and M6 acceptance 1 pass with today's receipt model — the deletion arrives as data inside certified coverage, so `delivered-history` never has to infer an absence from silence. After this design, `retain` means nothing in the engine: `delivered-history` becomes a twin-side retention policy ("keep this table's held rows until a tombstone or an extent says otherwise") and the `retain` spelling can be dropped from Quarry entirely. The engine does not change; the missing piece lives outside 1012 (the purge mutation that writes both the delete and the log row, round-1 §3).

Alternative rejected in one sentence: an explicit `evictions[]` negative fact keyed to held ids would work but mints a brand-new engine-signed negative claim with its own binding, replay, and authorization questions, which is more surface than a tombstone row that reuses the existing certified-row machinery.

## 2. Resume a phone would love

**Design: watermark-first resume with an opaque server-issued digest, cap 32, one owner action for the common case.**

The client sends three things and nothing else:

```jsonc
POST /api/resume {
  "watermark": {"logTail": 4812, "generation": 7},
  "mounted": [{"table": "log", "name": "recent", "args": {"t": "c:9"}, "cursor": null}],
  "digest": "opaque-string-the-server-minted-last-time"
}
```

`watermark.logTail` is the last log offset the phone applied; `mounted` is the queries with open subscriptions (not all few hundred held pages — only mounted ones, typically under a dozen for a fifty-conversation inbox showing a list plus one open thread); `digest` is echoed opaquely, never parsed.

The server runs, in order: (1) authenticate and compare `auth_epoch` — on mismatch, held verdicts are dead (round-1 U2: verdicts bind to `auth_epoch`, `mod.rs:213-220`), so reply `reauth` with no data; (2) compare generation/schema hash — on mismatch, reply `recertify` and the client re-runs `check` once, rather than the server pushing rows the twin would clear on schema mismatch anyway (`client.rs:162-171`); (3) read the log tail from `watermark.logTail` — if empty, the watermark makes everything a no-op: reply `not-modified` plus a fresh digest, one owner action, no page re-execution; (4) only for conversations touched by the new tail rows, re-authorize the mounted queries covering them, up to a cap of 32 pages per resume — anything beyond the cap returns `truncated: true` with the next cursor and the client pages it as ordinary reads.

The one canonical digest is minted by the server at the end of a successful resume or read and covers: the result rows, `next` cursors, generation, schema hash, `auth_epoch` cohort, and the log watermark it is valid through. It is HMAC'd server-side; the client stores and echoes it. It binds data to authority, which fixes round-1 U2's complaint that `delivery_digest` covers only `(state, result)` (`live.rs:17-19`) and `frame_digest` covers only the frame minus `seq` (`writer_values.rs:56-61`): neither names who authorized it or what schema certified it.

`held[]` gets a bound as part of the same change: the server keeps at most N unverified held entries per session (say 256) and resumes oldest-first; beyond that it returns `held-overflow` and the client re-subscribes. That kills both the stall and the denial of service in U2.

Cost for the Clique inbox (fifty conversations, drained log, a few hundred held pages, reconnect after an hour with ~40 new messages): the common case is one owner action holding the exclusive lock for a single-digit-millisecond tail read, response ~40 log rows plus re-authorized pages only for the ~6 touched conversations, roughly 20–60 KB on the wire. The pathological case (re-login with new `auth_epoch`) is a bounded 32-page re-authorization, a few hundred KB, with explicit truncation instead of an unbounded stall. I could not verify exact owner timings against this capsule's renamed crates; the shape of the cost (one serialized owner action per resume, `writer.rs:70-82`, one seq by serialization) follows from round-1 U2.

Rejected alternative in one sentence: re-authorizing every held page under a cap of 256 treats cold storage as live state and re-executes hundreds of queries to re-prove answers nobody is looking at, when the watermark already proves all but the touched ones unchanged.

## 3. Ids and replay, the smallest correct scheme

**Design: client-minted UUIDv7 ids validated at commit, plus server-side intent-id dedup; no id blocks.**

Every offline insert mints its own id on the device: UUIDv7 (time-ordered, 128-bit random tail). The server validates at commit that an id in the client-mint space is well-formed (version bits + not previously allocated to another principal's live row) and otherwise treats it as an ordinary primary key. Dependent intents reference these ids directly — no reservation round-trip, no block to exhaust, works offline indefinitely.

Replay safety comes from a separate dedup table, required by the bar's own writes independent of id blocks (round-1 U3): `(principal, intent_id) → result`, retained 30 days alongside the session. The mutation wire shape:

```jsonc
POST /api/mutation {
  "intent_id": "uuidv7-minted-once-per-user-action",
  "op": "send_message",
  "args": {"id": "<client-minted row id>", "thread": "c:9", "body": "..."},
  "parent_intent": null
}
```

Server behavior: if `(principal, intent_id)` is in the dedup table, return the stored result with `"deduped": true` and apply nothing — this is what makes the 503-after-commit retry safe. Otherwise execute once, store the result, return it. `Context.new_ids` injection point changes minimally: `mutation_context` (`writer_auth.rs:152-156`) stops unconditionally overwriting `context.new_ids` from the store's 1,024-block reservation and instead accepts client-supplied ids that validate, minting server-side only for ops that declare they need one and didn't supply it. The reservation machinery and the `RuntimeError::Input("newId envelope exhausted")` path (`runner.rs:392-397`) stay for that legacy case but leave the hot path.

Failure shapes, each a plain response, no new verbs: **device wiped** — safe by construction; fresh randomness never collides, and the new session has an empty dedup table, so rewrites are new intents (a wiped outbox is data loss at the edge, honestly reported as such, not a correctness bug). **Two devices of one principal** — ids never collide (random tails); the same user action performed on both devices is two intents and applies twice, which is correct because they were two actions; one action retried across a device restore dedups only if the `intent_id` survived, otherwise it is honestly a new intent. **Parent intent rejected** — dependents carry `parent_intent`; if the parent's `intent_id` maps to `rejected`, each dependent short-circuits to `rejected` with `cause: "parent-rejected"` without executing, so a failed send never orphans its attachment rows. **Duplicate delivery** — returns the original result bytes with `deduped: true`, including errors: a retry of a rejected intent returns the same rejection, never a second row.

What it costs: one indexed dedup table with TTL, ~16 bytes plus result per intent, and id validation at the commit boundary. What it pays: the bar's plain inserts become replay-safe with zero offline round-trips and zero block bookkeeping on the client.

Rejected alternative in one sentence: session-issued id blocks add a reservation round-trip before any offline work, an exhaustion failure mode, and two-device contention over block ownership, all to solve an allocation problem random ids solve without coordination.

## 4. Make it feel like WhatsApp

Ranked by user-visible payoff per unit of surface. All three stay inside NOT-DOING: no merge modes, no replica semantics, no new authorization model — they are harness, convention, and policy over the existing result cache.

**#1. `snapback2 test --offline`: cut the network and assert what the phone still shows.** A test-harness primitive: the harness runs the recipe's thread screen, severs the test network partition, performs a scripted kiosk action (send, delete elsewhere, expire), and asserts on the held render — e.g. "after partition, the thread still renders 50 rows from cache; the outbox badge shows 1 queued; on heal, the tombstone arrives and the row is gone." What it is: three flags (`--partition`, `--assert-held`, `--heal`) plus a held-render snapshot comparator reusing the existing `check` output accounting. Surface cost: one CLI surface, zero wire bytes, zero engine surface. What it pays: it turns every offline acceptance claim (M5/M6) into a runnable test an agent can write before implementing, which is the highest-leverage thing for the primary user (the agent building the app). Proof: land three tests — offline thread render, tombstone-on-heal eviction, 503-retry dedup — and require them green in CI for the messenger demo.

**#2. Pending-from-args: the outbox renders from intent arguments, with a four-state UI contract.** Today pending renders from arguments only by convention (round-1 §3 mentions it) and there is no stated UI state, so every agent reinvents "sending…". The improvement: a documented client hook — any queued intent with `args` matching a mounted query's shape renders optimistically as `pending`, and every pending row carries exactly one of `queued | sent | acked | failed`, with `failed` always offering the same `retry` verb that reuses the original `intent_id` (so retry dedups per §3 of this doc). Cost: documentation plus a tiny client helper (~100 lines), zero wire bytes beyond the existing intent. Pays: removes a whole class of confusion ("did my message send?") and a whole class of agent bugs (double-send buttons, invented spinners). Proof: a harness test that queues two sends offline, asserts both render `queued` from args alone, heals, and asserts both flip to `acked` with no duplicates.

**#3. Drain-to-`next: null`: a stated tail policy plus a thread prefetch recipe.** Round-1 §3: a tail page at a fixed cursor never advances, and "everything on the phone" needs a stated drain. The policy: a subscribed tail drains forward on every heal and on every new tail row until `next: null`, then parks; the messenger recipe prefetches the open thread's next page when the user scrolls within five rows of the end. Cost: a paragraph of policy plus the recipe's prefetch lines; bytes are bounded by the cap from §2 of this doc (32 pages per resume, ordinary reads after). Pays: the inbox badge and the thread bottom are always fresh without the agent hand-rolling polling, and cold start shows the list instantly from held answers while the drain fills gaps. Proof: a harness scenario asserting that after healing with 200 new log rows, the tail subscription advances to `next: null` within the cap and the visible thread never shows a stale bottom.

Ranking: #1 first because untestable offline claims are how M5/M6 fail silently; #2 second because it fixes the single most-seen messaging confusion with no new surface; #3 third because it is policy text that pays off only once #1 can prove it.

## 5. Steal one thing

**Steal ElectricSQL Shapes.** A Shape is a named, parameterized server-side query with an opaque offset handle: the client subscribes, gets initial rows plus a handle, then re-requests with the handle and receives exactly the delta — rows upserted or deleted since that offset — or `up-to-date`. That is precisely this design's delivery log plus watermark (§2 of this doc), except the handle is opaque and canonical where my `watermark + echo-digest` is two correlated values the client must keep in sync.

Why it fits the principles: a Shape is a certified result cache, never a replica — the server re-authorizes every delta against the read rule before shipping it, which is the certificate-as-gate; the client holds answers plus coverage (the handle), and the protocol answers are exact rows or an explicit `up-to-date`, never invented state. It slots into the receipt model without disturbing it: the shape handle *is* the digest, minted server-side over rows, cursors, generation, schema hash, and authority cohort.

What it would replace: the bespoke `watermark`/`digest`/`generation` trio in my §2 sketch collapses to one opaque `shape_handle` per mounted query plus the log-tail shape that subsumes the rest. Resume becomes "re-request each mounted shape with its handle," the server's fast path becomes "handle still valid → delta or `up-to-date`," and the generation-change and re-auth cases become handle-rejection reasons (`stale-generation`, `stale-authority`) with the same truncated re-subscribe the cap already provides. Net effect: less client bookkeeping, one round-trip shape, identical semantics — simpler and better.

## 6. Cut

To make v1 simpler against the offline bar as stated, remove:

1. **Engine `delivered-history` retention.** Per §1 of this doc it becomes a twin-side policy over tombstones and extents. Unblocks: deleting the `retain` lexing/certification surface (which does not compile today, round-1 U4) and the entire "infer absence from silence" semantic that fails M5/M6.
2. **Lane O3 (search/index work).** The orchestrator already agrees it is not needed for the bar: cold-start reads are held answers, search is an app filter, pending renders from arguments. Unblocks: O1/O2 landing without a second index or read-rule change.
3. **The duplicated receipt knobs: `want: 'receipt'` and `receipt=1`.** One spelling (the query param) or none — and per round-1 U5's disclosure finding, point-read absences must not be observable through `receipt=1` anyway, so the receipt needs a redesign before it needs two spellings. Unblocks: freezing the wire receipt shape for O2.
4. **`fence: { days }` beside flat `maxAssetBytes`, and `assets` on the O2 interface.** Two spellings for one retention bag, and O2 coupled to O4's asset story before either is frozen. Cut the fence spelling and the O2 asset field; assets ride the log like any other row. Unblocks: a one-bag retention policy and a clean O2/Twin seam.
5. **`swap(gen: Generation)` and bare `epoch`.** Rename to `swap(generation: …)` against the engine's own `Generation` type and split `epoch` into `auth_epoch` / `generation` everywhere. Unblocks: ending the ambiguity that already deadens held verdicts silently on re-login.
6. **Full-page resume and unbounded `held[]`.** Replaced by §2's watermark-first resume with cap 32 and a bounded held set. Unblocks: predictable reconnect cost and the DoS/staleness hole.
7. **View-once byte exclusion from v1 scope.** Round-1 U6: it has no owner and one-use delivery is deferred in LLP 1006; the only correct rule (exclude at view time, round-1 §3) is stated policy, not mechanism. Unblocks: claiming M6 honestly without a mechanism that does not exist.

None of these touch the bar: plain inserts with replay safety, tombstone-driven purge, watermark resume, and a frozen receipt cover every acceptance clause.

## 7. Lane O1 on one page

Goal: freeze the wire receipt shape so O2 can build the twin against a stub that will not move. Land in this order:

1. **Receipt shape freeze (types only).** Define `ReceiptV1` in one file: `rows` (page rows, as today), `row_ids`, `stop` + `exhausted`, `absence: bool` (whole-range only — document that per-row absences never ship), `schema_hash`, `generation`, `auth_epoch`, `server_digest` (opaque HMAC over rows, `next`, generation, schema hash, authority cohort). Delete `want: 'receipt'`; keep one `receipt` spelling. No behavior change yet — O2 stubs against this file.
2. **Digest mint/echo (server).** Mint `server_digest` at the end of reads and resume; accept and verify the echo; reject with `stale-authority` / `stale-generation` reasons. Tests: digest verifies after no-op; fails after re-login; fails after schema bump.
3. **Intent dedup table + wire fields (server).** `(principal, intent_id) → result`, TTL 30 days; `POST /api/mutation` accepts `intent_id` (+ optional `parent_intent`); duplicate returns stored result with `deduped: true`. Tests: 503-after-commit retry returns identical bytes, one row; parent-rejected short-circuits dependents.
4. **Client-minted id validation (server commit boundary).** Accept well-formed UUIDv7 ids in the client space; `Context.new_ids` stops overwriting caller ids. Tests: offline-minted insert applies; malformed id rejected; double-submit same id collides honestly as `rejected`, never as a second row.
5. **`POST /api/resume` (server route).** Watermark-first per §2: `reauth` / `recertify` / `not-modified` / `delta` + cap-32 truncation. Tests: no-op resume is one small response; touched-conversation delta only; truncation cursor round-trips.
6. **Twin tombstone rule (client).** Apply log `delete` rows to evict held bodies; extent-confirm on uniform ranges; per-swap evaluation. Tests: delete-on-heal evicts; expired row evicts; page-slide does not flap.
7. **Harness `--offline` primitive + three acceptance tests (tooling).** Partition/heal/assert-held; tests for offline render, tombstone eviction, retry dedup. This is the gate that declares O1 done and O2 unblocked.

Files (against this capsule's actual layout — I could not verify exact paths, so these are placements to confirm): receipt type beside the engine receipt definitions; digest helper beside the writer values; resume route beside the existing API routes; dedup migration beside the store; twin rule in the client store; harness flags in the test CLI. Each step lands with its tests; O2 starts the moment step 1 merges, reading only the frozen `ReceiptV1` file.

## 8. If I could change one ruling

I could not verify which ruling number covers the offline bar's "no new mechanism" constraint, so I name it by content: the ruling that expiry and deletion must be handled with no new server mechanism. I would relax it to exactly one: the purge mutation's obligation to also write the log's `delete` row. Everything else in my design respects the ruling — no scheduler, no time-reading rules, no new receipt fact — but without that single co-write, tombstones have no author and the phone is back to inferring absence from silence, which round 1 proved cannot pass M5/M6. One sentence of obligation buys the whole purge design with zero engine change. That is the cheapest ruling-edit with the largest acceptance payoff, and it keeps the spirit (no background machinery) while admitting the one write the bar cannot pass without.

---
*Delivery note: I could not write to `OUT` from this session (file writes are disabled here and the path sits outside the writable roots), so the text above is the full contribution — please save it to `/Users/ccheever/projects/snapback-1012-panel/out/r2-muse.md`.*
