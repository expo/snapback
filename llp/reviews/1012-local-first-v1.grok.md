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

**Evidence.** Steps 1–3 never enqueue a message, yet step 3 asserts one is still `queued`. Images are O4 (`§9`, `§12`). Mid-swap crash is asserted (“A crash mid-swap leaves the previous generation intact, which the kill witness asserts,” §4) but the procedure kills *after* drain, not during `swap`. Browser IDB eviction under quota is not a process kill. Snapback 1’s hole was exactly this class of witness (`issues/shelved/20260806-expo-file-carrier-process-kill-witness.md`).

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



---

## Round 2 — proposals (2026-09-04, later the same day; verbatim)

**Method:** round 2 on the brief preserved at `1012-local-first-v1.panel.brief-r2.md`, which carried the orchestrator's verified round-1 synthesis and asked for designs rather than critique, per the author's instruction. grok-4.6, same runner as round 1; self-reported effort `high` this round.

Reviewer: grok-4.6 (high) · Date: 2026-09-04 · Method: round 2, proposals, read-only capsule at 9ffdf6dd0, after the verified round-1 synthesis

Designs, not a second review. Citations are against this capsule. The thirteen rulings stand; these sketches implement them.

---

## 1. The purge design

**A + B, with C as the generic client rule.** No `evictions[]`. No bodies on the log row. No engine change to receipt facts.

The engine already proves: a point miss is an absence (`runner.rs:677-688`); a hidden point is `Null` with none (`runner.rs:671-676`); only a certified-uniform range ships a range fact (`runner.rs:985-987`); hidden candidates are stripped (`runner.rs:895-902`); a non-uniform range ships no coverage. Messenger reads in the recipe are uniform. Leave-group hides a *conversation*; delete and expiry remove *one row*. Those two cases must not share a policy bit.

### Swap rule (once per swap, union of claims)

A row that slid from page 1 to page 2 must survive. After the swap is assembled:

1. **Point absence** for `(table, index, key)` drops that row. That is how a *body* dies.
2. **Uniform-extent hole (C).** On a granted `ReceiptRange`: if `stop = Exhausted`, the interval is the prefix bounds; if `stop = Limit`, it is the closed key interval from the first `row_ids` entry to the last (halo is a presence). A held id whose index key sits in that interval and is not in `row_ids` ∪ `{halo.id}` is gone. Reading of `runner.rs:985-1008`, not a new fact.
3. **Denied range.** `until-revoked` drops that range’s claims; `delivered-history` keeps them. A hole from (2) still evicts — deleted is not “history”. History means *revoked-for-you*, not *deleted-for-everyone*.
4. Zero remaining claims → the row leaves, and so do its asset bytes (O4).

### What the app author writes

`retain` is a certificate line the *client* applies.

```q
table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  kind: enum('message', 'edit', 'delete', 'expiry')
  at: time
  by byRecipientAt: recipient, at, id
  by byRecipientConversationAt: recipient, conversationId, at, id
  immutable recipient, conversationId, messageId, kind, at
  retain delivered-history
  read <- .recipient = viewer
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny

query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipientAt
  return page { *, message: messages[.messageId] }

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId] after c last 50 by byRecipientConversationAt
  return page { *, message: messages[.messageId] }

mutation deleteMessage(id: messages):
  row = messages[id] ! else NOT_FOUND
  require row.authorId = viewer else NOT_AUTHOR
  delete messages[id]
  for m in memberships[row.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: row.conversationId, messageId: id, kind: 'delete', at: now }
```

`messages` stays `until-revoked` (omit the line). `first 50`, not 200 (`E_BOUND` at 3,456,012 bytes). Spread is `*`. Thread is a log index, not `messages[conversationId]`. Fan-out `first 50` matches `members: [principal] <=49` plus creator (`templates/chat/snapback/groups.q:1`).

