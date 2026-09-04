# Panel: LLP 1012 — Local-first v1 (Claude Fable 5.1, fresh session)

**Reviewed:** `llp/1012-local-first-v1.spec.md` as landed at `9ffdf6dd0`, in a read-only capsule exported from that commit, with the engine, wire, client, evaluator, compiler, templates, the design RFCs it implements, the brief, and the rules.
**Family:** Claude Fable 5.1 — **the same family as the document's author**, run as a fresh headless session with no context from the authoring session; disclosed as same-family, not counted as a second independent family.
**Provider/runtime:** Claude Code CLI (`claude -p --model claude-fable-5-1 --effort max`), nested from the orchestrating session with the nesting guard cleared.
**Date:** 2026-09-04
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; it ran the Quarry front end on the §3 recipe from a temp script and left the tree untouched.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1012-local-first-v1.panel.brief.md`. Wrote the file itself and printed it. The orchestrating session authored LLP 1012 and is not a reviewer; it verified every engine claim below against the tree before the synthesis (`1012-local-first-v1.panel.synthesis.md`).

---

## Round 1 review (verbatim)

Reviewer: claude-fable-5-1 (Claude Fable 5.1), reasoning effort max · Date: 2026-09-04 · Method: blind round-1, read-only capsule at 9ffdf6dd0

# LLP 1012 review — Local-first v1

All paths are relative to the capsule root; `snapback2/` is abbreviated `s2/`. I could not run `snapback2 check` (no binary in the capsule), so certificate arithmetic below is by hand from `bounds.rs` and `certificate.rs`. I did run the Quarry front end on the §3 recipe with `bun` (script in `/tmp`, tree untouched). Not read in depth: LLP 1007 §4a, the bodies of LLP 1010/1011 beyond spellings and families, `writer_assets.rs`, `quarry/program.ts`.

## 1. Verdict

**NOT READY.** Four blocking findings. None touches a ruling except B2, which falls under the brief's one exception: `delivered-history` as spelled cannot be implemented in a way a user can see.

## 2. Blocking findings

### B1. The recipe does not compile, and its page cannot certify

**Claim.** §3: the delivery-log program "in the `chat` template's dialect (to be verified by `snapback2 check` in lane O2 …)".

**Evidence.** Front end run against the chat template plus the recipe: the template alone compiles; the recipe as written is refused twice, `E_QUARRY_SYNTAX` at `schema.q:124:10` ("expected ':', got 'delivered'") and at `deliveries.q:10:17` ("expected word, got '.'"). The lexer treats `-` as a symbol and identifiers as `[A-Za-z_][A-Za-z0-9_]*` (`s2/packages/compiler/src/quarry/lexer.ts:7,96`), so `delivered-history` can never be one token; shape fields are `*`, `...name`, `name`, or `name: expr` (`parser.ts:816-832`), so a bare `.` is not a field. With `retain` removed and `delivery: .` (or `*`) the recipe compiles. Page size: a `messages` row prices at 4·4000+16 bytes for `body` plus 144 per id column (`s2/crates/snapback2-core/src/bounds.rs:53-56`), about 16.5 KB; the delivery row about 0.7 KB; `first 200` is about 3.4 MB against the 1 MB output ceiling (`certificate.rs:39`) and refuses `E_BOUND` (`certificate.rs:584-599`). `first 50` fits.

**Why it blocks.** The recipe is the spec's central object (ruling 2) and the template adopts it in O2; a spec whose one program refuses at `check` binds nothing.

**Resolve.** Spell the policy as one bare word (`retain delivered`; the default needs no line), use `delivery: .` or `*`, page at 50, and paste the `check` output into §3 before the spec leaves Review.

### B2. `delivered-history` keeps rows no lane can render, and the log does not open chats

**Claim.** §3: "the app opens any chat from held rows"; §5: `delivered-history` keeps a row "as history"; §6: the twin can "re-run any named program whose reads fall inside held ranges".

**Evidence.** (a) A point read of a row the viewer may not see returns `Null` with no receipt entry; only a missing row records an absence (`s2/crates/snapback2-core/src/engine/runner.rs:652-691`). So under O2 the fresh `inbox` answer for an expelled member has `message: null` and `answer()` shows that, not the kept row. (b) Under O3 the twin re-applies the read rule through an exact epoch-bound verdict (`engine/runner_ops.rs:776-786`; `s2/packages/evaluator/src/authority.ts:1-16`), so a kept `messages` row is hidden or `partial(missing-authority)`. (c) Coverage requires an identical held range: same site, prefix, take, cursor, bounds, rule hash (`snapback2-core/src/client.rs:257-271`; `evaluator/src/evaluator.ts:405-419`). The log delivers message rows through point reads on `deliveries.byRecipientAt` pages; `thread(conversationId)` scans `messages.byConvTime`, which no held answer covers. It is `partial(never-held)` in O3 and simply unheld in O2.

**Why it blocks.** The two things the messenger needs from retention, an expelled member's history and threads opened from the drained log, are both unreachable as specified. The bar (M6 acceptance 1) reads history cold.

**Resolve.** Put the delivered content in the log row (`body`, and the edit or delete payload) so the viewer's own uniform-rule table is the only offline read surface; it never goes `denied`, its rows are readable by structure, and `until-revoked` suffices. State that messenger screens are app-side projections over held log rows in both lanes, exactly as §6 already says for search. If ruling 8 still ships `delivered-history`, define it as a twin rule ("a held row of this table is readable; delivery was the authorization") so the kept rows render under O3, and say plainly that under O2 the policy only protects rows, not answers.

### B3. Replay is not idempotent: a 503 after a commit duplicates or flips a write

**Claim.** §7: "a transport failure mid-replay leaves the intent `queued` and stops the drain"; "Reactions are idempotent toggles … and replay cleanly."

**Evidence.** The mutation route carries `{op, args}` only (`s2/crates/snapback2/src/serve.rs:402-411`); §8 adds nothing for replayed intents. Re-sending an intent whose first attempt committed either inserts a second message (no pinned ids) or hits the pinned id's primary key and is rejected `E_CONSTRAINT` (LLP 1001 §3), which the spec then shows the user as `rejected` for a message that is on the server. A toggle replayed twice un-reacts.

**Why it blocks.** LLP 1002 §9's own rule ("a 503 after a commit must never look like a rejection") is violated by the drain as written.

**Resolve.** The replay request carries `{ op, args, intent: { id, issuedAt, ids[] } }`; the server answers `committed` for an intent already applied (lookup by first pinned id, or a small `_intents (id, seq, at)` table swept at 30 days for mutations that insert nothing); reactions are `set`-shaped like the template's `setFollow(target, following)`, never toggles.

### B4. `unchanged` by result digest is wrong across re-login, and the resume is unbounded

**Claim.** §8: `unchanged` when "the fresh delivery's digest equals the client's (the digest the subscription machinery already computes)"; "one read transaction at one `seq`".

**Evidence.** Verdicts are bound to `auth_epoch` (`engine/mod.rs:214-220`), one per session row (`_sessions.auth_epoch` autoincrement, LLP 1001 §1). After re-login every held verdict is dead, but the result digest is unchanged, so `unchanged` answers leave the store with verdicts the twin will refuse. There are two digests: `delivery_digest` over Rust `(state, result)` (`live.rs:17-19`) and `frame_digest` over the wire frame minus `seq` (`writer_values.rs:56-62`); the client can recompute neither because the wire erases `Id` versus `String` (`protocol.rs:182`). Each execution opens its own transaction (`engine/mod.rs:734`) on the single writer thread (`writer.rs:1-2,390-436`); "one seq" holds by serialization, not by a transaction, and the request has no cap on `held`, so two hundred pages is two hundred exclusive executions blocking every other client.

**Why it blocks.** A correctness hole (stale authority after re-login) plus an unbounded request on the owner thread.

**Resolve.** The server issues `digest` on every `receipt=1` response and the client echoes it opaquely. `epoch` in the request is compared to the session's epoch; on mismatch no `unchanged` answers are given (the design's own "rule inputs' epoch changed" case). Cap `held` per request (the client batches) and drop "one read transaction" for "executed serially on the owner at one seq". Ranges under the append-only log resume by watermark, ruling 5's own mechanism, not by re-executing every page (see Q2).

## 3. Material findings

**M1. Session expiry destroys the store.** §4 wipes on terminal `E_AUTH_SESSION`. Sessions are a hard 30 days with no renewal (`snapback2-core/src/identity.rs:15`; no `UPDATE _sessions` anywhere). Every user loses their synced messages and outbox monthly. The partition key is the principal (§4), so expiry is not a principal change; wipe on sign-out or principal replacement only, and seal the partition until the same principal re-authenticates.

**M2. The receipt on the wire needs an encoding, a binding, and a disclosure note.** `ClosureReceipt` serializes (`engine/mod.rs:223-232`) in serde-tagged `Value` form (`value.rs:10-20`), which is what the twin expects (`evaluator/src/types.ts:1-10`) but is not the wire's `data` form. It carries an optional `schema_hash` and no plan hash or generation. Point-read absences are recorded unconditionally (`runner.rs:686-688`), so with `receipt=1` an alternate-key point read becomes the existence oracle LLP 1011 closed for writes. Rows appear in both `data` and `receipt.rows`, about 2.5× per frame. Ship rows in wire encoding and re-tag from the schema, bind to `generation` and `planHash`, and gate non-`byId` point absences on structural readability.

**M3. Ids.** The hook exists: `Context.new_ids` is a queue (`engine/mod.rs:23`) popped by `Input::NewId` and refused "newId envelope exhausted" when empty (`runner.rs:392-397`); the writer fills 1,024 per mutation (`writer_auth.rs:152-155`; `store.rs:22`). No per-session block validation exists. Pin only the ids the intent actually consumed, and let the server append its own block behind them so a replay never exhausts. Record blocks per principal, not per session, so a session expiry or a second device cannot orphan an outbox; a wiped device leaves gaps, which the allocator already tolerates (`store.rs:292-293`). Use block allocation age as the server's 30-day rule; `issuedAt` is a client clock.

**M4. Two tabs, one partition.** Nothing in §4 names a single writer across browser tabs. Two tabs drain one outbox and swap one generation. Snapback 1 hit exactly this ("binding-receipt election race", `issues/20260806-…`). Web Locks (`navigator.locks.request`) on the partition is the smallest fix.

**M5. Lane gaps.** The certified program and certificate are served by no route (`/api/manifest` carries op kinds and args, LLP 1002 §4; `serve.rs:359`); lane O3 needs them and no lane builds them. O2 "against a stub" of the receipt shape is rework by construction; stage O2 as stored answers plus outbox first (an opaque `{data, seq, digest}` per answer), then row-per-range once O1 lands. View-once non-caching depends on one-use delivery, which LLP 1006 defers (`llp/1006-assets.rfc.md:967,1276`), so M6 acceptance 1's view-once clause has no owner.

**M6. Eviction is per swap, not per range.** The §5 table evicts "rows not in the fresh result" per range; a row that merely shifted from page 3 to page 4 of a `Limit`-stopped uniform range would be evicted by one page and re-added by the next. §3 already says rows are shared by reference; make the rule "held by no range after the swap" (design F8).

**M7. Disappearing messages have no server mechanism.** §5 calls expiry "the server refusing expired content"; `schedule` is refused (`parser.ts:71`) and rules cannot read time (`guide/quarry.md`, rules section). Expiry is a caller-invoked purge mutation, and §5's "no new mechanism" is only true if that mutation writes `delete` log rows. §10 step 4 cannot go green without it.

**M8. Mounted queries execute twice on reconnect** (resume, then `subscribe` re-executes, `live.rs:117-146`). Either `subscribe` accepts `digest=` and answers `unchanged` as its first frame, or resume covers unmounted answers only.

## 4. Minor findings

- `retain <policy>` is a new table-line form; the parser today expects `name:` (`parser.ts` table lines). Spell it `retain delivered`; hyphens do not lex.
- Families are code prefixes (`protocol.rs:97-116` and `8-25`). `E_RETAIN_POLICY` belongs to `quarry` (`E_QUARRY_*`, `quarry/diagnostics.ts`), and the runtime codes should be `E_OFFLINE_CARRIER`, `E_OFFLINE_INTENT_EXPIRED`, `E_OFFLINE_ID_BLOCK`. `E_OFFLINE_FENCE` should not exist: bad client options throw `TypeError` today (`client.ts:352-354`).
- Nest the options: `store: { carrier, fenceDays, maxAssetBytes }`, one key instead of three.
- "IndexedDB gives this per object-store transaction" is wrong wording; one `readwrite` transaction spans several stores. The twin's evaluation is synchronous (`evaluator.ts:96-130`) and must finish before the transaction opens, or IndexedDB auto-commits.
- The fan-out `first 50` must equal the group cap (brief: 50 members; `groupCreate` takes `<=49`), else members past the cap are silently undelivered.
- `stale.age` is derivable from `since`; `want: 'receipt'` is implied; delete both.
- "The store is at one version" is already false with live deliveries landing per range; say "every swap is atomic at a seq".
- LLP 0329.014.007 F11 still says the fence makes the store "not trusted"; mark it superseded by ruling 1.
- `maxAssetBytes` "LRU by the owning row's recency" needs a read timestamp on every row; use the byte entry's own last-read time.

## 5. Answers

**Q1.** Point reads: yes, absent records an absence and hidden records nothing in the receipt (`runner.rs:686-688` versus `669-677`), at the price of M2's oracle. Rows in a range: only for certified-uniform ranges, where `ReceiptRange.row_ids` is pushed (`runner.rs:986-1007`; `hoist` at `certificate.rs:1111`); non-uniform ranges carry no receipt range at all. The recipe's ranges are uniform, so §5's fallback never fires for the messenger; the real defect is B2, kept rows nobody renders.

**Q2.** Not bounded (no cap on `held`), honest only with a server-issued digest and an epoch rule (B4). Cost for fifty conversations and two hundred pages: two hundred executions of a 200-row scan plus 200 point reads and memoized rule probes, serialized on the owner thread for every reconnecting client. A read transaction is not the unit; the owner's single thread is (`writer.rs:1-2`). Missing: `generation`, per-request cap, intent ids, the epoch rule, a definition of `Generation` for `swap`.

**Q3.** The hook exists as a queue, not as a protocol (M3). Exhausted block offline: enqueue refuses at the client with no refill possible; size the block to the certificate's id demand (a `send` needs up to 51). Device wiped: gaps, harmless. Two devices: two blocks, no race; inserts never conflict under OCC.

**Q4.** Serializable, epoch-bound through verdicts, not generation-bound, and about 2.5× the frame (M2). Cut the duplicate encoding and add `generation`, `planHash`, `digest`.

**Q5.** Does not compile as written; certifies at 50 not 200 (B1). The fan-out fits: 1 + 50 inserts plus one maintained write against 2,048 (`certificate.rs:41,945-951`). One range covers the drain and nothing else; every screen is an app projection (B2). It is a replica of delivered answers, own-rows and uniform, which is the design's result cache by construction; say so.

**Q6.** The state machine is right and smallest. Same-transaction is achievable on IndexedDB with the synchronous twin. FIFO with independent settlement is not honest until replay is idempotent (B3); the state a user will not understand is one poisoned intent halting sends in every other chat, and `E_CONSTRAINT` shown as `rejected` for a delivered message.

**Q7.** Nothing in the runtime or certificate reads a fence (grep: none). The server needs `issuedAt` only for the 30-day rule, which block age serves better (M3).

**Q8.** Prefix-family consistency and the `quarry` family (minor findings). Schema owns `retain`; the client owns the rest.

**Q9.** The witness misses a kill mid-swap, revocation while offline, render-before-network (Snapback 1's G4 failure), session expiry, a second tab, and the 503-after-commit replay. The interface is not the smallest for O3: the twin hydrates from a `ClosureReceipt` (`evaluator.ts:88-94,162`), so one `coverage()` returning rows, ranges, absences, and verdicts replaces `rows()` and `ranges()`, which cannot supply the verdicts local evaluation needs.

**Q10.** Buildable with O1 before O2 (M5). The bar needs O1, O2, O4: search is an app filter, pending renders from args, cold start reads held answers. O3 is not needed for the bar and should not gate it. Missing: the program on the wire, view-once ownership, the purge mutation.

**Q11.** Delete: `want`, `E_OFFLINE_FENCE`, `stale.age`, the receipt's per-range `retain` echo (the manifest already carries generation-bound schema facts), `rows()`/`ranges()` in favor of `coverage()`, row read-tracking for the byte LRU, and the second execution of mounted queries.

## 6. Strengths

The fence as trust, never reading. The cache, not a replica, and the per-viewer log as a program shape rather than platform machinery. Loud carriers and no encryption claim. A physical kill as the bar's evidence, scheduled, not blocking. Digest-checked resume as the cheap cousin of candidate 3, with §14's numbers gating every deferral in §11. `queued` already reserved in the client so the outbox lands without a rename.

## 7. Open questions for the author

1. May `delivered-history` be defined as a twin-side rule (held rows of that table are readable) and the messenger recipe carry content in the log, or must the policy keep §5's row-only meaning? (Ruling 8 names the policy; its semantics are the spec's.)
2. May lane O3 run behind the offline bar rather than inside it, given the bar as ruled needs no local evaluation?

## 8. Lane O1, if I owned it

Add `receipt=1` to `/api/query` and `/api/subscribe` first, in wire encoding with schema re-tagging, bound to `generation` and `planHash`, with a server-issued `digest` on every response, and land it with a corpus case that round-trips one receipt through the TS twin's `ClientStore`. Then `/api/mutation` gains the optional `intent` envelope and the already-applied lookup, because nothing in O2 is safe without it. Then `/api/resume` with a cap and the epoch rule, and id blocks per principal. `retain` last, as one bare word, only after B2's answer says what it means.


---

## Round 2 — proposals (2026-09-04, later the same day; verbatim)

**Method:** round 2 on the brief preserved at `1012-local-first-v1.panel.brief-r2.md`, which carried the orchestrator's verified round-1 synthesis and asked for designs rather than critique, per the author's instruction. Claude Fable 5.1 at effort max, fresh session, same family as the author (disclosed).

Reviewer: claude-fable-5-1 (Claude Fable 5.1), reasoning effort max · Date: 2026-09-04 · Method: round 2, proposals, read-only capsule at 9ffdf6dd0, after the verified round-1 synthesis

# LLP 1012 round 2 — designs for the open problems

Paths are relative to the capsule root; `snapback2/` is abbreviated `s2/`. Byte and time figures are estimates from `bounds.rs` pricing and the code paths cited; I could not run the owner in the capsule.

## 1. The purge design: absence evicts, hidden keeps, and the delete row carries its own proof

**Pick.** (A) for bodies, (C) for range-held rows, and (B) folded into (A) so the app-level fact and the store-level proof arrive in the same page. No engine change.

**Declarations** (the recipe, in the chat template's dialect; `retain` moves to `messages`, where rows can actually go hidden — on the log it is a no-op, because `.recipient = viewer` over an immutable column can never hide a row):

```q
table messages:            # the template's table, one line added
  …
  retain delivered

