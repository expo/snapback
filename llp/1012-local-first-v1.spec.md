# LLP 1012: Local-first v1 — the client store, the outbox, retention, and the offline bar

**Type:** Spec
**Status:** Review (revision (c): the author's principle of 2026-09-04, "go as straight as possible to the ideal thing", closed revision (b)'s three questions — no staging, the twin is the client, trace-validated OCC in v1, ruling 8 stands; one scheduling question remains in §"Open questions (author)"; per `rules/RULES.md` it binds lane by lane as each lane's code lands)
**Systems:** `snapback2/packages/snapback2` (client, React, the range-store carriers, the `chat` template, the recipes, the journey primitives), `snapback2/packages/compiler` (the certificate's retention line if ruling 8 stands), `snapback2/crates/snapback2` (the wire: the frozen delivery envelope, `/api/resume`, the replay envelope, grants), `snapback2/crates/snapback2-core` (`_client_intents`, grants, the public receipt projection; `ClientStore` as the reference replay), LLP 1006's asset client (the device byte cache), `rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, at the author's direction and rulings, 2026-09-04
**Date:** 2026-09-04
**Revised:** 2026-09-04 (c — the author's principle applied: the twin is the client from the start and stored-answer replay is its covered case (§6); intents carry the twin's trace and the server validates point reads and verdicts at commit (§7); the retention word ships as ruled, on the table whose rows can hide, with its twin-side meaning (§5); the bar gains one acceptance only the twin can pass (§12); lanes collapse to O1, O2, O4; (b)'s Q1–Q3 closed); 2026-09-04 (b — the panel's designs folded: positive-fact purge (tombstone rows, point absences, uniform-extent holes; no engine change), a frozen delivery envelope with one server-minted validator, resume as one owner action over the log's watermark plus mounted queries, a replay grant with an intent ledger for exactly-once, the corrected and certified recipe (page 50, `*`, a second log index for threads, compare-and-set edits), seal-not-wipe on session expiry, Web Locks across tabs, the journey primitives, the split witness, lane O3 off the bar's path pending ruling; §16 records who found what)
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

**Failure shapes.** *Grant exhausted:* the client refuses at enqueue,
`E_OFFLINE_ID_BLOCK`, and asks for a grant when online; no silent reuse.
*Device wiped:* unsent intents die with the partition; unused ids are gaps,
which the allocator already tolerates. *Two devices, one principal:* two
grants, two FIFO queues, arrival order between them. *Parent rejected:* the
child references a pinned id that names nothing; its own `ref` lookup or
`require` refuses on current rows; the child settles `rejected` with the
ordinary envelope; no cascade in v1 and both bubbles are shown.

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
`(table, id)`, and the client expands before exposing `data`. The certified
program and its certificate travel with the generation: `/api/manifest`
gains, per generation, each op's IR and certificate digest, and
`GET /api/program?generation=` serves them once, cached forever by hash —
the custody the evaluator ticket names, without which the twin has nothing
to run. Point absences
leave the server **only for the primary index**, so `receipt=1` cannot tell a
hidden alternate-key row from a missing one — the oracle LLP 1011 closed for
writes stays closed. Clients that do not ask see today's bytes unchanged.

**The validator** is `sha256(canonical({ op, args, state, data, next, receipt,
generation, schemaHash, planHash, principal, authEpoch }))`, minted by the
server, excluding `seq`. It is HTTP's strong validator by another name: an
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
  hour with two hundred new messages in five, unchanged versus changed;
- cold replay time to first inbox paint from the store, web and simulator;
- envelope bytes per `thread` frame with and without `receipt=1`, before and
  after the row pool;
- the witness's pass, dated, per carrier;
- the twin's gzip size in the shipped bundle, against NOT-DOING's number.

## 15. Diagnostics

Runtime, family `offline`, each with a site, a rewrite, and the page
`snapback2 guide offline`: `E_OFFLINE_CARRIER`, `E_OFFLINE_LOCK`,
`E_OFFLINE_RESET`, `E_OFFLINE_RESUME`, `E_OFFLINE_INTENT_EXPIRED`,
`E_OFFLINE_INTENT_REUSE`, `E_OFFLINE_ID_BLOCK`; a conflict is a mutation
state (`rejected`, `reason: 'conflict'`, with the site), not a code.
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