Delete and expiry **must** append a log row **and** delete (or refuse) the `messages` row. The tail point-join is then an absence, and rule (1) drops the body everywhere. The original `kind: 'message'` row stays; the app renders a tombstone from the later row. That is B, and it makes watermark resume in §2 sound: a prefix that is not re-executed never sees a hole unless the tip carries one.

Leave-group: `insert` requires membership, so no new log rows. Old log rows stay. The point-read of the body is hidden, not absent, so the held body stays — delivered-history for messages **without putting the word on `messages`**. Do not subscribe a `messages` range.

Disappearing messages have no server clock (`schedule` is refused). M5 acceptance 1 depends on a caller-invoked `purgeExpired` that does the same two writes with `kind: 'expiry'`. That mutation is a Clique recipe dependency, not an engine change. View-once is excluded at view time (a local `viewed` set consulted before `answer()`); owner is O4. A later purge re-renders on cold start.

### What `retain` means

`until-revoked` (default): denied coverage drops claims; holes and absences evict. `delivered-history`: denied coverage keeps claims; holes and absences still evict. Check-time `E_SCHEMA_RETAIN`, family `schema`/`quarry`, rewrite listing the two words — not `E_RETAIN_POLICY` in `offline` (`RefusalFamily` is `bound | opaque | schema | rule | effect | args | op | input | quarry`, `packages/compiler/src/ir.ts:188`).

**Rejected:** (D) body-on-the-log — `deliveries` is immutable, so disappearing-message bytes cannot leave the original row. **Rejected:** (E) `evictions[]` — restates C for uniform sites and does not exist for non-uniform ones. **Rejected:** C alone — a watermarked log never re-executes the prefix.

**Cost.** One certificate field per table, one client rule. **Pays.** M5/M6 acceptance 1 against the engine that exists; leave-group history without a replica; §2 is sound.

---

## 2. Resume a phone would love

Reconnect is **one log watermark plus a capped digest check of everything that is not that log**, then one generation swap, then the outbox. Ruling 5 (watermark on ordered ranges, full re-delivery elsewhere), spelled so the exclusive owner (`writer.rs:70-82`, `store.rs:97-108`) does a handful of executes.

The drained inbox is **one logical range**, not 200 pages. Delivery rows are immutable; the prefix never changes; new mail, edits, deletes, and expiry append. The watermark *is* re-authorization of the log.

### Wire

```
POST /api/resume
{ generation, schemaHash, authEpoch,
  log: { op: "inbox", args: {}, watermark: { at, id } | null, digest },
  mounted: [{ op, args, digest }],   // visible now; cap 16
  held:    [{ op, args, digest }] }  // unmounted non-log; cap 64

→ 200 { seq, generation, schemaHash, authEpoch, digestAlgo: "sha256-canonical-v1",
        log: { unchanged: true } | { ...queryResponse, receipt, digest, watermark },
        mounted: [{ op, args, unchanged: true } | { op, args, ...queryResponse, receipt, digest }],
        held: [same],
        clientId, lastMutationId,
        grant: { mintedAt, validUntil, ids: { from, count } } }
→ 409 E_OFFLINE_RESET  { generation, schemaHash }  // drop coverage, keep sealed outbox
→ 413 E_OFFLINE_RESUME { which, cap, rewrite: "drop oldest unmounted pages" }
```

No `want: 'receipt'`. No bare `epoch`. The receipt is the frozen O1 object in §7, never a second copy of `data`.

**Canonical digest:** the engine’s `digest` (`value.rs:242-246`) over `{ state, result, next, generation, schemaHash, authEpoch, ranges: [{ site, table, index, prefix, bounds, row_ids, stop, absence, haloId }], absences, verdicts }`. Not `delivery_digest` (`live.rs:17-19`) and not `frame_digest` (`writer_values.rs:56-61`). A new absence or a new verdict epoch busts it. Put it on every query and the first subscribe frame so the client has something to echo. Predicted overlays are excluded.