table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  kind: enum('message', 'edit', 'delete')
  at: time
  by byRecipientAt: recipient, at, id
  immutable recipient, conversationId, messageId, kind, at
  read <- .recipient = viewer
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny

query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipientAt
  return page { delivery: ., message: messages[.messageId] }

mutation unsend(conversationId: conversations, messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  for m in memberships[conversationId] first 64 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId, messageId, kind: 'delete', at: now }
  delete messages[msg]
  return null
```

Expiry is the same body run by whatever caller enforces the clock (a dependency outside 1012, as round 1 established). The fan-out bound must equal a membership cap that `memberAdd` enforces through a maintained count, or member 65 is silently undelivered. I could not verify whether the engine validates ref targets on insert; if it does, the log rows go in before the `delete`, as written.

**Why it passes.** The `delete` row reaches every recipient through the ordinary drain. Its page reads `messages[.messageId]`; the row is gone, so that point read records an absence in the page's receipt (`s2/crates/snapback2-core/src/engine/runner.rs:679-688`). Rows are stored once per `(table, id)` and shared by every answer that holds them (§3), so an absence proven in the newest page evicts the body from every older page that held it, and its bytes leave in the same swap. No old page is re-executed. The app needs the delete row only for the screen (hide the bubble before the resume); offline search is an app filter over held rows and stops finding a body that is no longer held.

**The swap rules** (client, lane O2), replacing §5's table:

1. An absence for `(table, primary index, id)` in any fresh receipt evicts row `(table, id)`. Always, under both policies.
2. A fresh certified-uniform range with the same site, prefix, bounds, take, and rule hash as a held range evicts held ids that fall inside the fresh range's extent and are missing from its `row_ids` (extent: up to the last returned key under `Limit`, to the bound under `Exhausted`; `runner.rs:985-1007`). This is (C); it fires on `thread` pages, never on the append-only log.
3. A fresh answer with `null` and no absence at a site where the held answer had a row, or a fresh `denied` state for a held answer, is the *hidden* signal. `retain delivered` keeps the row; the default evicts it.
4. A row leaves the store when no answer holds it after the swap (round 1: per swap, not per range).

**What `retain` means now.** One sentence: what the store does with a held row that a fresh authorized answer hides. Absence is never a policy question. The certificate does not record it; `/api/manifest` carries `tables.messages.retain` once per generation, and the receipt stops echoing it per range.

**The kept row renders.** Under `retain delivered` the swap keeps the *held answer* when the only difference between held and fresh `data` is retained-table rows becoming `null` (a JSON diff whose every changed leaf is a row-to-null at a position whose row the store holds). The answer is marked `retained: true`. That is a delivered fact re-shown, not an invention, and it closes round 1's "kept but unrenderable" without lane O3.

**Cost.** A JSON diff on changed answers at swap; one point read per delete row, already inside the page's certified 19 operations. **Pays.** M5 acceptance 1 (server refuses, the drain proves, search stops finding) and M6 acceptance 1 (history renders, revoked content does not) on today's receipt.

**Rejected.** (E) an `evictions[]` fact restates what absences and extents already prove and adds engine surface; my round-1 content-in-the-log doubles bytes on every edit and loses the shared-row proof.

## 2. Resume a phone would love

**Principle.** The drain is the resume. Everything else is a conditional request, and an unmounted page is re-authorized when it is next on screen, not when the radio comes back.

**Wire.** Every `receipt=1` response and frame carries `digest = sha256(canonical({ gen, planHash, epoch, state, data, next }))`, computed by the server on the wire JSON; the client echoes it and never recomputes it. `seq` is excluded. Then:

```
POST /api/query      { op, args, digest }        → { state: "unchanged", seq, digest } when equal
GET  /api/subscribe  ?op=&args=&digest=          → first frame { state: "unchanged", … } when equal
POST /api/resume     { queries: [{ op, args, digest }] }   ≤ 64
                     → { seq, gen, epoch, results: [ <exactly a /api/query element> ], more }
