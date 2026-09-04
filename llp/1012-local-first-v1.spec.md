# LLP 1012: Local-first v1 — the client store, the outbox, retention, and the offline bar

**Type:** Spec
**Status:** Review (revision (c): the author's principle of 2026-09-04, "go as straight as possible to the ideal thing", closed revision (b)'s three questions — no staging, the twin is the client, trace-validated OCC in v1, ruling 8 stands; one scheduling question remains in §"Open questions (author)"; per `rules/RULES.md` it binds lane by lane as each lane's code lands)
**Systems:** `snapback2/packages/snapback2` (client, React, the range-store carriers, the `chat` template, the recipes, the journey primitives), `snapback2/packages/compiler` (the certificate's retention line if ruling 8 stands), `snapback2/crates/snapback2` (the wire: the frozen delivery envelope, `/api/resume`, the replay envelope, grants), `snapback2/crates/snapback2-core` (`_client_intents`, grants, the public receipt projection; `ClientStore` as the reference replay), LLP 1006's asset client (the device byte cache), `rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, at the author's direction and rulings, 2026-09-04
**Date:** 2026-09-04
**Revised:** 2026-09-04 (h — fix-forward record, lane O2b fix round 2: a committed intent's overlay leaves on a page of the tail chooser's query or a delivery holding a predicted row, and any other swap that moves the store past the commit is one miss of two, after which the overlay is dropped and the entry retired from prediction (§7); the hasher's `List` arms refuse unknown fields (§8); the twin's hydrate catch is typed and a bug propagates (§6); a delivery under another generation or schema is not held and supersedes the coverage, so offline reads are `hydrating` until the next resume's reset, while `E_OFFLINE_AUTHORITY` keeps principal and auth-epoch mismatches (§8, §15); `client.outbox.ready()`, `useOutbox().ready`, and `useMutation().ready` gate the chat composer until a drained query has earned a grant (§7)); 2026-09-04 (g — implementation record, lane O2b and its fix round, the twin is the client: the evaluator is split into a store, a runner, and the entry and traces every point read with the digest of the wire row it disclosed, a hidden hit as an absence, and verdicts only from rule checks that disclosed their row (§6, §7); one schema and rule hasher mirrors serde's field order, refuses any field serde's struct does not carry, deep-sorts unknown variants, and the hydrate path recomputes the hash and refuses a mismatch (§6, §8); the program is held per generation beside the write bounds and re-fetched after `E_OFFLINE_RESET` (§6, §8); the drained-prefix rule is a chain of held pages on one (table, index, prefix, rule) from `after: null` to Exhausted, a page that lost a member since it was recorded is no link, and once Exhausted a page of the group holding a row the chain does not hold breaks it (§6); prediction runs inside the grant's critical section with the slice as its ids and lands overlay, trace, and `predicted` in the entry's own swap (§7); three deviations from "if every read is covered" are recorded: an uncovered range does not block a prediction, an unheld engine-maintained aggregate target does not block it and the omitted names ride the prediction, and a committed intent's overlay is dropped by an answer at or after the commit seq that touches one of its tables or any page of a drained op, never by an unrelated answer (§7); with a partition open every write carries the replay envelope or refuses `E_OFFLINE_ID_BLOCK` before any request, and only a client with no store sends plain bytes (§7); local authority violations are `E_OFFLINE_AUTHORITY` and keep coverage (§15); the IndexedDB `ranges`/`absences`/`verdicts` projections are gone (§6); the twin measures 19.7 KB gzip, engine alone 16.9 KB, and NOT-DOING's 9.7 KB is re-baselined to the measurement (§13, §14)); 2026-09-04 (f — implementation record, lanes O1b fix rounds 1–2, O2c, O4-web and its fix round, and the integration seams: grants are minted only when the request's `remaining` is absent or below 1,024 (§7, §8); the resume log op must be a certified ascending cursor page of at most 50 rows and its envelope counts against the 1 MiB budget (§8); the intent ledger is consulted before any grant check (§7); a replayed intent that rolls back on missing authority is stored as its partial terminal (§7); on the rejected path the compare set is every traced point plus every verdict a reached or probed rule check derived on a disclosed row, unreached verdicts re-derive only through the read rule, and the rule inputs a hidden candidate minted are excluded on both paths (§7); the verdict `inputsDigest` is `sha256(canonical([table, index, key]))` over wire values (§7); a replay needs a live session and the grant outlives the session (§7); the outbox's grant slice is `1 + maxNewIds` from the op's certificate, a transport failure keeps the intent queued and the retry is the same envelope, and a committed settlement lands in the same swap as the log tail (§7); `close()` resolves when the carrier is quiet (§6); asset bytes are keyed `(assetId, width|null)`, evicted least-recently-read by each entry's own stamp under the store's logical clock, and a view-once row is tracked per `(table, id)` in a durable viewed set, marked at the first byte fetch for an image and at play for a clip, read `null` on every path and excluded from coverage (§9); `E_ASSET_VIEWED` and `E_OFFLINE_CONFLICT` join the `offline` family (§15); `messages.send` stays in the template beside `deliveries.post` because a fixture pin holds `messages.q` byte-equal (§3); one open question for the author, the fence's local expiry of queued intents (§7)); 2026-09-04 (e — implementation record, lane O1b: grants are minted on every login, guest, and resume because the server cannot see the client's remaining count (§7); a trace conflict takes precedence over a program rejection, so a member removed while offline settles `conflict` rather than the program's own refusal (§7); the point digest is over the canonical wire row, which is what the pool carries (§7); an empty trace commits without a conflict check, which is the client's spelling until the twin lands (§7)); 2026-09-04 (d — implementation record, lanes O1a/O1c: the validator covers the row pool, `args`, `reason`, and `rule` (§8); row references carry engine provenance and application values are escaped (§8); `n2Key` is not on the wire; `GET /api/program` returns the schema; the recipe's tombstones reach current members and a departed member's copy is evicted by point absence, because the engine's uniformity analysis collects both arms of an `or` and Quarry cannot build a list from a range (§3); the membership cap is a maintained count (§3)); 2026-09-04 (c — the author's principle applied: the twin is the client from the start and stored-answer replay is its covered case (§6); intents carry the twin's trace and the server validates point reads and verdicts at commit (§7); the retention word ships as ruled, on the table whose rows can hide, with its twin-side meaning (§5); the bar gains one acceptance only the twin can pass (§12); lanes collapse to O1, O2, O4; (b)'s Q1–Q3 closed); 2026-09-04 (b — the panel's designs folded: positive-fact purge (tombstone rows, point absences, uniform-extent holes; no engine change), a frozen delivery envelope with one server-minted validator, resume as one owner action over the log's watermark plus mounted queries, a replay grant with an intent ledger for exactly-once, the corrected and certified recipe (page 50, `*`, a second log index for threads, compare-and-set edits), seal-not-wipe on session expiry, Web Locks across tabs, the journey primitives, the split witness, lane O3 off the bar's path pending ruling; §16 records who found what)
**Related:** LLP 0329.014.004 §5 dimension F and §7 (the contract this implements), LLP 0329.014.007 F8 and F11 (the assessment; "not a replica"), LLP 0329.014.008 (the eight candidates — §11 says which this takes and which wait), LLP 1001 (engine: `ClientStore`, `new_ids`, receipts, absences, `_sessions`), LLP 1002 §4 (wire) and §9 (client states; `queued` reserved), LLP 1006 §9b (bytes on the device), LLP 1007 §4a (the two-bar pattern), LLP 1009 (shelved by the trade, §13), `benchmarks/briefs/social-messenger.md` M5–M6, `issues/20260830-snapback2-wire-evaluator-into-public-client.md`, `issues/20260806-expo-file-carrier-process-kill-witness.md`, `guide/sync/offline-and-retention.md` (Snapback 1's four mechanisms — what not to rebuild), `rules/NOT-DOING.md`, the panel record `llp/reviews/1012-local-first-v1.*`

## Summary

A WhatsApp-shaped app keeps its messages on the phone and reads them with no
network. On 2026-09-04 the author said Snapback 2 must do this well. This spec
is the implementing form of the design's local-first contract (LLP
0329.014.004 dimension F and §7), narrowed to what a messenger needs and no
further, with every choice ruled by the author the same day (§2), and its
mechanisms rebuilt by a panel of five model families the same day (§16).

The model in one paragraph. The client stays what the design says it is — *a
result cache plus cursor state plus an outbox, never a relational replica*
(LLP 0329.014.007 F11) — and gains a **durable, per-principal range store**
that keeps every certified answer the server delivered, rows stored once and
shared by every answer that holds them. "Every message on the phone" is a
*program shape*: a per-recipient delivery log, drained to its end and then
followed at its tail (§3). A phone learns that a message is gone from
**positive facts only** — a delete row in the log, a point absence in a fresh
receipt, or a hole in a fresh certified-uniform range — never from silence
(§5). The twin is the client: every named query replays on the phone over
held rows, exact where covered and `partial` where not, and a stored
answer is the case where everything is covered; a queued send is
predicted into the thread it belongs to; search is the app's filter over
held rows. Writes
offline go to a **FIFO outbox** under a **replay grant**; each intent carries
the twin's trace and the server validates it at commit, so a stale edit is
`rejected: conflict` and a lost response replays exactly-once (§7). Reconnect is **one owner action**: the log's tail after its
watermark, then each mounted query checked against a **server-minted
validator** the client only echoes (§8). The fence `maxOfflineAge` bounds
**trust**, never **reading**. Asset bytes cache under the owning row (LLP 1006
§9b). The evidence is a **physical process kill and cold start** on the iOS
simulator and a real browser, and the fast loop is a journey that cuts the
network and restarts the client in seconds (§10).

Of LLP 0329.014.008's eight candidates this takes none whole (§11). The trade
that pays for it on the doing-list is LLP 1009, observability, shelved (§13).

## 1. Where offline stood on 2026-09-04

Checked against `origin/main` at `9ffdf6dd0`, the commit that carried
revision (a), and re-checked by six panelists:

- **The shipped client is in-memory.** `packages/snapback2/src/client.ts`
  reconnects SSE with backoff and keeps the last delivery as `stale`; there
  is no durable store, no outbox (`queued` is reserved and never claimed, LLP
  1002 §9), and no local evaluation. The server sends a full result per
  delivery; the subscribe path sends `Last-Event-ID` and the server ignores it.
- **The twin exists and is unwired.** `packages/evaluator` is conformant with
  the Rust engine on the corpus; the public client never imports it
  (`issues/20260830-…`). The Rust `ClientStore` hydrates an in-memory engine
  from a closure receipt as a harness — the S1 spike's descendant.
- **The receipt distinguishes absent from hidden for point reads only.** A
  missing row records an absence; a hidden row returns `Null` with none
  (`snapback2-core/src/engine/runner.rs:671-688`). A range receipt is
  emitted only for a certified-uniform site and carries `row_ids`, `stop`,
  and a whole-range `absence` flag (`runner.rs:985-1008`); hidden
  candidates are truncated out (`runner.rs:895-902`); non-uniform ranges
  carry no range fact at all.
- **The owner is one thread over an `mpsc` channel** (`snapback2/src/writer.rs:70-82`)
  holding SQLite in `locking_mode = EXCLUSIVE` (`snapback2-core/src/store.rs:97-108`);
  every execution opens its own transaction (`engine/mod.rs:734`). "One seq"
  is a property of one owner action, not of a transaction.
- **There is no OCC in the invoked path.** `POST /api/mutation` carries `op`
  and `args` (`serve.rs:402-412`); the engine executes against current rows;
  nothing compares a base version. `mutation_context` overwrites
  `context.new_ids` from the store's reservation on every call
  (`writer_auth.rs:152-156`); the engine's own hook is the `new_ids` queue
  (`engine/mod.rs:23`, `runner.rs:392-397`).
- **Sessions are a hard thirty days with no renewal** (`identity.rs:15`).
- **`schedule` is refused** (`quarry/parser.ts:71`) and rules cannot read
  time, so nothing on the server expires a message on its own.
- **Quarry has no retention spelling**; `retention.rs` is cost estimation.
- **Governance read all of offline as deferred**, on a NOT-DOING line whose
  key phrase was defined nowhere, while the brief's offline obligations sat
  at M5 and M6 outside both bars.

## 2. The rulings (author, 2026-09-04)

Thirteen decisions were put to the author with a recommendation and a
confidence each; the author ruled on all thirteen. Recorded here as decided.
Revision (b) proposes amendments to three of them (rulings 3, 4, and 8),
marked below and put as questions in §"Open questions (author)".

1. **The fence bounds trust, never reading.** Past `maxOfflineAge` the client
   neither predicts nor replays queued writes without a fresh
   re-authorization, and every view is `stale` with an age. Delivered rows
   stay readable until the device syncs a revocation. Default 7 days,
   app-declarable up to 30. Queued intents older than the fence settle
   `expired`. (§5)
2. **Copy the answers, not the mailbox.** The result cache stays; no replica.
   "Every message on the phone" is the per-recipient delivery-log program
   shape, published as a recipe and adopted by the `chat` template. (§3)
3. **Offline reads are staged.** Lane O2 builds the range store,
   stored-answer replay, and the outbox; lane O3 wires the twin for local
   evaluation and prediction. *(c) ruled by the author's principle of
   2026-09-04, "go as straight as possible to the ideal thing": no
   staging. The twin is the client from the start; a stored answer is
   the case where every read is covered (§6).*
4. **Offline writes.** A durable FIFO outbox per device; replay after resume;
   each intent settles on its own; the server's OCC is the only conflict
   rule; `predicted` when the twin's reads are covered, else the app renders
   the intent from its arguments; intents older than the fence expire.
   *(c): the design's trace-validated OCC ships in v1 — the intent carries
   the twin's trace; point reads and verdicts are validated at commit;
   ranges re-execute (§7).*
5. **Reconnect is watermark resume on ordered ranges plus full re-delivery
   elsewhere; general delta resume deferred.** Refined in §8: the log's
   watermark plus a validator check of mounted queries, in one owner action.
6. **Offline search is the app filtering held rows**, labeled "in downloaded
   messages". Online search is a separate engine item. (§6)
7. **Asset bytes cache under the owning row's lease**, LLP 1006 §9b, lane O4.
8. **Two retention policies ship:** `until-revoked` (default) and
   `delivered-history`. *(c): ruling 8 stands; the word ships now, on the table whose rows
   can hide, with its twin-side meaning (§5).*
9. **No store budget in v1.** Measure the store at ten thousand messages.
10. **Carriers:** IndexedDB on the web, expo-sqlite on Expo, one interface,
    per-principal partition, wipe on sign-out, **no encryption claim**. The
    author expects the Exact 2 arm will also want SQLite through
    `snapback2-core` directly; probable, not ruled. (§10)
11. **The proof is a physical process kill plus cold start** on the iOS
    simulator and a real browser reload, scheduled rather than blocking; the
    bar is not met until it is green. (§10)
12. **A third bar, spec now, build after the loop bar.** The offline bar is
    M5 acceptance 5, M6 acceptance 1 and 2, and the witness; codex is the
    implementer; the build runs alongside the Expo arm. (§12)
13. **The trade: observability slides.** LLP 1009 leaves the doing-list and
    returns when the offline bar is met. (§13)

## 3. The model on one page, and the program shape

**What the client is.** A result cache. For every `(op, args)` the app ran,
the store keeps the server's certified answer: the result, its `seq`, its
**validator** (§8), and its **public receipt** — the ranges it covers with
their bounds and `row_ids`, the point absences it proved, and the verdicts it
relied on (§8, the frozen envelope). Rows are stored once per `(table, id)`
and referenced by every answer that holds them, so a fact proven by the
newest answer applies to every older one. Every change to the store is one
**swap**, atomic at a server `seq`. The store is partitioned per principal.

**What it can and cannot answer.** It re-shows any answer it holds. It cannot
answer a question the model did not name, and it never computes a fact the
receipt did not cover. This is the security argument of the whole design and
it is why there is no replica.

**The program shape for "everything on the phone."** WhatsApp's server keeps
a per-device queue of deliveries and the device drains it. The same shape in
Quarry is a per-recipient delivery log: one immutable table, one row per
recipient per event, two indexes — the viewer's whole log by time, and the
viewer's log per conversation by time — so the inbox drain **is** the
thread's coverage. Delete, expiry, and edit are further log rows: the log is
the app's revocation channel, and the mutation that removes a body writes the
rows in the same commit. The recipe below is the `chat` template's dialect
and **certifies under `snapback2 check`** (22 operations at `a26f3434b`,
2026-09-04): page 50, not 200, because a `messages` row prices at 16,016
bytes and 200 of them exceed the 1 MiB output ceiling (`E_BOUND`, 3,456,012
bytes); `*` spreads the row; `'removed'`, because `delete` is a keyword and a
string literal spelled like one does not lex; the fan-out `first 50` equals
the template's group cap of 49 members plus the creator, and a group past the
cap must be refused by `memberAdd`, or member 51 is silently undelivered.

```q
table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  kind: enum('message', 'edit', 'removed', 'expired')
  at: time
  by byRecipientAt: recipient, at, id
  by byRecipientConversationAt: recipient, conversationId, at, id
  immutable recipient, conversationId, messageId, kind, at
  read <- .recipient = viewer
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny
```

```q
query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 50 by byRecipientAt
  return page { *, message: messages[.messageId] }

query thread(conversationId: conversations, c: cursor ?):
  require exists memberships[conversationId, viewer] else MEMBERSHIP_REQUIRED
  page = deliveries[viewer, conversationId] after c last 50 by byRecipientConversationAt
  return page { *, message: messages[.messageId] }

mutation post(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  return { id: row.id }

mutation unsend(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'removed', at: now }
  delete messages[msg]
  return null

mutation edit(messageId: messages, body: text <=4000, baseBody: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  require msg.authorId = viewer else NOT_AUTHOR
  require msg.body = baseBody else CONFLICT
  update messages[msg] { body }
  for m in memberships[msg.conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId: msg.conversationId, messageId, kind: 'edit', at: now }
  return null
```

**Why the purge arrives with its proof.** The `removed` row reaches every
recipient through the ordinary drain. Its page point-reads
`messages[.messageId]`; the body is gone, so that page's receipt records a
point absence; the absence evicts the body from every answer that held it,
bytes included, and no old page is re-executed (§5). The app hides the
bubble from the log row before the resume proves it. **Disappearing
messages** are the same two writes under `kind: 'expired'`, performed by a
caller-invoked `purgeExpired` mutation, because the server has no clock of its
own (§1). That mutation is a recipe dependency of M5 acceptance 1, named in
§12, not an engine change. **Leaving a group** writes nothing: the log rows
stay, the body's point read becomes hidden rather than absent, and §5 says
what hidden does.

**Implementation record (lane O1c, 2026-09-04).** Tombstone and edit rows
reach the conversation's *current* members, not every original recipient. Two
private spellings were tried and refused by the language as it exists: a
`sender` column in the fan-out index's prefix with `read <- .recipient = viewer
or .sender = viewer` fails certification because the uniformity analysis
collects every field in both arms of an `or` (`E_STRUCTURAL_COUNT`), and a
`recipients` list on the message row cannot be built because Quarry has no way
to make a list from a range read. The only spelling that certified *and* kept
the log private fans out over current members. A departed member's copy of an
unsent body is therefore evicted by §5 rule 1, the point absence its inbox page
records when that page next revalidates, not by a tombstone. The delivery log
is never public (orchestrator ruling; a public log discloses membership and
activity). The membership cap is `maintain memberCounts` plus a `require` in
`memberAdd`, refusing the 51st member `GROUP_FULL`. Both language limits are
filed as tickets and would let the recipe return to the original-recipient
fan-out. *Lane O2c:* `messages.send` stays in the template beside
`deliveries.post` because a compiler fixture pin holds the template's
`messages.q` byte-equal; the journeys and the screens post through the log.

**The drain policy.** `useQuery(api.inbox, { c: null }, { drain: true })`
follows `next` to `null`, holds every page, persists the last complete page's
cursor as the **watermark**, then keeps the tail live and follows `next`
again whenever it reappears (§6). That is the whole recipe for "everything
on the phone"; the agent writes no loop. A thread opens with
`useQuery(api.thread, { conversationId })` and is covered by the same rows.
Reactions are not in this recipe; when the brief's M4 lands they are one more
log kind and one more mutation, and the brief requires them idempotent.

**Multi-device is free.** The server is authoritative and the log is per
recipient, not per device; a second phone drains from its own watermark.
There is no device-to-device sync and nothing here adds one.

## 4. The range store

One interface, two carriers, one swap at a time.

```ts
interface RangeStore {
  open(partition: PrincipalId): Promise<void>     // E_OFFLINE_CARRIER if the carrier cannot open
  seal(): Promise<void>                            // session expired: unreadable until the same principal returns
  wipe(partition: PrincipalId): Promise<void>      // sign-out, principal replacement
  answer(op, args): Promise<Held | undefined>      // result + validator + receipt + seq + deliveredAt
  commit(swap: Swap): Promise<void>                // one carrier transaction: rows, answers, receipts, evictions, outbox settlements, watermark
  coverage(): Promise<Coverage>                    // rows, ranges, absences, verdicts — the twin's hydration input
  outbox: OutboxStore                              // §7
}
```

- **Carriers.** `snapback2/react` exports exactly one, IndexedDB.
  `snapback2/expo` exports exactly one, expo-sqlite. The Node file carrier
  exists for the harness and the journey primitives (§10). The no-WASM rule
  excludes SQLite in the browser. The Exact 2 arm, when it starts, most
  likely runs `snapback2-core` over real SQLite and needs no TypeScript
  carrier (author expectation, not ruled).
- **Loud, not silent.** A client constructed with a `store` whose carrier
  cannot open refuses with `E_OFFLINE_CARRIER` and a rewrite naming the
  carrier to install. It never falls back to memory and reports durable.
  Snapback 1's Expo arm did exactly that fallback and it read as a retention
  bug for a month.
- **One swap.** `commit` writes everything in one carrier transaction: on
  IndexedDB one `readwrite` transaction spanning the object stores, with all
  computation done before it opens because an awaited tick auto-commits; on
  SQLite natively. A crash mid-commit leaves the previous state intact, which
  the witness kills to prove (§10).
- **Partition, seal, wipe.** The partition key is the principal id, never
  the bearer. Sessions expire after thirty days with no renewal (§1), so a
  terminal `E_AUTH_SESSION` **seals** the partition — unreadable, outbox
  kept — until the same principal re-authenticates, at which point the
  outbox replays under a fresh grant (§7). Sign-out and principal
  replacement **wipe**. Wiping on session expiry, as revision (a) said, would
  have erased every user's messages monthly.
- **One writer per partition.** The web client takes
  `navigator.locks.request("snapback2:" + principalId)`; a second tab gets
  `E_OFFLINE_LOCK` with the rewrite "this account is open in another tab".
  Snapback 1 hit exactly this race.
- **No encryption claim.** A key the page can read protects nothing against
  code in the page; on iOS the OS already encrypts files at rest. v1 says
  "partitioned per principal, sealed on expiry, wiped on sign-out" and
  nothing more. At-rest encryption on Expo is a dependency choice for the
  Expo arm, not a claim made now.

## 5. Retention, revocation, and the fence

**Four swap rules, applied once per swap over the union of claims** (client,
lane O2). They replace revision (a)'s table, whose "only on a receipt
absence" arm could never fire for a row inside a range (§1).

1. **Absence evicts.** A point absence for `(table, primary index, id)` in
   any fresh public receipt evicts row `(table, id)` from every answer that
   holds it, and its bytes with it. This is how a body dies (§3).
2. **A hole in a fresh uniform range evicts.** On a fresh certified-uniform
   range with the same site, prefix, and rule hash as a held one, a held id
   whose index key lies inside the fresh range's extent and is missing from
   its `row_ids` is gone. Under `stop = Exhausted` the extent is the prefix
   bounds; under `Limit` it runs from the first returned key to the last; the
   halo counts as present. This is `runner.rs:985-1008` read as the client
   rule it already is; it fires on `thread` pages and never on the
   append-only log's prefix.
3. **A tombstone evicts.** A fresh log row of kind `removed` or `expired`
   evicts the body it names, before rule 1 proves it.
4. **Hidden keeps or evicts, by the table's word.** A fresh authorized
   answer in which a held row's slot became `null` with no absence, or a
   fresh `denied` state for a held answer, is the *hidden* signal: the
   viewer once received the row and may no longer see it on the server.
   Under `retain until-revoked`, the default, the row is evicted. Under
   `retain delivered-history` the row is kept, the answer is marked
   `retained: true`, and the twin treats a held row of that table as
   readable — delivery was the authorization — so the kept row renders
   under local evaluation too. A row that no answer holds after the swap
   leaves the store.

**The word `retain`, as ruled.** Ruling 8 stands under the author's
principle: the ideal is a per-table policy for the hidden case, so it ships
now rather than later. `retain until-revoked` is the default and needs no
line; `retain delivered-history` is the other word; both are one lexer
token; anything else refuses `E_QUARRY_RETAIN`, family `quarry`, with a
rewrite naming the two. The word goes on the table whose rows can go hidden
— in the messenger that is `messages`, and the template carries the line
there — because a per-recipient log whose rule is "recipient equals viewer"
on an immutable column can never hide a row, so the word on the log would be
a no-op. The certificate records the policy per table and `/api/manifest`
carries it once per generation; the receipt never echoes it per range. The
recipe in §3 was certified before the grammar existed; lane O1 adds the
keyword and the template's `messages` table gains `retain delivered-history`
in the same landing. Every panelist agreed on rules 1–3; rule 4's two
behaviors are exactly the two words.

**Disappearing messages** are the server refusing expired content plus the
client purging on sync: `purgeExpired` deletes the body and writes the
`expired` log rows; rule 3 hides it on the drain and rule 1 proves it. The
server's own refusal is the deletion itself. No new mechanism, one recipe
dependency (§12).

**The fence.** `maxOfflineAge` is a client option, `offline: { fenceDays: 7 }`,
bounded to 1..30; a bad value is a `TypeError` like every other bad option.
It bounds **trust**: past it, the client does not predict, does not
replay the outbox before a resume has succeeded, and labels every view
`stale` with `since`. It never makes a held row unreadable. The server's own
rule needs no client clock: an intent under a **grant** minted more than
thirty days ago is refused `E_OFFLINE_INTENT_EXPIRED` (§7). The 24 h / 7 d /
30 d question open in LLP 0329.014.004 §5 and §9 since v1.2 is closed by this
section.

## 6. Reads offline

**The twin is the client.** `useQuery(op, args)` with the backend
unreachable runs the certified program through the twin
(`snapback2-evaluator`) hydrated from `coverage()`: rows, ranges, absences,
and verdicts. A read inside coverage is exact; a read outside is `partial`
at that site with `reason: 'never-held' | 'evicted' | 'computed-key'`. The
view carries `live: false`, `connection: 'offline'`, `stale: { since }`, and
`retained: true` when §5 rule 4 kept a row. A query whose every read is
covered replays exactly, which is what a stored answer is — the covered
case, not a separate mechanism. A query the store cannot cover at all is
`hydrating` with `connection: 'offline'`, exactly as today. The evaluator
ticket's "done when" list is lane O2's acceptance verbatim: the certified
program and certificate on the wire (§8), receipt custody, successor and
auth-epoch fences, canonical hashing, and the five outcome classes proven
against the server.

**The coverage rule that makes "everything on the phone" exact.** A
certified-uniform prefix range drained to `next: null` is the viewer's whole
partition for that prefix, proven by receipt. The twin therefore treats a
fully drained uniform prefix as covering **every named query over that
prefix on any index**. That is why `thread(conversationId)`, which reads
the log on a different index than the drain, replays exactly for a chat the
viewer never opened online, and why a queued send appears inside that
thread's result, in order, as `predicted`. It is not a relational replica
in the design's sense: only named programs, only the viewer's own
partition, completeness proven rather than assumed — the design's own
`replica` notion for owner partitions, reached from the log.

**`drain: true`.** One subscription option (§3). It exposes `{ caughtUp,
watermark }` beside the view. Offline, `caughtUp` means the last online
drain reached `next: null`, and `since` stays visible. This is the only new
read surface in v1; a `useDrain` hook is the same thing with a second name
and is not added.

**Search offline.** A search op is a named query; a new term has no held
answer and the engine has no text index, so the twin cannot replay it. The
recipe: the app filters the held log rows in JavaScript and labels the
result "in downloaded messages". At messenger scale this is milliseconds,
and it stops finding a body the moment §5 evicts it. When the engine gains a
text index, LLP 0329.014.008 §6's `held` completeness label is the
follow-on.

**Implementation record (lane O2b and its fix round, 2026-09-04).** The twin is
`snapback2-evaluator` split into a store, a runner, and the entry, hydrated from
`coverage()` through the held schema. One hasher: known shapes are reconstructed in
serde's field order (proven equal to Rust's `Schema::hash()` on every golden and the
corpus, and the goldens fail when the hasher is perturbed); a payload carrying a field
serde's struct does not carry is refused; an unknown rule, constraint, or column variant
is deep-sorted so it hashes deterministically and never as a known shape; the hydrate
path recomputes the hash and a mismatch is `hydrating`. Every pooled row of a delivery
joins its answer's refs, so the closure rows a read rule probed survive. The
drained-prefix rule is a chain of held pages on one (table, index, prefix, rule): every
`after: null` page is tried as a start; a link is the previous page's last recorded row,
by its index suffix when held and by its id alone when it is a viewed view-once row and
the index ends in `id`; a page that lost a member since it was recorded (`evictedIds`)
is no link and covers nothing whole; once Exhausted is reached, a page of the group
holding a row the chain does not hold breaks the chain, and a page whose rows the chain
already holds adds nothing. A query whose prefix binds every drained column equality is
covered on any index of the table. `partial` reasons: `evicted` for a primary-key read
of an evicted row or a range over a table one of whose held pages lost a member,
`computed-key` for a Shape-provenance read, else `never-held`. A view is `hydrating`
when no program is held for the coverage's generation or schema. A held row of a
`retain delivered-history` table is readable to the twin, and a retained answer is
served as held, never re-evaluated. The auth-epoch fence is the coverage facts' epoch
bound into the verdict lookup. The IndexedDB `ranges`/`absences`/`verdicts` projections
were write-only and are deleted on upgrade; coverage derives from the held answers'
receipts.

## 7. Writes offline

**The outbox.** `useMutation(op).run(args)` with the backend unreachable, or
after a transport failure with the fence's trust intact, appends an intent to
the partition's durable outbox and resolves `last: { state: 'queued', intent }`.
The state machine is `queued → committed | rejected | expired`, with
`predicted` an orthogonal flag on `queued`. `useOutbox()` returns
the durable entries `[{ intent, ids, op, args, state, refusal? }]` with
`dismiss(intent)` for settled ones; the `chat` template renders a pending
bubble from `args`, keyed by the intent, labeled "Sending…", **with no time**
— the bubble never shows a client clock — and the same bubble turns into the
server row on `committed`, keyed by its first pinned id, so nothing jumps.
Because the outbox opens before the first request, a queued message is on
screen at cold start before the network is tried.

**The replay grant.** Every successful resume (§8), login, and guest call
returns a grant when the client's remaining ids are low:

```
grant: { id, from, count: 8192, mintedAt, expiresAt }   // principal-bound; ids in the engine's own s2id space
```

A grant is bound to the **principal**, not the session, so a fresh session
for the same principal finishes its outbox. Ids are the engine's own
`s2id-<namespace>-<sequence>` values reserved from the store's allocator, so
there is no second id form and LLP 1006 §9a's namespace rule holds. At
enqueue the client consumes a slice `1 + maxNewIds` for the program (the
certificate's write bound already knows `maxNewIds`): the first id names the
intent, the rest are its `new` envelope in order, so a later intent can
reference a parent's ids before the server has seen either.

**The envelope.**

```
POST /api/mutation
{ op, args, replay: { grant, offset, count, intent: "<grant>:<offset>", trace } }
→ { state: "committed", seq, data, intent } | { state: "rejected", …, intent }
```

Clients without a store omit `replay` and get today's path unchanged. With
it, `mutation_context` injects the slice into `context.new_ids` instead of
calling `reserve_new_ids()` (the hook LLP 1001 §8 names, `engine/mod.rs:23`),
after checking: the grant belongs to this principal and is younger than
thirty days by server time (`E_OFFLINE_INTENT_EXPIRED`); the slice lies
inside the grant and is unused (`E_OFFLINE_ID_BLOCK`); and
`(principal, intent)` is not in `_client_intents`. On commit the engine
writes `(principal, intent, requestDigest, terminalResponse, seq, at)` into
`_client_intents` **in the mutation's transaction**, beside the commit
record. A retry with the same bytes returns the stored response without
executing — that is the 503-after-commit case, and it is what makes LLP 1002
§9's rule ("a 503 after a commit must never look like a rejection") true
instead of a double send. A retry with different bytes refuses
`E_OFFLINE_INTENT_REUSE`. Rejections are stored too, so a retry of a rejected
intent is stable. The ledger is swept after thirty days.

**Replay.** After a resume succeeds (§8), the client drains the outbox in
FIFO order, one intent per request, waiting for each receipt. A transport
failure mid-drain leaves the intent `queued` and stops the drain; the next
attempt is the same envelope. A rejection settles that intent only; the
drain continues. An intent whose grant is past the fence at replay time
settles `expired` locally without being sent, and the server's thirty-day
rule is the backstop.

**What the server checks: trace-validated OCC, the design's answer, in v1.**
At enqueue the twin runs the mutation over held rows and records its
**trace**: every point read with the digest of the row it saw or the
absence it relied on, and every rule verdict with its inputs digest. The
intent carries that trace. At commit the server executes the mutation
against current rows under current authority — and then compares: each
point read in the trace must still yield the same row digest or the same
absence, and each verdict must still hold. Any mismatch settles the intent
`rejected` with `reason: 'conflict'` and the site that moved, which the
bubble shows as "Not sent, the message changed". Ranges are **not**
validated; they re-execute fresh at commit, because a fan-out that reads the
group's members should use the members at commit, and validating the range
would reject a send because someone joined. Inserts have nothing to
validate beyond their constraints. This is exactly the compare an author
would write by hand (`require msg.body = baseBody`), made universal and
impossible to forget, with no version numbers, no commit-log scan, and no
horizon problem: the comparison is against what the client actually read.
An app-authored `require` remains the way to express stricter or custom
semantics. The design's per-table `merge: lww | append` policies for
collaborative fields stay deferred (§11); a table that wants last-writer-wins
today simply does not read the row it overwrites.

**Prediction.** On enqueue the write's rows enter the store as an overlay —
visible to local evaluation, excluded from validators, keyed by the intent —
discarded when the intent settles: replaced by the server's rows on
`committed`, dropped on `rejected` or `expired`. The twin consumes the same
`new` envelope, so a prediction and its commit mint the same ids. Where a
read is uncovered the intent is `queued` without `predicted` and the app
renders it from `args` through `useOutbox()`; the recipe's drained prefix
makes that rare for the messenger.

**Implementation record (lane O1b, 2026-09-04).** Grants are minted when the
request's optional `remaining` (the client's count of unused ids) is absent or
below 1,024; a client that omits it gets a grant on every resume, so the client
sends it. A trace
conflict takes precedence over a program rejection: when a member removed
while offline replays a send, the `require` fails before any verdict, and the
honest answer is `conflict`, not the program's `NOT_MEMBER`. Point digests are
SHA-256 over the canonical wire row, the form the pool carries. An intent with
an empty trace commits against current rows with no conflict check; that is
the outbox's spelling until the twin produces traces. The resume's log page is
filed by the client under the tail key (the page the server evaluated after the
watermark), never under the base page's key. *Fix rounds 1–2:* the intent
ledger is consulted before any grant check, so a stored terminal answers a
byte-identical retry even after its grant is spent; a replayed intent that rolls
back on missing authority is stored as its partial terminal; on the rejected path
the server compares every traced point, probing unreached points through the
table's read rule as the replaying principal, and every verdict a reached or
probed rule check derived on a disclosed row, and it skips a traced verdict no
disclosed rule check derived (a hidden or absent row settle byte-identically);
the rule inputs minted while a candidate turned out hidden are recorded at
rollback and excluded from the compare set on both paths, so a hidden hit can
no longer vouch for a verdict on the committed path; on the committed path a
traced verdict no disclosed rule check derived is a conflict (strict), never a
skip, because a commit must not proceed on a claim the run could not verify;
conflict precedence is
independent of `require` order; the verdict `inputsDigest` is
`sha256(canonical([table, index, key]))` over wire values, computable from the
envelope; a replay needs a live session (`E_AUTH_SESSION` before the ledger,
the grant, or the slice) and the grant, bound to the principal only, outlives
the session so a fresh login finishes the outbox.

**Implementation record (lane O2c, 2026-09-04).** Intents are durable in the
range store on both carriers with their grants, a FIFO order, and the twin's
overlay seam; enqueue consumes a slice of `1 + maxNewIds` from the current grant
and refuses `E_OFFLINE_ID_BLOCK` when it is spent; the drain replays one
envelope per request after a resume; a transport failure keeps the intent
`queued` and the retry is the same envelope; a rejection or a trace conflict
settles only its own intent; a grant past the fence settles `expired` locally;
a committed settlement lands in the same swap as the log tail; `useOutbox()`
and `useMutation().pending` expose the queue; the provider creates its client
once so StrictMode does not leak a lock holder. *Fix round 1:* the ledger's
adopt, enqueue, and dismiss run on one serial tail so a grant slice is never
consumed twice; a committed reply whose log-tail fetch fails leaves the intent
`queued` (the retry is the same bytes and the server's ledger answers
unexecuted), so rows and settlement always land in one swap; the settlement
tail and the resume `log` name the drained query whose watermark the partition
recorded first; `settled()` rejects with the refusal that stopped the replay; a
terminal settlement drops the prediction overlay in the same swap; each op's
certified `maxNewIds` is persisted in the store and an enqueue with no known
bound refuses `E_OFFLINE_ID_BLOCK` rather than pricing from a fallback; the
provider compares offline options by store factory and values; `online()`
drains a held queue even when no resume can be built. *Open question for the author
(f):* the local expiry of intents whose grant is past the fence discards writes
the server would still accept for thirty days and would validate by trace; the
alternative is to replay after a successful resume and let the server judge,
keeping the fence for prediction and the `stale` label only.

**Failure shapes.** *Grant exhausted:* the client refuses at enqueue,
`E_OFFLINE_ID_BLOCK`, and asks for a grant when online; no silent reuse.
*Device wiped:* unsent intents die with the partition; unused ids are gaps,
which the allocator already tolerates. *Two devices, one principal:* two
grants, two FIFO queues, arrival order between them. *Parent rejected:* the
child references a pinned id that names nothing; its own `ref` lookup or
`require` refuses on current rows; the child settles `rejected` with the
ordinary envelope; no cascade in v1 and both bubbles are shown.

**Implementation record (lane O2b and its fix round, 2026-09-04).** Prediction runs
inside the ledger's critical section with the grant slice as the twin's `new` ids; the
overlay, the trace (points with the digest of the wire row read, or `null` for an absence
or a hidden hit; verdicts only from disclosed rule checks, deduped; `inputsDigest`
through the shared canonical function), and `predicted` land in the entry's own swap.
Three deviations from "if every read is covered", recorded because §12's twin acceptance
cannot pass without the first: an uncovered **range** does not block a prediction (ranges
are never validated and re-execute fresh at commit; the twin evaluates over held rows and
names the range in `partialRanges`; a fan-out row of which the viewer's own copy is minted
under another id than the server's is pinned by the three-member group journey); an
unheld engine-maintained aggregate target does not block it, and the omitted target names
ride the prediction and the outbox entry (`omitted`); a committed intent's overlay is
dropped by an answer at or after the commit seq that touches one of the overlay's tables
or by any page of a drained op, never by an unrelated answer, and with no watermark and
no such delivery it stays. An uncovered point read, an uncovered rule input, or a local
refusal still queues without a prediction and with an empty trace. With a partition open
every write carries the replay envelope, online or not, or refuses `E_OFFLINE_ID_BLOCK`
(no grant, unknown bound, spent grant) before any request; only a client with no store
sends plain bytes. Local authority violations (a delivery for another principal or
auth epoch; a commit with no partition) are `E_OFFLINE_AUTHORITY`, and the client keeps
its coverage. *Fix round 2:* the overlay drop is a page of the tail chooser's query
(same op and arguments but for the cursor) or a delivery holding one of the predicted
rows by table and id; any other swap that moves the store past the commit seq is one
miss, and at two misses the overlay is dropped and the entry's `predicted` retired, so a
bubble neither vanishes on an unrelated delivery nor leaks. A delivery under another
generation or schema is not refused and not held: it records `superseded`, the online
caller gets the live answer, no held validator leaves the device, and offline reads are
`hydrating` until the next resume's `E_OFFLINE_RESET` runs the reset path (when the
generation and the auth epoch both differ, supersession wins over the epoch refusal; the
reset is not self-triggered — the follow-ups ticket of 2026-09-04 records that and the
`ready()` and catch-all residuals of the third review round).
`client.outbox.ready()` (a current grant inside the fence, or no partition) is exposed as
`useOutbox().ready` and `useMutation().ready`; the chat composer is disabled with the
reason until the inbox drain has earned a grant, and a refusal's rewrite is shown, never
retried blindly.

## 8. The delivery envelope, the validator, and resume

**The frozen envelope (lane O1's first landing; O2 starts against it).**
Every `/api/query` response and every `/api/subscribe` frame carries, when
the client asks with `receipt=1`:

```ts
type DeliveryEnvelopeV1 = {
  protocol: 1;
  generation: string;      // the certified program generation, not the schema-only hash (registry.rs:88-99)
  schemaHash: string;
  planHash: string;
  authority: { principal: string; authEpoch: number };
  state: 'complete' | 'capped' | 'partial' | 'denied';
  data: unknown; next: Cursor | null; seq: number;
  rows: Array<{ table: string; id: string; row: Row }>;          // the row pool: each row once, in wire encoding
  receipt: {
    ranges: Array<{ site; table; index; prefix; bounds; rowIds: string[]; stop; absence: boolean; haloId?: string }>;
    absences: Array<[table: string, index: string, key: unknown[]]>;  // primary-index absences only
    verdicts: Verdict[];
  };
  validator: string;       // server-minted; opaque; echoed, never recomputed
}
```

Rows appear once, in the pool; `data` and the receipt reference them by
`(table, id)` through engine-tracked provenance — never by body equality, so two
identical rows in two tables keep their identities — and an application value
that happens to be shaped like a reference is escaped as
`{ "$row": { "$value": … } }`; the client expands before exposing `data`.
`n2Key` is not on the wire. A hidden point *hit* discards the receipt
artifacts its rule check recorded, as a hidden range candidate already did. The certified
program and its certificate travel with the generation: `/api/manifest`
gains `programGeneration` and each op's `planHash`, and
`GET /api/program?generation=` serves `{ generation, schemaHash, schema,
programs }` once, cached forever by hash — the custody the evaluator ticket
names, and the schema the client needs to re-tag rows and derive index keys.
It must sit behind a session like every other read (lane O1b): the schema
carries the rules. Point absences
leave the server **only for the primary index**, so `receipt=1` cannot tell a
hidden alternate-key row from a missing one — the oracle LLP 1011 closed for
writes stays closed. Clients that do not ask see today's bytes unchanged.

**The validator** is `sha256(canonical({ op, args, state, data, rows, next,
reason, rule, receipt, generation, schemaHash, planHash, principal, authEpoch }))`,
minted by the server, excluding `seq`. The row pool is in it (implementation
record, lane O1a: halo and rule-input bodies are delivered content, so a pool
edit with stable ids must move the validator), and so are a `partial` reason
and a `denied` rule. It is HTTP's strong validator by another name: an
unrelated commit changes `seq` and not the validator; any change to data,
completeness, cursor, coverage, program, schema, principal, or auth epoch
forces a full delivery. It replaces both existing digests for this purpose
(`live.rs:17-19` over data only; `writer_values.rs:56-61` over the frame).

**Conditional requests.** `POST /api/query { op, args, validator }` answers
`{ state: 'unchanged', seq, validator }` on equality.
`GET /api/subscribe?…&validator=` opens with an `unchanged` first frame on
equality, which ends the reconnect double-execution (`live.rs:117-146`).

**Resume.** One request, one owner action:

```
POST /api/resume
{ protocol: 1, generation, schemaHash, authEpoch,
  log: { op, args, watermark: Cursor | null, validator },   // the drained range, once
  mounted: [{ op, args, validator }] }                      // ≤ 32
→ { seq, generation, schemaHash, authority,
    log: { unchanged: true } | { ...DeliveryEnvelopeV1, watermark },
    mounted: [ { op, args, unchanged: true, validator } | DeliveryEnvelopeV1 ],
    grant?, more?: number }
→ 409 E_OFFLINE_RESET { generation, schemaHash }     // drop coverage; keep the sealed outbox; cold-drain
→ 413 E_OFFLINE_RESUME { which, cap, rewrite: "re-subscribe the rest as ordinary reads" }
```

The server, in order, on the owner thread at one `seq`: authenticate;
compare `authEpoch` (stale → seal, no data) and `generation`/`schemaHash`
(mismatch → `E_OFFLINE_RESET`); mint a grant if remaining ids are low; run
the log's tail `after watermark first 50` and answer `unchanged` when the
tail is empty and the validator matches; run each mounted query and answer
by validator; stop at 1 MiB of output with `more`. It does **not** reopen
subscriptions. The client applies the response as one swap, then drains the
outbox, then reopens mounted subscriptions with their validators. Unmounted
held pages are not in the request: they are re-validated when next on
screen, or as an idle trickle of ≤ 64 conditional queries per action after
the outbox has drained. On the Clique inbox — fifty conversations, a drained
log, one thread on screen, an hour away with two hundred new messages in
five conversations — the common case is a few executions and tens of
kilobytes; §14 records the number.

## 9. Asset bytes on the device

LLP 1006 §9b (author ruling 2026-09-04), summarized. The asset client caches
the bytes it actually fetched — the widths the components asked for, never
originals — keyed `(assetId, width)`, in a `ByteCache` that is **not** part
of the `RangeStore` interface (lane O4 owns it) but joins the same swap by
row lease: when §5 evicts a row, its bytes leave in the same commit. The
fence does not touch bytes. One ceiling, `offline: { maxAssetBytes }`,
default 256 MiB, LRU by the byte entry's own last-read time. **View-once is
excluded at view time, never purged later:** a viewed view-once row enters a
local `viewed` set consulted before `answer()` returns it and before any
byte is fetched, so an offline cold start cannot re-render it; when LLP 1006's
one-use delivery lands, such rows also refuse the cache at the row.

**Implementation record (lane O4-web and its fix round, 2026-09-04).** Bytes are
keyed `(assetId, width|null)` and evicted least-recently-read by each entry's own
stamp under the store's logical clock; a read stamps in memory and the next swap
persists the order (a close before a swap loses order, never bytes). View-once is
per `(table, id)` in a durable viewed set: an image is viewed when its bytes are
fetched, a clip when it plays (`assetCache.markViewed`), never prefetched; a
viewed row reads `null` held, conditional, live, or fresh, is excluded from
`coverage()` as a `byId` absence beside the `viewed` list, its bytes are never
cached, `useAssetUrl` mints no URL, and `assetBlob` refuses `E_ASSET_VIEWED`. An
ordinary row sharing the asset id keeps its lease. The session allowance that
lets the viewing instance keep showing a clip is keyed by partition, cleared on
seal, wipe, and principal change, and served only while the row is held. The
drain and the resume tail key the cursor by the argument the manifest types
`Cursor` (`c` until the manifest loads). The file carrier is an ordered write
(payloads, the state rename, the removals) plus a sweep on open; IndexedDB is
the one-transaction carrier.

## 10. Carriers, the fast loop, and the witness

**The journey primitive** (`snapback2 test`, lane O2): the agent's
five-second loop. The journey context gains a durable Node-carrier device
whose transport can be cut and whose client can be cold-started on the same
partition:

```ts
journey("offline send and search", async ({ as }) => {
  const alice = as("alice", { store: "file" });
  const inbox = alice.subscribe(api.inbox, { c: null }, () => {}, { drain: true });
  await inbox.until((v) => v.state === "complete" && v.next === null);
  await alice.offline();                              // transport refuses; the owner is untouched
  const cold = await alice.restart();                 // close, reopen the same partition, still offline
  const held = await cold.query(api.inbox, { c: null });        // complete, connection: "offline", stale
  const sent = await cold.mutation(api.post, { conversationId, body: "queued" });   // state: "queued"
  await alice.online(); await cold.settled();          // outbox drained, in order, exactly once
});
```

Plus one derived check, `offline`: every query the seed journeys ran replays
byte-equal from the store after `offline()`. Expiry is `offline(); clock(ttl
+ 1); online();` then the recipe's `purgeExpired` and a resume, and the held
log no longer contains the body. `snapback2 why <query>` gains one line from
certificate facts it already has: "offline: N uniform ranges held as
coverage, M primary point reads; a held answer replays exactly".

**The witness** (scheduled; the bar's durability evidence), split by lane:

- **O2, browser:** seed; drain the log; open three chats; **enqueue one
  message while offline**; kill the browser profile **once during a
  `commit`** (a harness barrier inside the swap) and once at rest; cold
  start with the backend stopped: the inbox, the three chats, and the
  queued message are there, and a chat never opened is `hydrating`; boot
  with the carrier refused and see `E_OFFLINE_CARRIER`; start the backend;
  inject a 503 after the commit of the first replay: exactly one row on the
  server, the bubble does not move; the second message commits in order; a
  message expired while offline is gone from the local search after the
  resume. Two tabs: the second gets `E_OFFLINE_LOCK`.
- **O4, simulator:** the same on the iOS simulator with images viewed
  before the kill rendering after it and a viewed view-once photo not
  rendering.

It runs on the schedule (`rules/RULES.md`: nothing slower than sixty
seconds blocks a push) and files a bounded ticket when red; the offline bar
(§12) is not met until it is green on a published package. The Expo carrier
ships qualified on the simulator, or it does not ship.

## 11. What v1 does not do, and what would reopen each

| Candidate (LLP 0329.014.008) | Not in v1 because | Reopens when |
|---|---|---|
| 1. Hold sets, `offline: 'required'` | the recipe covers what the twin would need; pending renders from args | a brief's `partial` rate is measured and hurts |
| 2. Dependency-aware outbox | FIFO with independent settlement and pinned ids covers the messenger; the server refuses a dependent honestly | a brief with multi-step offline transactions |
| 3. Delta resume by range version | the log's watermark plus validators makes unchanged answers a hash (§8) | §14's reconnect bytes for changed ranges exceed what a phone tolerates |
| 4. Bytes under the lease | **taken**, narrowed: fetched widths, one ceiling (§9) | — |
| 5. Per-field `unheld` | no held/unheld join shapes in the messenger | a brief with cross-principal joins offline |
| 6. Local token index | the engine has no text index; app-side filter is honest at scale | online search lands |
| 7. Store budget and priority | messengers keep everything; §14 measures | the measurement or a device quota complaint |
| 8. Cancel queued; `asOf` | unsend-while-offline is an app-level `unsend` intent | a brief asks |
| `purge-on-block`, `all-owned` | the two words of ruling 8 ship; blocking is out of the brief | a brief asks |
| Trace-validated OCC | **taken** for point reads and verdicts (§7) | — |
| `merge: lww \| append`, `sequence` | a table that wants last-writer-wins does not read the row it overwrites | collaborative editing |
| Encryption at rest | no honest claim on the web; OS at-rest on iOS | the Expo arm chooses SQLCipher |
| Device-to-device sync | server authority makes multi-device free | never, by design |

## 12. The offline bar, and the lanes

**The offline bar** (the third bar; `rules/NOT-DOING.md`). A fresh agent, with
the installed package and `benchmarks/briefs/social-messenger.md`, has **M5
acceptance 5**, **M6 acceptance 1**, and **M6 acceptance 2** green on the
Expo iOS simulator and React web, plus §10's witness, plus **one acceptance
only the twin can pass** (author's principle, 2026-09-04): offline, a
conversation the viewer never opened online renders from the drained log
through the `thread` query, and a message sent offline appears inside that
thread's result as `predicted`, in order — all on a **published** package. It starts when the loop bar is met, and it runs alongside the
capability bar's Expo arm, which shares the carrier.

Implementer for every lane: **codex gpt-5.6-sol (xhigh)** under the standing
roster, orchestrated and landed by Claude. `T` is the day the loop bar is met
on a published package; dates are targets, and a lane that slips returns here.

| Lane | Content | Systems | Target |
|---|---|---|---|
| O1 | **First landing, types only:** `DeliveryEnvelopeV1`, the row pool, the primary-index absence projection, the validator, mirrored in TypeScript with golden fixtures that round-trip byte-identically — **O2 starts here.** Then: `receipt=1` and `validator` on query and subscribe; the program and certificate served per generation; `POST /api/resume` with its caps and order; grants, the replay envelope with the trace, trace validation at commit, `_client_intents`, injection through `Context.new_ids`; `retain` in Quarry, the certificate, and the manifest; the `offline` runtime diagnostics with their page; the recipe's `check` output pasted into §3 | `snapback2-core`, `snapback2`, `packages/compiler` | T+12 |
| O2 | `RangeStore` + IndexedDB and Node carriers; the twin hydrated from `coverage()`, the drained-prefix coverage rule, local evaluation, `partial` reasons; the outbox, grants, traces, the prediction overlay, FIFO drain, `queued`/`expired`; `useOutbox`, `drain: true`, the pending bubble; §5's four rules with the word's two behaviors; Web Locks; seal/wipe; the journey primitives and the `offline` derived check; the `chat` template adopts the recipe with `retain delivered-history` on `messages`; the browser witness; the evaluator ticket closed | `packages/snapback2`, `packages/evaluator` | T+16 |
| O4 | `ByteCache` by row lease (LLP 1006 §9b); the view-once `viewed` set; the expo-sqlite carrier qualified on the simulator; the simulator witness | `packages/snapback2`, the Expo package | with the Expo arm |

Dependencies outside these lanes, named so they have an owner: the
`purgeExpired` recipe mutation (M5 acceptance 1); LLP 1006's one-use
delivery for the row-level cache refusal.

Each lane lands under two-family blind review (LLP 0005), and the spec's
status moves to **Implemented** lane by lane in a record appended here.

**Landing record.** Lane O1c landed on `main` at `7438b6a4b` (2026-09-04): `retain`
grammar, IR, and core default; the certified delivery-log recipe with the membership
cap and the private log; three review rounds (codex, grok, Muse). Lane O1a landed at
`7438b6a4b` (round 1) and `f24ad7d6d` (round 2): the frozen envelope with a
provenance-addressed row pool, the validator over every delivered byte, conditional
reads, program custody behind a session, hidden-candidate memo rollback, the engine
receipt module, the package tests in the gate; three rounds. Lane O2a landed at
`f24ad7d6d`: the range store on IndexedDB and a Node file carrier, atomic swaps, the
four eviction rules, seal and wipe, Web Locks, `drain: true`, the resume client, the
journey primitives, the client split under the cap; two rounds. The codex account hit
its usage limit at 06:02 during the second rounds of O1a and O2a and twelve minutes
into O1b; those two rounds were verified and landed on grok and Muse alone. From 06:50
Claude Fable subagents implemented and grok + Muse reviewed. Lane O1b landed at
`37281c059` (landing 3): resume, grants, the replay envelope, trace validation, the
intent ledger, `retain` on the manifest and certificate. Landing 4 (2026-09-04, the
commit carrying this revision): O1b fix rounds 1–2 (three review rounds), O2c (the
outbox, grants on the client, the chat template's screens, the browser witness in
headless Chrome; one review round plus a fix round), O4-web (byte cache under the row
lease, view-once; two rounds), and the integration seams (`close()` resolves when the
carrier is quiet; the guide page at 4,091 of 4,096 bytes). Lane O2b landed at landing 5 (2026-09-04, the commit carrying this revision): the
twin as the client, two review rounds; the never-opened-thread journey, the traced conflict
journey, and the three-member group journey pass on the scaffolded template (14 journeys);
the evaluator ticket of 2026-08-30 is closed. The Expo carrier and the simulator witness
wait for the Expo arm.

## 13. The trade

`rules/RULES.md`: nothing moves onto the doing-list without something coming
off. The author's ruling: **LLP 1009, observability and analytics, slides off
for now** and returns when the offline bar is met. `rules/NOT-DOING.md` names
the offline bar, replaces the undefined "retention v1" line with §11's list,
and records the move. The Exact 2 arm and the hosted target stay where they
were.

## 14. Measurements to record

Each lands as a line in `snapback2/metrics/` with the landing that produces
it, so every deferral in §11 carries a number:

- store bytes, Clique at ten thousand messages across fifty conversations;
- reconnect bytes, executions, and owner time, fifty conversations after one
  hour with two hundred new messages in five, unchanged versus changed (the
  owner's `executions` counter on `/control/status` exists since O1b; the Clique
  number is recorded when O2b's journey runs);
- cold replay time to first inbox paint from the store, web and simulator;
- envelope bytes per `thread` frame with and without `receipt=1`, before and
  after the row pool;
- the witness's pass, dated, per carrier;
- the twin's gzip size: 19,747 bytes gzip (zlib level 9; 19,640 with `gzip -9`) at
  landing 6 (19,717 at landing 5), the engine alone 16,898, recorded in `snapback2/metrics/twin.jsonl` with the
  method; NOT-DOING's 9.7 KB is re-baselined to the measurement.

## 15. Diagnostics

Runtime, family `offline`, each with a site, a rewrite, and the page
`snapback2 guide offline`: `E_OFFLINE_CARRIER`, `E_OFFLINE_LOCK`,
`E_OFFLINE_RESET`, `E_OFFLINE_RESUME`, `E_OFFLINE_INTENT_EXPIRED`,
`E_OFFLINE_INTENT_REUSE`, `E_OFFLINE_ID_BLOCK`, `E_OFFLINE_AUTHORITY` (a local
principal or auth-epoch mismatch; coverage is kept; another generation supersedes the
coverage instead), `E_OFFLINE_CONFLICT` (the
refusal a `run()` throws when its intent settles `conflict`), `E_ASSET_VIEWED`
(a byte path asked for a viewed view-once row); a conflict is a mutation
state (`rejected`, `reason: 'conflict'`, with the site) on the wire, not a code.
Check-time, family `quarry`: `E_QUARRY_RETAIN`. A bad client option is a
`TypeError`, as today.

## 16. The panel record

Six blind round-1 reviews and five round-2 design contributions, all on
2026-09-04, all preserved with provenance under `llp/reviews/1012-local-first-v1.*`
and synthesized in `1012-local-first-v1.panel.synthesis.md`. Round 1: six of
six NOT READY as written; every engine claim verified by the orchestrator
against the tree; the recipe run through the compiler worker and a built
binary. Round 2, at the author's instruction, was designs rather than
critique, and the five converged on §3, §5, §7, §8, and §10 as written here.
Who found what, for the record: the range-absence gap, the unbounded resume,
and the missing replay envelope, all six; the page-200 refusal by hand
before the binary confirmed it, and the thirty-day session wipe, Fable; the
absence of any OCC in the invoked path and the client-clock problem, codex;
the two unrelated digests and the exclusive lock, grok; the drain's missing
rotation, codex and Muse; view-once at view time, Gemini; the receipt as an
existence oracle, Fable; the purge-with-its-proof mechanism, Fable, grok, and
codex independently; the validator as HTTP's strong ETag, codex; the
journey primitive, all five.

## Non-claims

This spec does not claim offline works until the witness in §10 is green on
a published package. It does not change the wire for clients that do not ask
for the envelope. It does not reopen the replica question, the WASM question,
or the one-language ruling. It does not add a scheduler, a tombstone service,
row version numbers, or a second id form.

## Open questions (author)

One, on schedule rather than design. Ruling 12 says the build starts when the
loop bar is met. Under the author's principle of going straight to the ideal
in a fast-moving moment, the orchestrator recommends starting **lane O1 now**:
it is server-side Rust and compiler work that does not compete with the loop
bar's client-facing lanes, and its first landing — the frozen envelope — is
what everything else waits on. O2 and O4 keep their dates from `T`. This
changes ruling 12's start and is the author's to make.

The three questions of revision (b) are closed by the author's principle:
ruling 8 stands (§5); trace-validated OCC ships (§7); the twin is the client
and the bar has an acceptance only it can pass (§6, §12).