### Server order, owner thread, one `seq`

Serialization already gives one version (`mod.rs:728-734` plus exclusive lock). No wrapping read transaction.

1. Authenticate. A dead session *seals* the partition until the same principal re-authenticates; sign-out or a different principal wipes. (Sessions are 30 days with no renewal, `identity.rs:15`.)
2. `generation` / `schemaHash` mismatch → `E_OFFLINE_RESET`.
3. Stale `authEpoch` for this token → seal, no data.
4. Mint/refresh the id grant (§3) if remaining < 32.
5. Execute `inbox after watermark first 50`. Empty tail and matching digest → `{ unchanged: true }`; else the page. A long tail is ordinary drain after this request, not resume.
6. Execute each `mounted` and `held`, compare digest. Refuse over cap.
7. Do not reopen SSE. Swap, *then* outbox, *then* subscribe — that kills the double-execute (`live.rs:117-146`).

Two tabs: `navigator.locks.request("snapback2:" + principalId)`. Loser: `E_OFFLINE_LOCK`, rewrite “this account is open in another tab”. `lastMutationId` cannot have two writers.

### Clique cost, roughly

Fifty conversations, 10k drained, 200 new in five chats, one thread on screen, conversation list as **one** query.

| | Wire | Owner executes | Owner time |
|---|---|---|---|
| Unchanged hour | ~1 KB in, ~0.5 KB out | 1 tip seek + 1 list + 1 thread | single-digit to tens of ms |
| 200 new | one 50-row page (≤ ~0.8 MB worst-case with `text <=4000`; typical tens of KB) + two hashes; three more pages as drain | 1+2, then 3 | tens of ms, then catch-up |
| Schema generation change | `E_OFFLINE_RESET`, then a fresh drain | drain | first-install cost |

**Rejected:** re-executing every held page under a cap of 256 — it stalls the only thread that can touch SQLite. The log is one range.

---

## 3. Ids and replay, the smallest correct scheme

**Session-issued id blocks plus Replicache’s `clientId` + `mutationId` + `lastMutationId`.** No intent UUIDs. No client `issuedAt`.

Idempotency and identity are different jobs. The mutation id does the first; the block does the second; the grant’s `mintedAt` does age. `Context.new_ids` (`mod.rs:23`, `runner.rs:392-397`) stays the injection point LLP 1001 §8 already names.

### Wire

Login, guest, and resume return the grant in §2. The partition stores `{ clientId, lastMutationId, grant }`.

```
POST /api/mutation
{ op, args, clientId, mutationId, ids: ["s2id-<ns>-…"] }
```

`clientId` is bound to this `auth_epoch`. `mutationId` is a u53, monotonic per `clientId` from 1. Clients with no store omit the envelope; the server keeps today’s `reserve_new_ids()` path (`writer_auth.rs:152-156`, block of 1,024, `store.rs:294-368`).

### What the server checks (the OCC question)

There is no base-seq OCC in the invoked path (`mod.rs:728-756`). Ruling 4 survives as: the server applies the intent against **current rows**; conflict detection is a `require` the mutation authors. Sends do not conflict. An edit:

```q
mutation editMessage(id: messages, body: text <=4000, baseBody: text <=4000):
  row = messages[id] ! else NOT_FOUND
  require row.authorId = viewer else NOT_AUTHOR
  require row.body = baseBody else CONFLICT
  replace messages[id] { body }
```

Before `execute`:

1. `clientId` belongs to this `auth_epoch`, else `E_AUTH_SESSION` (seal, do not wipe).
2. `grant.mintedAt` (server time) older than 30 days → `E_INTENT_EXPIRED`. Never a client clock.
3. `mutationId <= lastMutationId` → return the stored `{ state, seq, data }` for that id. This is the 503-after-commit path. Keep the last 32 results per `clientId`; older than that and `<= last` returns `{ state: "committed", seq, data: null, replayed: true }`.
4. `mutationId != lastMutationId + 1` → `E_MUTATION_GAP`, rewrite “replay in order”.
5. Every `ids[]` entry lies in the union of unexpired grants for this `clientId`, is unused, and matches this program’s `newId`/`emit` count. Else `E_ID_BLOCK`.
6. `context.new_ids = VecDeque::from(ids)` — do **not** call `reserve_new_ids()`.
7. `execute`. Commit persists the result, marks ids used, increments `lastMutationId`. Reject still consumes `mutationId` (retry of the same envelope is stable) and the ids (gaps are already allowed, `store.rs:292-294`).

### Failure shapes

- **Block exhausted.** Client refuses locally with `E_ID_BLOCK` before enqueue when remaining < this intent’s inserts. Resume mints another 1,024 only if remaining < 32. No silent reuse.
- **Device wiped.** Partition gone, including `clientId` / outbox / grant. New session, `mutationId = 1`, new block. Leftover server ids are gaps. The wiped outbox is not retried.
- **Two devices.** Two sessions, two `clientId`s, two counters, two blocks. The log is per-recipient (ruling 2).
- **Parent rejected.** FIFO continues (ruling 4). Child `send` whose `ids` point at an uncommitted group fails the `ref`/`require` on current rows and comes back `rejected`. No cascade in v1.
- **503 after commit.** Intent stays `queued`; retry the same envelope; step 3 returns the stored commit.

The client pins ids from the grant at enqueue, so a later O3 prediction and the commit mint the same ids. Until O3, the thread renders from `args` keyed by `mutationId` (§4.3).

**Rejected:** client-minted UUIDv7 — bypasses `new_ids`, does not look like `s2id-<ns>-<seq>`, carries no server time. **Rejected:** intent-id dedup alone — the 503 hole still needs a monotonic per-client id, and pinning ids is one array on a wire already changing.

**Cost.** One `_client_replay` table; tens of bytes per in-flight mutation. **Pays.** Double-send is gone; dependent ids work; the 30-day rule is a server timestamp.

---

## 4. Make it feel like WhatsApp

Three additions inside NOT-DOING’s v1. Ranked by how much they change the next day of work.

### 4.1 `journey` can cut the network, kill the process, and name what the phone still holds — rank 1

Extend the journey runner (`packages/snapback2/src/test.ts`; owner already has `/control/clock` and `/control/stop`, `control.rs:150,203`):

```ts
journey("offline-send-and-search", async ({ as, cut, restore, kill, held }) => {
  const alice = as("alice");
  await alice.mutation(api.send, { conversationId, body: "before" });
  cut();                          // transport fence; owner still up
  const q = await alice.mutation(api.send, { conversationId, body: "queued" });
  assert(q.last.state === "queued");
  assert(alice.searchHeld("before").length >= 1);
  kill();                         // drop the JS heap; reopen the same partition
  const alice2 = as("alice");     // cold start, still cut
  assert(held("inbox", {}).data.length >= 1);
  restore();
  await alice2.outbox.idle();
  assert(alice2.outbox.states().every((s) => s === "committed"));
});
```

`cut`/`restore` model M5 acceptance 5 (warm-offline, app still running). `kill` is a new client on the O2 Node file carrier. The scheduled physical witness still does a real tab discard and a simulator SIGKILL; this is the loop the agent runs in five seconds. Expiry: `cut(); await clock(ttl + 1); restore();` then recipe `purgeExpired` + resume, then `held` no longer contains the body.

**Cost.** ~150 lines in `test.ts` plus a `cut` flag on the test client. No production surface. **Pays.** M5 acc 5 and M6 acc 1–2 become ordinary journeys. **Prove.** One `chat` template journey in the sixty-second set.

### 4.2 `useDrain` — “everything on the phone” is one hook — rank 2