```

`/api/resume` is nothing but a list of conditional queries run as one owner action, sequentially, each in its own transaction (`s2/crates/snapback2-core/src/engine/mod.rs:734`), stopping at 1 MB of output with `more: n`. No `held`, no `want`, no `epoch` in the request, no id block. The subscribe form ends the double execution: the client already sends `Last-Event-ID` on reconnect (`s2/packages/snapback2/src/client.ts:782`) and the server ignores it; the digest replaces it.

**What the client sends, in order.**

1. Reopen mounted subscriptions with their digests; their first frame is `unchanged` or fresh.
2. Batch one: the log's tail page re-run with its own `after` (the watermark; when it comes back capped, follow `next` to `null`; new pages are new answers), then the pages *implicated* by the drain (answers holding a `messages` row named by a fresh `edit` or `delete` log row; the store knows which answers hold which rows), then the most recently delivered pages to fill 64.
3. The outbox drains (§3) after batch one swaps.
4. The trickle: remaining held pages, 64 per batch, while connected and idle, until done. It exists for the default policy (hidden evicts); a messenger on `retain delivered` gets nothing from it and loses nothing without it.

**Server, per element.** Resolve the op; `unchanged` on an equal digest; else execute and return the response with receipt and digest; a refusal element for an unknown op or bad args, which the client treats as "drop this answer". `seq` is the commit seq when the action starts; nothing interleaves because the batch is one owner action, which is the honest form of §8's "one transaction".

**Epoch change.** The digest includes `epoch`, so nothing is `unchanged` and every verdict is reissued; no special case. **Generation change.** `gen` and `planHash` are in the digest, so nothing is `unchanged`; ops that no longer exist come back refused and are dropped; old-generation answers stay readable offline as `stale` until replaced.

**Cost, Clique inbox** (fifty conversations, about 200 held pages, back after an hour with 200 new messages in five conversations; estimates):

| step | bytes | executions |
|---|---|---|
| mounted: inbox list, one thread | ~120 KB | 2 |
| drain: four new log pages | ~240 KB | 4 |
| implicated pages | ~300 KB | 5 |
| rest of batch one, unchanged | ~6 KB | 53 |
| trickle, unchanged | ~17 KB | ~140, later |

Roughly 700 KB with the receipt duplicating rows, half that once rows ship once (§7 step 1); about 65 executions, tens of milliseconds of owner time before the phone is fresh, the trickle's ~140 spread behind it.

**Rejected.** Re-authorizing every held page at one seq in one request: unbounded on the owner thread and no better for the person, because an unmounted page is not on screen.

## 3. Ids and replay, the smallest correct scheme

A per-device cursor (§5).

**Declarations.**

- **Device:** a 128-bit random id the client mints when the partition opens and stores in it. No registration.
- **Intent:** `{ n, op, args }`, `n` per device, monotonic from 1, assigned at enqueue.
- **Ids:** the k-th `new` of intent `n` is `s2i-<device>-<n>-<k>`. Derived, never sent, never chosen: the client predicts them, the server derives them. Asset records keep server-minted ids (`is_engine_id`, `s2/crates/snapback2-core/src/assets.rs:260`, is asset-scoped; no other write path validates id format).

**Wire.**

```
POST /api/mutation { op, args, intent: { device, n } }
→ committed | rejected as today, plus intent: { device, n }
```

**Server.** A table `_devices(id PK, principal, last_n, last_response, seen_at)`. In `execute` (`s2/crates/snapback2/src/writer.rs:792`): a device bound to another principal → `E_OFFLINE_DEVICE_FOREIGN`; `n == last_n` → return `last_response` (the 503-after-commit case); `n < last_n` → `E_OFFLINE_INTENT_SETTLED`; `n > last_n + 1` → `E_OFFLINE_INTENT_GAP`; `n == last_n + 1` → run. The injection point is `mutation_context` (`s2/crates/snapback2/src/writer_auth.rs:152-156`): with `intent` present, `context.new_ids` is the derived list up to the certificate's write ceiling instead of `reserve_new_ids()`. On commit the engine writes `last_n` and `last_response` beside `append_commit` (`mod.rs:1501`), in the mutation's transaction. On rejection the writer records it afterwards; a crash between re-runs a rejected intent that wrote nothing. `seen_at` updates on every intent and resume; a device silent for 30 days gets `E_OFFLINE_INTENT_EXPIRED` and the client expires its queue. That is server-recorded age, which round 1 asked for; `issuedAt` leaves the wire.

**Failure shapes.**

- *Block exhausted:* cannot happen; the certificate's write ceiling bounds ids per intent at `check`.
- *Device wiped:* a new device id; the old row idles and is swept by the same 30-day rule; committed ids are permanent; unsent intents die with the device, as they should.
- *Two devices, one principal:* two cursors, no coordination; arrival order between them.
- *Parent intent rejected:* the child references `s2i-…-<n>-0`, fails the insert rule or ref lookup, settles `rejected` with the ordinary envelope; the cursor advances; the app shows both (ruling 4's independent settlement).
- *Dependent intents:* reference derived ids known at enqueue; the twin, when wired, derives the same.

**Cost.** One table, one optional wire field, about a hundred lines. **Pays.** Exactly-once replay, offline ids, dependent intents, no blocks, no `E_ID_BLOCK`, no resume coupling.

**Rejected.** Session id blocks couple ids to resume, exhaust offline, orphan on wipe, and need a registry; client UUIDv7 validated at commit has nothing to validate against without one.

## 4. Make it feel like WhatsApp

Ranked.

**1. `snapback2 test` cuts the network.** A journey primitive:

```ts
journey("offline inbox", async ({ as, offline, online }) => {
  const alice = as("alice", { store: "file" });             // Node carrier, partition under .snapback/test-<ts>/
  const inbox = alice.subscribe(api.inbox, { c: null }, () => {}, { drain: true });
  await inbox.until((v) => v.state === "complete" && v.next === null);
  await offline();                                          // the client's transport refuses; the owner is untouched
  const cold = await alice.restart();                       // close, reopen the same partition, no network
  const held = await cold.query(api.inbox, { c: null });    // complete, connection: "offline", stale
  const sent = await cold.mutation(api.send, { … });        // state: "queued"
  await online(); await cold.settled();                     // outbox drained, in order
});
```

Plus one derived check, `offline`: every query the seed journeys ran replays byte-equal from the store after `offline()`, and every `retain delivered` table's rows survive a `denied` re-authorization. *Cost:* three client methods (`offline`/`online` flip the transport, `restart` reopens the partition), the Node carrier already planned, one derived check, about 200 lines across `s2/crates/snapback2/src/test.rs` and `s2/packages/snapback2/src/test.ts`; no wire bytes. *Pays:* the agent proves the bar's shape inside the sixty-second loop before touching a simulator, and the physical-kill witness stays scheduled as the only durability claim. *Proof:* the chat template ships this journey and `snapback2 test` is green on it; the witness reruns the same script on the simulator. A companion at zero cost: `snapback2 why <query>` gains one line, "offline: 1 uniform range held as coverage, 50 primary point reads; a held answer replays exactly", from certificate facts it already has.

**2. `drain: true` on a subscription.** `useQuery(api.inbox, { c: null }, { drain: true })` follows `next` to `null`, holds every page, then keeps the tail live and follows `next` again whenever it reappears. That is "everything on the phone" as one option instead of a loop the agent writes wrong (round 1: the drain had no stated depth or rotation). *Cost:* about forty lines in the client; bytes: the whole log once, then the tail. *Pays:* the recipe's central promise is one line, and §2's watermark is the same tail. *Proof:* seed 500 deliveries, drain, `offline()`, 500 held; add ten online, the tail advances; `offline()`, 510 held. *Rejected:* a `drain` verb on the client; an option on the query the app already writes is smaller.

**3. `useOutbox()` and the pending row.** The confusion it removes: "did it send, and will it survive a restart?" The hook returns `[{ id, op, args, at, state: 'queued' | 'sending' | 'rejected' | 'expired', error? }]` with `dismiss(id)` for settled intents (not cancel, which stays deferred). The recipe renders a pending bubble keyed by intent id, and because the outbox opens before the first request, a queued message is on screen at cold start before the network is tried (Snapback 1's render-before-network failure, closed by construction). `useMutation().last` gains `queued` as ruled. *Cost:* one hook, about sixty lines, no bytes. *Pays:* M6 acceptance 2's "visible pending" is a paved state, not app-invented; a rejected offline send is shown and dismissable instead of stuck at the head of the queue forever. *Proof:* the journey above asserts `useOutbox()` across `restart()`; a send to a conversation the viewer left while offline shows `rejected` with the envelope and the later send commits.

## 5. Steal one thing: Replicache's per-client mutation cursor

Replicache gives each client a `clientID` and a monotonic `mutationID`; the server keeps `lastMutationID` per client, applies each pushed mutation once in order, skips ids at or below the cursor, advances the cursor even when a mutator fails, and the client throws its optimistic state away and re-derives it from server truth on every pull. It fits this design's principles exactly: the server settles (ruling 4); the outbox is FIFO with independent settlement; the client is a result cache whose pending state is a throwaway overlay over held answers, never merged (F11); exactly-once needs no registry, no token, and no client clock. §3 is that cursor with derived ids. It replaces session id blocks, `E_ID_BLOCK`, `idBlock` on resume, `issuedAt`, and `E_INTENT_EXPIRED` by client time. What we do not take is the client view record and the pull-diff protocol, which is a replica. The one discipline to carry beyond ids: `pending[]` renders from args over the held answer and is discarded when the intent settles or a fresh answer lands, never reconciled with it.

## 6. Cut

What leaves v1 against the bar as stated (M5 acceptance 5, M6 acceptance 1 and 2, the witness), and what each removal unblocks:

1. **Lane O3 from the bar's path**: the twin, the prediction overlay, `partial` reasons, `rows()`/`ranges()`. The bar needs held answers, an app filter, and pending from args. Unblocks O2 without coverage machinery; `verdicts` and `halo` are stored opaquely for later; the 9.7 KB twin stays out of the bundle until it pays. Ruling 3 stands: reads are staged; O3 is staged after the bar.
2. **Session id blocks, `E_ID_BLOCK`, `idBlock`, `issuedAt`, server-side `E_INTENT_EXPIRED` by client time** → §3.
3. **`want`, bare `epoch` in the request, `held[]` with per-page `seq`, "one read transaction"** → §2's conditional queries and one owner action.
4. **`E_OFFLINE_FENCE`** (a bad option is a `TypeError`, `client.ts:352`), **`stale.age`** (derivable from `since`), **`fence: { days }` beside `maxAssetBytes`** → `store: { carrier, fenceDays }`; `maxAssetBytes` moves to O4 with `assets`, off the O2 interface.
5. **`retain` in the certificate and its per-range echo in the receipt** → the manifest, once per generation.
6. **§5's three-column table** → §1's four rules; `delivered-history` on the log → `retain delivered` on `messages`.
7. **"Disappearing messages: no new mechanism"** → the purge mutation named as a dependency outside 1012.
8. **`swap(gen: Generation)`** → `apply(delivery)`, ending the collision with the engine's `Generation`.
9. **The `offline` diagnostics family as a family of its own** → three runtime codes under `offline`, `E_QUARRY_RETAIN` under `quarry`.
10. **§14's "twin gzip before and after O3"** → moves with O3.

Net: about a third of the spec's surface, the critical path becomes O1 → O2 → O4, and O2 starts at O1's first landing rather than against a stub.

## 7. Lane O1 on one page

In landing order; every test in the blocking set.

1. **Receipt on the wire (days 1–2).** `s2/crates/snapback2/src/writer_wire.rs`: `execution_json` gains `receipt` and `digest` when asked. `protocol.rs`: `WireReceipt { v: 1, gen, planHash, schemaHash, epoch, rows: [{ table, id, row }], ranges, absences, verdicts }` in wire encoding via `value_to_json`, absences filtered to the primary index at the wire (round 1's disclosure finding). `serve.rs`: `receipt: true` in the `/api/query` body, `receipt=1` on `/api/subscribe`. `s2/packages/snapback2/src/types.ts`: the TypeScript mirror. Tests: `test_sse.rs` (a frame carries the receipt; without the flag nothing changes) and `s2/packages/evaluator/src/test.ts` (a wire receipt re-tagged by schema hydrates `ClientStore`, `evaluator.ts:83`). **The shape freezes here and O2 starts.**
2. **Digest and `unchanged` (days 2–3).** `writer_values.rs`: `response_digest`. `/api/query` with `digest` answers `unchanged`; `/api/subscribe?digest=` opens with `unchanged`. Tests: `test_sse.rs` (unchanged first frame, then a commit delivers; after re-login nothing is unchanged).
3. **`POST /api/resume` (days 3–4).** `serve.rs` route; `writer.rs` `Action::Resume`; cap 64, 1 MB, `more`. Tests: `test_unit.rs` (caps, mixed results, generation change, unknown op as a refusal element).
4. **Intent envelope and device cursor (days 4–6).** `s2/crates/snapback2-core/src/store.rs`: `_devices` DDL; `engine/mod.rs`: `Context.intent`, cursor written beside `append_commit`; `writer_auth.rs`: derived ids; `writer.rs`: the cursor cases; `protocol.rs`: the four `E_OFFLINE_*` codes with rewrites and the `offline/replay` guide slug. Tests: `snapback2-core/tests/store.rs` (derived ids and allocator ids disjoint; the cursor lands in the mutation's transaction), `test_unit.rs` (the same intent twice yields one row and one response; rejected advances; gap; foreign device; expired device), one evaluator corpus case for derived `NewId`.
5. **`retain` (days 6–7).** `s2/packages/compiler/src/quarry/parser.ts`: the table line `retain delivered`, one bare word; `E_QUARRY_RETAIN` with a rewrite naming the two spellings; project JSON `tables[].retain`; `snapback2-core/src/schema.rs`; `/api/manifest` gains `tables`. Tests: compiler `src/test.ts`; a `registry.rs` manifest test. Paste the recipe's `check` output into §3.
6. **Guide and measure (day 7).** `guide.rs`: `snapback2 guide offline`; a `metrics/` line for receipt bytes per `thread` frame with and without `receipt`. Publish `0.0.x`.

## 8. If I could change one ruling

Ruling 8. I would ship zero retention words in v1: absence evicts and hidden keeps, universally, which is WhatsApp's and Signal's model and exactly what the expelled member, the expired message, and the unsent message need. The evicting policy has a real customer, a document app where revoked access must go dark on sync, but that customer is not in the brief, and ruling 8 makes it the default, so every table pays for a policy the bar never exercises. Removing the word removes a Quarry line, a diagnostic, a manifest field, the certificate question, the twin-side meaning question, and §1's JSON diff. When a brief asks for revocation that evicts, `retain revoked` is one table line and one swap rule, landed with its number; deleting is first-class, and this is the deletion that costs least and pays most.
