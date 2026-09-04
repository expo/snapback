# Panel: LLP 1012 — Local-first v1 (grok-4.6)

**Reviewed:** `llp/1012-local-first-v1.spec.md` as landed at `9ffdf6dd0`, in a read-only capsule exported from that commit, with the engine, wire, client, evaluator, compiler, templates, the design RFCs it implements, the brief, and the rules.
**Family:** grok-4.6
**Provider/runtime:** Grok CLI (`grok -p -m grok-4.6 --reasoning-effort xhigh --disable-web-search --permission-mode auto`)
**Date:** 2026-09-04
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1012-local-first-v1.panel.brief.md`. Wrote the file itself and printed it as its final message. The orchestrating session authored LLP 1012 and is not a reviewer; it verified every engine claim below against the tree before the synthesis (`1012-local-first-v1.panel.synthesis.md`).

---

## Round 1 review (verbatim)

Reviewer: grok-4.6 · Date: 2026-09-04 · Method: blind round-1, read-only capsule at 9ffdf6dd0

# LLP 1012 review — Local-first v1

## 1. Verdict

**NOT READY**

The thirteen rulings can be implemented. The mechanisms as written cannot: resume is not the digest the engine already has, and `delivered-history` plus range-held rows cannot do the expiry purge M6 acceptance 1 requires. Fix those two before O1.

## 2. Blocking findings

### B1. Resume `unchanged` names a digest the wire does not have, and `held[]` is unbounded on the exclusive owner

**Claim.** “The server re-executes every held `(op, args)` in **one read transaction** at one `seq` … and for each returns either `unchanged` when the fresh delivery's digest equals the client's (the digest the subscription machinery already computes, LLP 1000 ‘state-aware digests’), or the full query response with its receipt.” “Cost is one bounded scan per held range.” (§8)

**Evidence.**

- `Engine::execute` opens its own SQLite transaction per call (`snapback2/crates/snapback2-core/src/engine/mod.rs:734`). There is no batch-read API.
- The store is `PRAGMA locking_mode = EXCLUSIVE` (`store.rs:97–108`). There is no second reader.
- Every query/mutation/subscribe is `Action` on the one writer thread (`writer.rs:1–2, 105–118`).
- Two digests already exist, neither on the wire:
  - live skip: `digest(&(state, result))` (`live.rs:17–19`);
  - SSE skip: `frame_digest` = `serde_json::to_string` of the JSON frame minus `seq` (`writer_values.rs:56–61`; `writer.rs:1029`).
- `execution_json` / `live_frame` do not serialize `ClosureReceipt` (`writer_wire.rs:8–45`).
- `POST /api/query` and `GET /api/subscribe` send `{ op, args }` only (`client.ts:385–388, 441`); no `digest`, no `receipt=1`.
- `useQuery` holds one `(op, args)` per mounted page (`react.tsx:87–99`). A drained 10k-message log at 200/page is ~50 held inbox pages, plus every opened thread page.

**Why it blocks.** O1 cannot “use the digest the subscription machinery already computes”: those two hashes disagree, neither includes the receipt O1 just added, and the client never saw either. `unchanged` implemented against `frame_digest` will break the moment `receipt=1` is on the frame; implemented against `delivery_digest` will skip a coverage-only change (new absence, new verdict `auth_epoch`) and leave the store with a stale receipt. Separately, “one bounded scan per range” is unbounded in `held[]`. Two hundred pages is two hundred full executes on the only thread that can touch SQLite. That stalls every client, and a hostile `held[]` is a DoS. Exclusive lock means you cannot move this to a snapshot connection.

**Resolve.** (1) Name one canonical digest: `digest(&(state, result, next, generation.hash, schema_hash))` — IR canonical JSON, not the SSE frame. Put it on every query/subscribe response so the client stores it. Do not put the receipt in that digest; if coverage changed without `data`, send `{ unchanged: false, receipt }` or always send the receipt on resume. (2) Cap `held[]` (256 is enough for the messenger drain; refuse `E_OFFLINE_RESUME` with a rewrite to drop oldest pages). (3) Say resume is N executes on the owner thread at one `seq` (true because the owner is exclusive, even without one wrapping transaction). Add a multi-query snapshot only if you need a stronger isolation story than the owner already gives.

### B2. `delivered-history` cannot tell delete from hide on a range, and §5’s expiry-as-absence therefore fails the bar for the thread query

**Claim.** “rows not in the fresh result are evicted **only on a receipt absence**; a row merely missing from the result is kept as history.” “an expired message is an absence on the next resume of every range that held it.” (§5) Chat template thread is a range over `messages`. M6 acceptance 1: expired content must not render after cold start (`benchmarks/briefs/social-messenger.md:615–618`).

**Evidence.** Point `get`: missing row → receipt absence (`runner.rs:677–688`); hidden row → `Null`, no absence (`runner.rs:671–676`). Range `scan`: `ReceiptRange.absence` is `returned.is_empty()` (`runner.rs:980, 1004`) — a whole-range flag, not per-id. Hidden candidates are stripped from the receipt (`runner.rs:895–901`). Receipt ranges ship only when the site is certified-uniform (`runner.rs:985–1008`). A deleted or expired message in a still-visible thread disappears from `row_ids` with no per-row absence. The shipped thread query is `return messages[conversationId] after c last 50` (`templates/chat/snapback/messages.q:3–5`) with `read <- exists memberships[.conversationId, viewer]` (`schema.q:58–64`) — a uniform prefix scan.

**Why it blocks.** Leave-group (hidden) and expiry/delete (gone) look identical in a range receipt. §5’s fallback — keep — is the right *disclosure* answer and the wrong *messenger* answer: expired thread messages stay on the phone, which fails M6 acceptance 1. Putting `delivered-history` on `messages` (summary + §3) and also promising “absence on every range that held it” are mutually exclusive on the engine that exists. Inbox point-joins (`messages[.messageId]`) *would* distinguish; the template’s thread range would not. Implementing §5 as written against the template as written fails the offline bar.

**Resolve.** Pick one, write it once:

- **A (fits the engine):** `delivered-history` only on `deliveries`. `messages` stays `until-revoked`. Thread is a local filter of held log rows plus point reads of `messages[.messageId]`. Expiry is a server delete; the point-read absence evicts the body; the log row remains for the app to hide. Drop the sentence “an expired message is an absence on the next resume of *every range*.”
- **B:** Keep a messages range. Then expiry/delete must be a delivery-log `kind: 'delete'` (or `until-revoked` on `messages`), and the app purges from that signal. Do not claim receipt absences for range-held ids.

Do not ship both policies on `messages` and a range thread.

## 3. Material findings

### M1. `RangeStore` cannot feed the twin

**Claim.** Lane O3 “runs the certified program over `rows()` and `ranges()`” (§4, §6).

**Evidence.** Twin and `ClientStore` need absences and exact verdicts; a miss is `partial(missing-authority)` (`client.rs:117–138`; `evaluator.ts:143–151, 313–317`; LLP 1001 §2; evaluator ticket “rows, ranges, absences, and verdicts”). §4’s interface has neither. `answer()` returns one op’s receipt; a combined inbox join needs the merged coverage.

**Resolve.** Add `absences(table, index, key)` and `verdicts(...)` (or one `coverage()`). Drop `assets` from the O2 interface; it is O4.

### M2. Closure receipt as-is is too big, and not generation-bound, for `receipt=1` on every frame

**Claim.** `receipt=1` puts the closure receipt beside `data` on every query/subscribe frame (§8).

**Evidence.** `ClosureReceipt` is `Serialize` (`engine/mod.rs:222–232`) and carries full `rows: Vec<RowRecord>` (`engine/mod.rs:88–92`) plus `halo: Option<RowRecord>`. `data` already has the visible rows. Default `max_output_bytes` is 1 MiB, `max_closure_bytes` 4 MiB (`certificate.rs:31–42`). Verdicts carry `auth_epoch` but not `plan_hash` / `evaluator_version` / generation hash. The evaluator ticket’s “generation-bound certified program” is not this object.

**Resolve.** Wire receipt = `{ schemaHash, planHash, evaluatorVersion, ranges (row_ids, bounds, stop, absence, halo id), absences, verdicts }`. Rows live in `data` or a once-per-swap `(table, id)` map. Send the receipt when coverage changes, not as a duplicate of every live frame. O3 still needs the certified program separately (manifest / generation).

### M3. Session id blocks are not the hook the spec points at, and the failure shapes are missing

**Claim.** “On every successful resume the server allocates the session a bounded id block … on replay the server applies the intent with its pinned ids through the hook LLP 1001 §8 already names.” (§7)

**Evidence.** The hook is `Context.new_ids: VecDeque<String>` (`engine/mod.rs:23, 392–397`; 1001 §8:618). Serving mutations *always* fill it from the store-wide allocator (`writer_auth.rs:152–156`; `store.rs:22, 294–368`, block size 1024, ids `s2id-{namespace}-{sequence}`). `POST /api/mutation` is `{ op, args }` (`client.ts:409–411`; 1002 §4). Exhaustion today is `RuntimeError::Input("newId envelope exhausted")` (`runner.rs:397`), not `E_ID_BLOCK`. High-water overflow is `StoreVersion` (`store.rs:349–352`). Allocator is per-store, not per-session.

**Resolve.** Mutation body gains `ids[]`. Server validates they lie in the *union* of blocks issued to this auth epoch, then injects them as `new_ids` instead of `reserve_new_ids()`. Blocks accumulate until logout; a resume adds a block only when remaining < N. Device wipe with a live outbox is impossible if sign-out/`E_AUTH_SESSION` wipes the partition first — say that. Two devices = two epochs = two blocks; no race. Offline insert cap = remaining block; `E_ID_BLOCK` locally, no silent reuse.

### M4. The §3 recipe does not compile, and one range does not cover the messenger

**Claim.** The delivery-log snippet is “the `chat` template's dialect (to be verified by `snapback2 check` in lane O2)”. One subscription, one long range, “the app opens any chat from held rows.” (§3)

**Evidence.**

- `retain` is not a table word. `parseTable` accepts `public` / `by` / `unique` / `immutable` / `after` / rules / columns (`parser.ts:104–137`). `retain delivered-history` fails at `take(":")`.
- Shape spread is `*`, not `.` (`parser.ts:816–821`). Paved form: `return page { *, message: messages[.messageId] }` (cf. `feeds.q:14` uses `post: .`).
- Index `(recipient, at, id)` does not prefix a conversation. Thread, in-chat search, and “open this chat” are not that range. Current thread is a *second* query (`messages.q:3–5`).
- `kind` is `'message'|'edit'|'delete'`. M6’s spec text includes likes/reactions (`social-messenger.md:624`); the *offline bar* is only M5 acc 5 and M6 acc 1–2, so reactions are not the bar — but the recipe should not pretend the enum is the messenger.
- Fan-out `for m in memberships[conversationId] first 50 by byConversationPrincipal`: domain is a page, which `for` accepts (`program.ts:188–195`). Write ceiling default `write_rows: 2048` (`certificate.rs:41`). Template group cap is `members: [principal] <=49` plus creator (`groups.q:1`) — 50 fits. A 51st member is silently un-notified.

**Resolve.** Fix the snippet in this spec (O1 adds `retain`; use `*`). State that “everything on the phone” means the app *drains* `inbox` to `next: null` while online, and that a thread is a JS filter of held log rows (or a second index `byRecipientConversationAt`). Cap groups at the fan-out, or page the fan-out. Reactions wait; don’t put them in `kind` until a mutation exists.

### M5. The §10 witness does not test what it claims, and O2 cannot run it

**Claim.** Kill after drain; cold start shows inbox, three chats, two images; “a message queued before the kill is still `queued`”; resume evicts an expired message. O2 is “the browser kill witness”; O4 is images + simulator (`§10`, `§12`).

**Evidence.** Steps 1–3 never enqueue a message, yet step 3 asserts one is still `queued`. Images are O4 (`§9`, `§12`). Mid-swap crash is asserted (“A crash mid-swap leaves the previous generation intact, which the kill witness asserts,” §4) but the procedure kills *after* drain, not during `swap`. Browser IDB eviction under quota is not a process kill. Snapback 1’s hole was exactly this class of witness (`issues/20260806-expo-file-carrier-process-kill-witness.md`).

**Resolve.** Split witnesses: O2 browser = rows + outbox, kill *during* `swap` once, enqueue before kill, no images, no expiry. O4 adds images, view-once non-render, simulator. Expiry belongs with M5 acc 1 / M6 acc 1, on a recipe that can actually evict (B2).

### M6. O2 “parallel with O1 against a stub” will build the wrong store

**Claim.** O2 is T+10 parallel with O1 against a stub (`§12`). O1’s receipt “is what makes lane O2’s store row-per-range rather than an opaque blob” (`§8`).

**Resolve.** O2 starts when the receipt type in B1/M2 is frozen, even if the route is stubbed. An opaque-blob O2 is Snapback 1 RQS and will be thrown away.

## 4. Minor findings

- `E_RETAIN_POLICY` is check-time; put it in `schema` or `quarry`, not `offline`. `E_INTENT_EXPIRED` is a mutation refusal; `offline` is fine if the page exists, else `input`. Families today: `bound|opaque|schema|rule|auth|args|op|successor|effect|input|owner|quarry` (`families.source.json`, 1002 §4:402). Adding `offline` matches 1010’s `quarry` addition.
- Accept explicit `retain until-revoked`; don’t make the default spelling a refuse.
- `fence: { days }` vs `maxOfflineAgeDays: 7` — the nested object is extra surface. Client option, not schema: right split (device trust bound; server only has 30 d).
- `want: 'receipt'` on resume duplicates `receipt=1`. One spelling.
- `denied` in the §5 table is real for `require` (thread: `MEMBERSHIP_REQUIRED`, `messages.q:4`; query `Require` → `Denied`, `engine/mod.rs:788–800`) and *not* for a uniformly false scan without `require` (complete empty, `runner.rs:985–987`). Say that.
- `predicted` as a flag on `queued` is the right inversion of 0329.014.007’s `predicted → queued → …`. Keep it off the wire.
- §1’s “checked against `42a7a4e3d`” is a different commit than this capsule; the facts still hold at `9ffdf6dd0`.
- LLP 1001 Deferred still lists “retention and `maxOfflineAge`” (`1001:802–803`); O1 must strike that when it lands.

## 5. Answers to the eleven questions

**1. Absent vs hidden.** Point reads: yes, at `runner.rs:671–688` (hidden = `Null` and no receipt absence; missing = absence). Ranges: no. `ReceiptRange.absence` is empty-page (`runner.rs:1004`); hidden rows are truncated out (`runner.rs:895–901`); non-uniform ranges ship no range fact (`runner.rs:985–1008`). Fallback “keep” is the disclosure-correct policy and, for a range-held `messages` thread, leaves expired bodies on the phone. Right design is B2.A: history lives on the log; message bodies are point-held.

**2. Resume.** Not bounded, not honest against existing digests (B1). Fifty conversations × 200 pages is 200 owner-thread executes; unchanged still *runs* the query to hash it. A read transaction is the right *invariant* (one `seq`); the owner already gives it by being single-threaded, so a wrapping `BEGIN` is optional. Missing from the shape: `generation`, a named digest algorithm, a `held[]` cap, remaining `idBlock`, and a coverage-only receipt update. `epoch` is the right auth fence (`writer_auth.rs:1–2, 72`).

**3. Ids.** The engine hook exists (`Context.new_ids`); the HTTP path cannot use it (M3). Exhausted block: today `newId envelope exhausted`, should be `E_ID_BLOCK` and stop minting offline. Wipe: if the partition is wiped with the session, outbox is gone — say so. Two devices: two sessions, two blocks, no collision if ids stay store-unique (the current allocator already never reuses, `store.rs:292–293`).

**4. Receipt on the wire.** Serializable as-is (`Serialize` on `ClosureReceipt`). Generation-bound: only `schema_hash` on absences (`engine/mod.rs:224–226`; cleared on mismatch, `client.rs:162–169`). Not small enough: it duplicates `data` and carries halo rows. Cut rows/halo-bytes; add `planHash` / `evaluatorVersion`; don’t emit on frames whose coverage did not change.

**5. Delivery-log recipe.** Does not compile (`retain`, `{ . }`). Fan-out `first 50` fits `write_rows: 2048` and the template’s 50-member cap; it silently drops member 51. One range does *not* cover thread, in-chat search, reactions, view-once, or disappearing; it covers inbox + “filter held log in JS” if the app drained. Per-viewer log is a server mailbox and a client result cache of named pages — F11’s “not a replica” holds iff O3 only runs named programs. Search-in-JS is the one bend; ruling 6 already took it.

**6. Outbox.** `queued → committed|rejected|expired` with `predicted` as a flag is the smallest durable machine; keep `predicted` off disk identity. Same-carrier transaction is achievable: one IndexedDB database, several object stores, one `transaction`; SQLite natively. FIFO + independent settlement is honest for inserts and idempotent toggles; the user-hostile case is “create group rejected, later send still drains and dies `NOT_MEMBER`,” and “503 mid-drain leaves a prefix committed and the rest `queued`.” Expiry after 7 d of a still-visible predicted row will look like a vanished send — the UI must show `expired`. Reactions need upsert, not insert; the recipe doesn’t have them (bar acceptance doesn’t either).

**7. Fence.** Nothing in the runtime still assumes “untrusted past the fence.” `retention.rs` is closure-byte estimation. 1001 lists retention as deferred. Server does not need the client’s `days`; it only needs `issuedAt` and the 30 d hard stop. Do not send the client fence up.

**8. Spellings.** `retain` as a table line matches `immutable` / `public`. `fence` and `maxAssetBytes` as client options match 1002’s `createClient` bag, not 1010/1011’s grammar. New `offline` family is consistent. Move `E_RETAIN_POLICY` to `schema`/`quarry`. Schema: retention policy. Client: fence, byte ceiling, carrier.

**9. Carriers / witness.** Interface is slightly large (assets) and too small for O3 (no absences/verdicts) — M1. Loud `E_OFFLINE_CARRIER` is the right lesson from Snapback 1’s memory fallback (`guide/sync/offline-and-retention.md:99–103`). No encryption claim is right. Witness misses mid-swap kill, pre-kill enqueue, IDB quota eviction, and it asks O2 to prove O4 images (M5).

**10. Lanes / trade.** O1 → O3 is real (receipt + program). O2 cannot honestly parallel O1 on a blob stub (M6). O4 with Expo is right. v1 extras the bar does not need: digest-`unchanged` as a *wire* optimization (full redelivery would pass M6; the cap in B1 is what the owner needs). Missing for the bar: a purge path that actually evicts expired *and* view-once bytes (B2 + O4); drain-to-end of the log as app recipe, not platform magic.

**11. Surface.** Pay: `retain`, receipt-on-wire (coverage form), `/api/resume` with a cap, id blocks, outbox states, `E_OFFLINE_CARRIER`, process-kill witness, `ByteCache` under the row. Do not pay: duplicate `receipt.rows` on every frame; `want: 'receipt'`; nested `fence: { days }`; `denied` as if it were a range fact; `assets` on the O2 interface; `{ . }` / unparsed `retain` in the recipe; O2-against-stub; `kind` enum as a complete messenger; shipping `predicted` as a fifth durable state.

## 6. Strengths

Do not lose these. The client stays a result cache (F11), not a replica; `partial` stays honest. Two retention words, default silent. Fence bounds trust, not reading — the 2026-09-04 ruling, and the code does not fight it. `predicted` as a flag, not a state. Same-swap crash consistency. Loud carrier, no memory fallback, no encryption theatre. Asset bytes under the row’s lease (1006 §9b). Opt-in `receipt=1` so today’s clients do not move. Search labeled “in downloaded messages.” The trade (1009 off) is a real paying move. The witness *kind* — physical kill, backend down — is the Snapback 1 hole, correctly named.

## 7. Open questions for the author

None on the thirteen rulings. Two mechanism picks, if you want them now rather than in O1:

1. B2.A or B2.B for message history vs expiry.
2. Held-page cap (256?) vs “drain the whole log and pay N executes at resume.”

## 8. If I owned O1

I would not touch IndexedDB. I would add `retain` to the table grammar and the certificate, put a *coverage-only* receipt behind `receipt=1`, define one canonical digest on the query response, and land `POST /api/resume` as N owner-thread executes at one `seq` with a hard `held[]` cap and cumulative session id blocks injected through `Context.new_ids`. `E_INTENT_EXPIRED` at 30 d on `issuedAt`. Stop there. That is the minimum that makes O2 a range store instead of a blob, and it is the part of 1012 the current engine can grow without lying about digests, absences, or bounds.