A React hook (and `client.drain(op, args)`) that, while online, follows `next` until `null`, persists the last complete page’s watermark, and exposes `{ data, watermark, catchingUp, connection, stale }`. Subscribe is `inbox after watermark`, not one live subscription per drained page. The recipe says: call this once at the principal root; open a thread with `useQuery(api.thread, { conversationId })`.

**Cost.** One hook, ~80 lines; one recipe; the resume shape in §2. **Pays.** Yesterday’s chats survive a flight-mode cold start; the agent does not write a 200-page loop and then fail resume. The drain-to-`next: null` policy becomes the paved form. **Prove.** Seed 10k across 50 conversations; `catchingUp` becomes false; `cut(); kill();` search finds message 1 and message 10,000, labeled “in downloaded messages”.

### 4.3 Pending bubbles from `args`, labeled “Sending…”, no client clock — rank 3

In O2, before any twin: `useMutation(api.send).pending[]` overlays the open thread, keyed by `mutationId`. The bubble shows `args.body` and **Sending…**. It does not show a time. On `committed`, the overlay drops and the server row (server `at`) takes its place, keyed by the pinned `ids[0]`. On `rejected`, **Not sent** plus the refusal rewrite. On `expired`, **Expired**. Two queued sends keep FIFO order in the overlay.

**Cost.** The hook already returns `pending[]`; the `chat` template spends ~40 lines. Zero extra wire bytes. **Pays.** The person sees their own message while the radio is down; the agent does not invent a second local table; a skewing `issuedAt` never renders as “2:14 PM”. **Prove.** Journey 4.1 asserts `threadShows("queued")` before `restore()` and `threadShows("committed")` after.

Not proposed: cancel-while-queued (NOT-DOING candidate 8), read receipts as extra fan-out, a local token index, merge modes.

---

## 5. Steal one thing

**Replicache’s `clientID` + `mutationID` + `lastMutationID`.**

Replicache is a client view with a push queue, not a SQL replica. Each client names its mutations with a monotonic integer; the server stores one integer per client and replays or ignores anything at or below it. Snapback 2 is already “a result cache plus cursor state plus an outbox, never a relational replica” (LLP 0329.014.007 F11, ruling 2). The outbox is the push queue. The missing piece is the integer.

It fits the other principles: the certificate still gates what a mutation may do; a replayed envelope either re-returns a stored result or runs the certified program against current rows; nothing is invented. It does not pull in Replicache’s rebase, its key-value model, or its cookie-over-the-whole-view.

**It replaces:** the spec’s `{ id: uuid, issuedAt }` intent identity; a server-side set of consumed UUIDs; the prose that a 503 after commit stays `queued` with no idempotency key; any temptation to treat a client clock as the 30-day bound.

ElectricSQL’s shape+offset is the ancestry of §2 (a certified uniform range *is* a shape; the watermark *is* the offset) and is already ruling 5. WhatsApp’s per-device queue is already ruling 2. PowerSync’s CRUD `op_id` is lastMutationID with more envelope. CloudKit change tokens and Firestore’s latency-compensated snapshots both want a replica. Linear’s sync engine is the closest cousin after Replicache; Replicache is the smaller object — one integer per session, which is what v1 can afford on an exclusive SQLite owner.

---

## 6. Cut

Remove from 1012 v1 everything the offline bar does not need. The bar is M5 acceptance 5, M6 acceptance 1 and 2, and the physical kill witness.

