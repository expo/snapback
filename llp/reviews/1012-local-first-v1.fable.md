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