| Cut | Why the bar does not need it | What it unblocks |
|---|---|---|
| **Lane O3** as a condition of the bar | Cold-start reads are held answers; search is an app filter; pending renders from `args` (§4.3). | O1 freezes a receipt for a phone. O2 is not “against a stub”. |
| **Re-authorizing every drained log page** | The log is immutable; the watermark re-authorizes it (§2). | Resume drops from hundreds of owner executes to a handful. |
| **`delivered-history` on `messages`** | Point-held bodies survive hide and die on absence (§1). Keep the word on `deliveries`. | The recipe stops lying about a messages range. |
| **Template `thread` over `messages[conversationId]`** | No conversation prefix on `(recipient, at, id)`. Use the second log index. | Inbox drain *is* the thread’s coverage. |
| **`want: 'receipt'`** | Duplicates `receipt=1`. | One spelling. |
| **`receipt.rows` on the wire** | `data` already has visible rows; halo can be an id (`mod.rs:88-92, 191-208`). | Frames stop doubling; the 1 MiB output ceiling (`certificate.rs:31-42`) stays livable. |
| **`assets` on the O2 `RangeStore`** | O4. | O2’s interface matches what it implements. |
| **Client `issuedAt` as a protocol field** | Age is `grant.mintedAt` (§3). | No fake clock in the bubble (§4.3). |
| **Engine OCC / a base-seq envelope** | Not in the invoked path; inserts do not conflict; edits `require` a field (§3). | Ruling 4’s intent without a fictional mechanism. |
| **Wipe-on-terminal-`E_AUTH_SESSION`** | A 30-day session with no renewal is a monthly history wipe. Seal until the same principal returns. | M6 cold start still works on day 31 after a re-login. |
| **View-once and images in the O2 witness** | One-use delivery is deferred in LLP 1006; images are O4. | O2 tests rows + outbox + mid-swap + enqueue-before-kill. |
| **`fence: { days }` beside a flat `maxAssetBytes`** | One bag: `createClient({ offline: { maxAgeDays: 7, maxAssetBytes: 256e6 } })`. | U7 spelling. |
| **`swap(gen: Generation)`** | Collides with engine `Generation` (`registry.rs:42`). Rename `applySwap(generationId)`. | O2 can type the carrier. |
| **Recipe `first 200` and bare `.`** | Check refuses both. | The snippet in the spec compiles. |
| **An `offline` family for `retain`** | Check-time, `schema`/`quarry`. Keep `offline` for the runtime codes in §7. | Diagnostics match `ir.ts:188` plus one runtime family. |

Do **not** cut: the durable range store, the FIFO outbox, `receipt=1`, `POST /api/resume`, id blocks, the two-word `retain` (ruling 8), the physical witness, asset bytes under the row (ruling 7, O4), the fence as a trust bound (ruling 1). O3 remains a lane. It is not on the offline bar. `predicted` waits with it.

---

## 7. Lane O1 on one page

Freeze the **wire receipt**, the **canonical digest**, the **resume request/response**, and the **mutation envelope**, so O2 builds a row-per-range store against types, not a stub. No `RangeStore`, no IndexedDB, no twin, no assets.

Land in this order. Each step has a test O2 may pin.

1. **Wire receipt + digest (types only).**
   Files: `snapback2-core/src/engine/mod.rs` (`WireReceipt`, conversion that **drops `rows`**, halo → `haloId`); `value.rs` (`resume_digest` over the object in §2); `packages/snapback2/src/types.ts`.
   ```ts
   type WireReceipt = {
     schemaHash: string; planHash: string; evaluatorVersion: string;
     ranges: Array<Omit<ReceiptRange, "halo"> & { haloId?: string }>;
     absences: Array<[string, string, unknown[]]>;
     verdicts: Verdict[];
   };
   ```
   Tests (`crates/snapback2-core/tests/wire_receipt.rs`): point miss records an absence; hidden point does not; uniform exhausted range present; non-uniform range absent; `rows` empty on the wire object; digest stable across `seq`; digest changes when an absence is added. **O2 may start here.**

2. **`retain` in Quarry, schema, certificate.**
   Files: `packages/compiler/src/quarry/parser.ts` (next to `immutable` at `parser.ts:104-137`); `quarry/schema.ts`; `ir.ts` (do not add an `offline` family for this code); `snapback2-core/src/schema.rs` (`Table.retain`, default `UntilRevoked`); `certificate.rs`; fixtures `retain-*.q`.
   Tests: omit → `until-revoked`; `retain delivered-history` accepted; `retain purge-on-block` → `E_SCHEMA_RETAIN`, family `schema`, rewrite “until-revoked or delivered-history”. Hyphenate `delivered-history` as one lexer token (`lexer.ts:7,96` cannot see it today).

3. **`receipt=1` on query and subscribe.**
   Files: `serve.rs` (`POST /api/query` at `402-412`, `GET /api/subscribe` at `413-437`); `writer_wire.rs:8-36` (`digest` always, `receipt` when asked); `packages/snapback2/src/client.ts:385-441`.
   Tests: default body equals today’s JSON plus a digest; `receipt=1` has `receipt` and no duplicated row map; a missing point includes an absence; a hidden alternate-key point does not (`runner.rs:671-676`) — existence-oracle regression. Do not send the receipt on every later SSE frame unless coverage or digest changed; the first subscribe frame always has it.

4. **`POST /api/resume`.**
   Files: `serve.rs` match arm; `writer.rs` `Action::Resume`; new `writer_resume.rs` (keep `writer.rs` under 1,500 lines); `protocol.rs` refusals `E_OFFLINE_RESET`, `E_OFFLINE_RESUME`.
   Caps and order as §2. Tests: `log.watermark = null` returns a first page; matching empty tail → `unchanged`; `mounted.length = 17` → 413; `generation` mismatch → 409; execute count equals `1 + mounted + held`, not page count; resume does not open a subscribe.

5. **Mutation envelope.**
   Files: `serve.rs` `POST /api/mutation`; `writer_auth.rs:145-157`; `store.rs` `_client_replay` DDL next to `_sessions`; grant mint at login, bound to `auth_epoch`.
   Tests: no envelope → today’s `reserve_new_ids` path; pinned ids inject and skip reserve; id outside the grant → `E_ID_BLOCK`; `mutationId` replay returns the same `seq`; gap → `E_MUTATION_GAP`; grant older than 30 days → `E_INTENT_EXPIRED` via `/control/clock`; two `clientId`s do not share a counter; short `ids[]` maps `newId envelope exhausted` (`runner.rs:392-397`) to `E_ID_BLOCK`.

6. **Diagnostics page.** `E_SCHEMA_RETAIN`, `E_OFFLINE_CARRIER`, `E_OFFLINE_RESUME`, `E_OFFLINE_RESET`, `E_OFFLINE_LOCK`, `E_OFFLINE_FENCE`, `E_ID_BLOCK`, `E_MUTATION_GAP`, `E_INTENT_EXPIRED`. Each: family, site, rewrite, guide slug. Add `"offline"` to `RefusalFamily` **only** for the runtime codes.

7. **Recipe compile, not adopt.** Fix LLP 1012 §3’s snippet to the §1 recipe. `snapback2 check` green on that file. The `chat` template adopts it in O2.

O2 starts at the end of step 1 against frozen `WireReceipt`. It must not start against `ClosureReceipt` as-is. O3 is not on this page.

---

## 8. If I could change one ruling

**Ruling 3 — “offline reads are staged: O2 then O3.”**

The offline bar is M5 acceptance 5, M6 acceptance 1 and 2, and the kill witness; those are held answers, a drain, an outbox, and a purge, not local evaluation. Staging the twin into the same v1 that has to meet that bar is why O2 was specified to run against a stub of a receipt O1 might still reshape, and why `RangeStore` grew `rows()` / `ranges()` before it grew a carrier. Make O2 the offline bar; let O3 start when a brief measures unpredicted sends as a problem. Ruling 4’s `predicted` flag waits with it — §4.3’s pending bubble from `args` is what the person sees in the meantime. I would not touch ruling 5: watermark resume on the ordered log is already the right ruling; only the spec text drifted to “every held page.”
