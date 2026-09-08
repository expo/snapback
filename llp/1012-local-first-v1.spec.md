# LLP 1012: Local-first v1 — the client store, the outbox, retention, and the offline bar

**Type:** Spec
**Status:** Implemented (revision (j), 2026-09-05: every lane of §12 and the close-out lanes landed on main — landings 4–6 (`9f4f4953a`, `e992c391e`, `4f5eef21f`), the fence (`2dded8335`), overlay retirement (`3b483d652`), supersession (`d4de10457`), the owner split (`ba8e6309e`), the loop index and ruler (`685b883b5`, `1e39b0d9d`), and the Expo arm E1/E2 (`aa2ec8d33`, `926d62ad7`; LLP 1013); the simulator witness passes all ten steps; residuals are tickets under `issues/` (`20260904-snapback2-*-followups`, `20260905-snapback2-e2-round-3-leftovers`). Revision (c)'s record — revision (c): the author's principle of 2026-09-04, "go as straight as possible to the ideal thing", closed revision (b)'s three questions — no staging, the twin is the client, trace-validated OCC in v1, ruling 8 stands; one scheduling question remains in §"Open questions (author)"; per `rules/RULES.md` it binds lane by lane as each lane's code lands)
**Systems:** `snapback2/packages/snapback2` (client, React, the range-store carriers, the `chat` template, the recipes, the journey primitives), `snapback2/packages/compiler` (the certificate's retention line if ruling 8 stands), `snapback2/crates/snapback2` (the wire: the frozen delivery envelope, `/api/resume`, the replay envelope, grants), `snapback2/crates/snapback2-core` (`_client_intents`, grants, the public receipt projection; `ClientStore` as the reference replay), LLP 1006's asset client (the device byte cache), `rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, at the author's direction and rulings, 2026-09-04
**Date:** 2026-09-04
**Revised:** 2026-09-07 (row-specific prediction admission and durable contradiction); 2026-09-07 (durable exact-absence admission and same-sequence tombstone precedence); 2026-09-07 (public zero-count prediction through existing paired proof custody; implementer Codex); 2026-09-07 (self-contained external SDK declaration root and private compiler ambient library, §8); 2026-09-07 (ambient offline declaration copy and unfiltered package consumers; implementer GPT-6 Astra); 2026-09-07 (explicit 82,000-byte architecture allocation, 80,000 working target; pinned Node 24 measurement); 2026-09-07 (LLP 1018.000 §8: bounded durable browser-follower admission and recovery, §4 and §7); 2026-09-07 (LLP 1018 §6: named Unicode indexed search replaces app-side filtering, §6 and §10); 2026-09-07 (LLP 1018 §4: mounted named queries publish committed effective-store revisions, §6); 2026-09-07 (LLP 1018 §3: the second browser tab follows the writer and inherits its queue, §4); 2026-09-06 (bounded drain admission and persistent resume diagnostics); 2026-09-06 (first-epoch adoption is not a session change, §4; an `unchanged` replay of a held denied answer keeps the plain wire shape, §8; the offline drain watches its tail from the page chain's cursor, §6; the browser witness bundles web-only and reports the composer's reason); 2026-09-06 (fixed complete local-runtime measurement roots: 66,000-byte ceiling, 64,000 target); 2026-09-06 (measured full-entry search trade: 50,000-byte ceiling, 48,000 target); 2026-09-06 (session-delegated indexed search, 34,000-byte total twin, Exact 2 deferral; foundation first); 2026-09-06 (overlay retirement follow-ups, §7); 2026-09-06 (reconnect — full delivery after conditional sequence refresh, §8); 2026-09-06 (auth startup review: queued transitions, interrupted sync, live held reads); 2026-09-05 (auth startup recovery and held transition reads, §4); 2026-09-05 (L11 — schema-derived one-use images, §9); 2026-09-05 (Clique L8a — §3 uniformity follow-up); 2026-09-05 (LLP 1016 J2 — the purge is a schedule, §3 and §12 amended); 2026-09-05 (local-data review fixes: purge, row identity, typed extents, escape parity, session epochs, cold cursors, replay and recovery); 2026-09-04 (i — author rulings of the afternoon: the fence never discards a queued write, the queue replays after a successful resume and the server judges (§1, §5, §7; lane F implements); the twin's size ceiling is 30 KB gzip, 19.7 KB measured (§14, NOT-DOING); the prediction over an uncovered range stands as recorded (§7)); 2026-09-04 (h — fix-forward record, lane O2b fix round 2: a committed intent's overlay leaves on a page of the tail chooser's query or a delivery holding a predicted row, and any other swap that moves the store past the commit is one miss of two, after which the overlay is dropped and the entry retired from prediction (§7); the hasher's `List` arms refuse unknown fields (§8); the twin's hydrate catch is typed and a bug propagates (§6); a delivery under another generation or schema is not held and supersedes the coverage, so offline reads are `hydrating` until the next resume's reset, while `E_OFFLINE_AUTHORITY` keeps principal and auth-epoch mismatches (§8, §15); `client.outbox.ready()`, `useOutbox().ready`, and `useMutation().ready` gate the chat composer until a drained query has earned a grant (§7)); 2026-09-04 (g — implementation record, lane O2b and its fix round, the twin is the client: the evaluator is split into a store, a runner, and the entry and traces every point read with the digest of the wire row it disclosed, a hidden hit as an absence, and verdicts only from rule checks that disclosed their row (§6, §7); one schema and rule hasher mirrors serde's field order, refuses any field serde's struct does not carry, deep-sorts unknown variants, and the hydrate path recomputes the hash and refuses a mismatch (§6, §8); the program is held per generation beside the write bounds and re-fetched after `E_OFFLINE_RESET` (§6, §8); the drained-prefix rule is a chain of held pages on one (table, index, prefix, rule) from `after: null` to Exhausted, a page that lost a member since it was recorded is no link, and once Exhausted a page of the group holding a row the chain does not hold breaks it (§6); prediction runs inside the grant's critical section with the slice as its ids and lands overlay, trace, and `predicted` in the entry's own swap (§7); three deviations from "if every read is covered" are recorded: an uncovered range does not block a prediction, an unheld engine-maintained aggregate target does not block it and the omitted names ride the prediction, and a committed intent's overlay is dropped by an answer at or after the commit seq that touches one of its tables or any page of a drained op, never by an unrelated answer (§7); with a partition open every write carries the replay envelope or refuses `E_OFFLINE_ID_BLOCK` before any request, and only a client with no store sends plain bytes (§7); local authority violations are `E_OFFLINE_AUTHORITY` and keep coverage (§15); the IndexedDB `ranges`/`absences`/`verdicts` projections are gone (§6); the twin measures 19.7 KB gzip, engine alone 16.9 KB, and NOT-DOING's 9.7 KB is re-baselined to the measurement (§13, §14)); 2026-09-04 (f — implementation record, lanes O1b fix rounds 1–2, O2c, O4-web and its fix round, and the integration seams: grants are minted only when the request's `remaining` is absent or below 1,024 (§7, §8); the resume log op must be a certified ascending cursor page of at most 50 rows and its envelope counts against the 1 MiB budget (§8); the intent ledger is consulted before any grant check (§7); a replayed intent that rolls back on missing authority is stored as its partial terminal (§7); on the rejected path the compare set is every traced point plus every verdict a reached or probed rule check derived on a disclosed row, unreached verdicts re-derive only through the read rule, and the rule inputs a hidden candidate minted are excluded on both paths (§7); the verdict `inputsDigest` is `sha256(canonical([table, index, key]))` over wire values (§7); a replay needs a live session and the grant outlives the session (§7); the outbox's grant slice is `1 + maxNewIds` from the op's certificate, a transport failure keeps the intent queued and the retry is the same envelope, and a committed settlement lands in the same swap as the log tail (§7); `close()` resolves when the carrier is quiet (§6); asset bytes are keyed `(assetId, width|null)`, evicted least-recently-read by each entry's own stamp under the store's logical clock, and a view-once row is tracked per `(table, id)` in a durable viewed set, marked at the first byte fetch for an image and at play for a clip, read `null` on every path and excluded from coverage (§9); `E_ASSET_VIEWED` and `E_OFFLINE_CONFLICT` join the `offline` family (§15); `messages.send` stays in the template beside `deliveries.post` because a fixture pin holds `messages.q` byte-equal (§3); one open question for the author, the fence's local expiry of queued intents (§7)); 2026-09-04 (e — implementation record, lane O1b: grants are minted on every login, guest, and resume because the server cannot see the client's remaining count (§7); a trace conflict takes precedence over a program rejection, so a member removed while offline settles `conflict` rather than the program's own refusal (§7); the point digest is over the canonical wire row, which is what the pool carries (§7); an empty trace commits without a conflict check, which is the client's spelling until the twin lands (§7)); 2026-09-04 (d — implementation record, lanes O1a/O1c: the validator covers the row pool, `args`, `reason`, and `rule` (§8); row references carry engine provenance and application values are escaped (§8); `n2Key` is not on the wire; `GET /api/program` returns the schema; the recipe's tombstones reach current members and a departed member's copy is evicted by point absence, because the engine's uniformity analysis collects both arms of an `or` and Quarry cannot build a list from a range (§3); the membership cap is a maintained count (§3)); 2026-09-04 (c — the author's principle applied: the twin is the client from the start and stored-answer replay is its covered case (§6); intents carry the twin's trace and the server validates point reads and verdicts at commit (§7); the retention word ships as ruled, on the table whose rows can hide, with its twin-side meaning (§5); the bar gains one acceptance only the twin can pass (§12); lanes collapse to O1, O2, O4; (b)'s Q1–Q3 closed); 2026-09-04 (b — the panel's designs folded: positive-fact purge (tombstone rows, point absences, uniform-extent holes; no engine change), a frozen delivery envelope with one server-minted validator, resume as one owner action over the log's watermark plus mounted queries, a replay grant with an intent ledger for exactly-once, the corrected and certified recipe (page 50, `*`, a second log index for threads, compare-and-set edits), seal-not-wipe on session expiry, Web Locks across tabs, the journey primitives, the split witness, lane O3 off the bar's path pending ruling; §16 records who found what) (j — 2026-09-05: Status Implemented; the E2 witness record in §6)
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
predicted into the thread it belongs to; named `wordPrefixes` search runs
against the same persistent indexed effective rows. Writes
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
   app-declarable up to 30. Queued intents older than the fence are replayed
   after the next successful resume and the server judges them; the fence
   never discards a write (author ruling, 2026-09-04 afternoon). (§5)
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
   the intent from its arguments; an intent settles `expired` only when the
   server refuses its grant (`E_OFFLINE_INTENT_EXPIRED`), never by the fence.
   *(c): the design's trace-validated OCC ships in v1 — the intent carries
   the twin's trace; point reads and verdicts are validated at commit;
   ranges re-execute (§7).*
5. **Reconnect is watermark resume on ordered ranges plus full re-delivery
   elsewhere; general delta resume deferred.** Refined in §8: the log's
   watermark plus a validator check of mounted queries, in one owner action.
6. **Offline search is the named indexed query.** The engine and persistent
   twin share the Unicode `wordPrefixes` index; React and Expo call
   `messages.search` and preserve its `held`, `partial`, `capped`, and cursor
   facts. App-side substring filtering is removed (§6, "Indexed held search").
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

**Amendment 2026-09-05 (LLP 1016 D5, lane J2):** the purge is now the owner's
schedule, not a client action. `messages` carries `expiresAt: time ?`,
`deliveries.post` accepts it, and `schedule expireMessage on messages at
.expiresAt: purgeMessage(.id)` runs `purgeMessage` as the owner on the
background turn: the `expired` log rows to current members, then the row
deleted, exactly `unsend`'s shape, so §5 rules 3 and 1 evict the body on the
drain. The caller-invoked `purgeExpired` named above was never built and is
struck from the doing-list (`rules/NOT-DOING.md` §Moves); the sentence "the
server has no clock of its own" is superseded — it has the owner's clock, and
`POST /control/clock` drives it in development. The journey "an expiring
message is purged by the owner's schedule with every client closed" is the
acceptance.

**Follow-up (Clique L8a, 2026-09-05):** The uniformity wall recorded below is now removed when a prefix decides an `or` arm true or a membership probe is the scanned row's own nonoptional unique key (LLP 1001 §3); covering caps still govern fan-out.

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
  subscribeInputs(listener): () => void             // post-commit effective query inputs
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
  SQLite and IndexedDB write changed records and metadata fields in that
  transaction. An outbox-only swap shares unchanged history in memory and
  does not rewrite its rows or answers; LLP 1013 §14 records the workload
  that justified replacing the initial whole-state rewrite.
- **Partition, seal, wipe.** The partition key is the principal id, never
  the bearer. Sessions expire after thirty days with no renewal (§1), so a
  terminal `E_AUTH_SESSION` **seals** the partition — unreadable, outbox
  kept — until the same principal re-authenticates, at which point the
  outbox replays under a fresh grant (§7). Sign-out and principal
  replacement **wipe**. Wiping on session expiry, as revision (a) said, would
  have erased every user's messages monthly.
  Successful login, guest, signup, and `me` responses carry the authenticated
  `authEpoch`. Reauthentication as the same principal under a **different**
  epoch fences older in-flight work before the first await, adopts that
  epoch, and resets replay trust; old validators still force revalidation
  under the new session. The first epoch a partition learns — no session
  epoch and no held facts yet — is adopted without a fence or a trust reset:
  nothing in flight belongs to an older session, and fencing there cost a
  persona app its drain page and so its first grant whenever `me` answered
  mid-drain (2026-09-06, found by the browser witness). Held
  history and queued intents survive, and unsealing cached facts alone
  cannot establish a new session's epoch.
  Early cold-start reads require a durable principal binding to the loaded
  token. Built-in token stores persist that pair. A custom store supplies
  `loadPrincipalBinding()` and saves the authenticated pair through
  `savePrincipal(principal, token)`; an unbound principal hint waits for
  owner confirmation. A mismatched pair grants no cached access, even if
  another client replaces the token or an obsolete authentication reply
  writes its old binding concurrently.
  A held read (one-shot or live) waits for explicit account transitions before selecting its partition,
  and checks the same authority after the carrier read. An interrupted cold startup's
  metadata and resume remain pending until the latest transition settles and confirmed
  current custody recovers them, including after a failed login; the existing
  resume flight owns recovery and outbox replay (LLP 1002 §9). Cold held reads with
  no account transition still bypass network restoration.
  Cancelling resume releases its operation barrier independently of the transport.
  Operations waiting there recheck authority and the current recovery barrier before
  dispatching; late cancelled responses do not change settled data or auth.
  This fence includes delayed refusal bodies and JSON failures: parsing may finish
  after replacement recovery, but cannot clear custody, seal the partition, or record
  a late refusal. The separate terminal `me()` evidence rule remains in LLP 1002 §9.
- **One writer per partition.** The web client takes
  `navigator.locks.request("snapback2:" + principalId)`; a second tab gets
  `E_OFFLINE_LOCK` with the rewrite "this account is open in another tab".
  **Amended 2026-09-07 (LLP 1018.000 §8):** on web the second tab is a
  *follower*. It reads live through the ordinary wire and forwards replayable
  mutation arguments to the lock-holding writer over an origin-scoped
  `BroadcastChannel`; uploads and channels still refuse before sending bytes.
  The writer alone serializes grant allocation, prediction, intent, and a
  compact durable receipt. Its acknowledgment makes the result `queued` even
  if the follower cannot see the writer's in-memory state. A missing answer
  after send is `admission-unknown`, recoverable only with the same request
  identity through `client.recoverMutation`. Discovery before any send may
  still return `E_OFFLINE_FOLLOWER` when forwarding is unavailable.

  Requests expire within five minutes and their immutable identity carries
  that expiry. The partition keeps at most 64 live unacknowledged requests per
  follower and 256 live receipts total; it never evicts a live receipt to make
  room. Receipts survive ordinary outbox dismissal, and a persisted monotonic
  admission-clock floor prevents rollback from reopening a pruned request.
  A random writer incarnation fences obsolete answers; the server auth epoch
  and wipe-scoped durable partition incarnation fence session replacement and
  same-epoch wipe/relogin. Takeover preserves the partition incarnation,
  reloads receipt custody, resumes, and replays. The wait is withdrawn on
  close, sign-out, and account change. SQLite carriers still refuse at once.
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

Array positions alone are not row identities: shortening or reordering a
result must not revoke a row delivered at another position. A disappeared
array suffix is not a hidden signal; fresh receipt extents establish page
membership. Index extents use the evaluator's typed value order, including
Unicode scalar ordering for text, rather than JavaScript's UTF-16 order.

Purging content also invalidates held projections that depend on it. The
persisted duplicate-delivery fingerprint is a digest, never a second copy
of the delivery body. After a purge, neither that fingerprint nor a cached
scalar/object projection may retain the removed content. This is a claim
about current logical state, not forensic erasure of deleted database pages.

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
owner's schedule purging at the deadline (amended 2026-09-05, LLP 1016 D5 lane
J2: `schedule expireMessage on messages at .expiresAt: purgeMessage(.id)`
deletes the body and writes the `expired` log rows as the owner, §3; the
client-side `purgeExpired` was never built); rule 3 hides it on the drain and
rule 1 proves it. The server's own refusal is the deletion itself. No new
mechanism, no recipe dependency (§12).

**The fence.** `maxOfflineAge` is a client option, `offline: { fenceDays: 7 }`,
bounded to 1..30; a bad value is a `TypeError` like every other bad option.
It bounds **trust**: past it, the client does not predict, does not
replay the outbox before a resume has succeeded, and labels every view
`stale` with `since`. It never makes a held row unreadable, and it never
discards a queued write: after the resume succeeds the queue replays in
order and the server judges each intent (author ruling, 2026-09-04
afternoon). The server's own
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

Mounted named queries subscribe to the carrier's committed input revisions.
After a swap changes rows, coverage, authority, a query clock, or the prediction
overlay, each active shared entry reevaluates against the finished atomic state
and publishes one immutable snapshot to headless and React consumers. Overlap is
coalesced per entry; receipt/grant bookkeeping that cannot change evaluation is
silent; equal results retain identity. A server frame's own store commit therefore
does not double-publish. Program and account fences discard late reevaluations.

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
The cursor argument is restored from the held program on cold offline
startup. Following a repeated cursor is refused rather than retried in an
unbounded loop. Offline traversal never advances the persisted server watermark.

**Drain admission correction (2026-09-06, Codex Astra xhigh).**
The owner shares `resumable_log_cursor` between drain and resume admission.
It reuses LLP 1011 §B1's return-provenance walk: every possible return must
be a certified ascending page of at most 50 rows, continued through the same
declared Cursor argument, including stable aliases and shaped/conditional
returns. Unrelated auxiliary scans/cursors confer no eligibility; mixed-order
branches and non-page returns conservatively refuse the operation as a drain.
Fallthrough and early returns inside loops also lack certified page provenance.
Ordinary descending queries and separately fetched history stay valid.
The descriptor travels in the existing manifest/program metadata and is held
with its generation. Online query/subscription requests use `drain=1`; the
owner validates each page and live rerun after authentication. Offline drains
require held eligibility; legacy missing metadata must reconnect. No cursor
is decoded by the client to decide admission, and authorization is unchanged.
Refusal precedes durable watermark/catch-up success, reaches callbacks/hooks
and current/later waiters, and never clears valid coverage, grants or queued IDs.
Each event remains one page; the application log must append events for edits
and removals. The last tail is live, not every historical page.

**Search offline.** Search remains an ordinary named query over an
engine-maintained `wordPrefixes` index. The persistent twin replays the same
Unicode normalization, scope merge, ordering, prediction, and trace
invalidation over effective held rows. A complete source scope can answer a
previously unseen term as `held`; incomplete membership/history is `partial`,
and bounded discovery or execution is `capped`. The cursor identifies the
normalized non-cursor arguments and current partition/program/schema,
incarnation, authority, effective-row, and overlay revisions. React, Expo, and
headless callers see these facts directly; no app-side substring fallback
manufactures a stronger answer.

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
`retain delivered-history` table is readable to the twin. A retained answer remains
the fallback when a certified local rerun is denied, partial, or unavailable; a
complete, capped, or held rerun over independently held facts may reconstruct a
projection whose unproven literals were cleared by revocation. The auth-epoch fence is the coverage facts' epoch
bound into the verdict lookup. The IndexedDB `ranges`/`absences`/`verdicts` projections
were write-only and are deleted on upgrade; coverage derives from the held answers'
receipts.

**Implementation record (the browser witness, 2026-09-06).** The tail an offline drain
watches is opened at the page chain's own last cursor, as online; the adopted store
watermark is reported and used for the resume position only. A tail opened at the
persisted watermark answers only the rows past it and, since a view is the latest
delivery, replaced the whole caught-up inbox with the newest chat on a cold start.

**Implementation record (lane E2's witness, 2026-09-05).** An offline drain keeps the
watermark the last online drain or resume persisted. The simulator witness found a remounted
`drain: true` on an offline cold start following the twin's own page chain (the twin mints
`next` from the rows it holds — `null` for a one-page log — and the held-only path re-marks
with a fresh `updatedAt`) and recording that as the watermark, which moved the resume position
to the prefix root on every offline start. `drain.ts` now adopts the store's watermark when
its pages were answered offline (`connection: "offline"`, the base page's held `watermark`) and
`mark(…, offline)` records nothing; the five-page drain test's cold-reopen tail pins it (the
whole coverage is deep-equal before and after an offline remount). The witness's structural
consequence: a reopened database is inspected before any client constructs, because a mounted
app writes. Two narrowings of §9 landed with the same lane: a byte consumer holds an explicit
viewing token for the life of its mounted instance on both arms (a missing token refuses
before the fetch). Its video play stand-in was removed by L11: server one-use
delivery is an image column modifier; video ranges remain unspecified.

### Indexed held search

**2026-09-07 integration record.** Under the user's
explicit delegation, Codex takes engine-owned `wordPrefixes` indexing and the
persistent indexed twin onto the doing-list. Exact 2 waits until this search
qualifies on React web and Expo. The **complete local-runtime ceiling is 82,000 bytes gzip,
with 80,000 the working target**, per the architecture allocation amendment below; normalization data/decoding, indexing,
incremental state, prediction and local cursors all participate in the measured
entry. Relocating required payload is not a saving. No new gate or repository
design document is introduced. LLP 1001 §"Unicode search foundation" records
the one ordinary core `build.rs` exception and shared Unicode/key primitives.
**Implementer/date:** Codex gpt-6-astra at xhigh, foundation 2026-09-06;
engine/compiler/twin integration in the 2026-09-07 LLP 1018 run. The chat
template now declares the global membership merge and calls
`api.messages.search` on web and Expo. Its witnesses use one
decomposed-uppercase Unicode term for warm, cold, prediction, settlement, and
revocation checks. Final capability qualification still depends on those real
web/Expo witnesses and the measurements below.

**Measured scope revision, 2026-09-06.** Root revises the earlier speculative
34,000/30,000 allocation under the same unattended delegation. A pinned
Node22.23.2/esbuild0.25.9/gzip9 checkpoint reproduces the legacy entry at21,745
bytes, that baseline with existing projection/receipt bodies retained at24,094,
and the then-measured WIP entry at46,838. Its minified bytes are138,082;
minified attribution is not additive gzip attribution. The earlier44,290 figure
omitted required `ProjectionCache.prepare` and `toClosureReceipt` bodies despite
including their modules; retain it as an incomplete measurement, not a pass.
Reaching34,000 would require a27.4% reduction with no identified redundant code
supporting that estimate. The revised50,000 ceiling/48,000 target pays for the
complete indexed, Unicode, receipt and carrier behavior instead of deleting it.
This is a new scope decision, not retroactive compliance with34,000. Exact2
remains deferred; 1M steps/4MiB closure/8MiB heap/1MiB output are unchanged.
A subsequent boundary audit found that the46,838 entry still omitted edited
PersistentRangeStore commit/applySwap/retirement bodies; it is also incomplete.
The50,000 decision above remains historical pending a complete boundary audit,
not evidence of compliance. Integrated measurement must
retain every required body and data payload. Evidence:
[exact checkpoint](../benchmarks/runs/2026-09-06-clique-improvement/evidence/search-byte-decision/byte-checkpoint.json).

**Final boundary decision, 2026-09-06.** Root supersedes the earlier speculative
34,000 and partially measured 50,000 allocations with a 66,000-byte gzip ceiling,
64,000 target. The fixed entry retains complete Twin, PersistentRangeStore,
OfflineRuntime plus offlineView, the full projection namespace, and the full
receipt-protocol namespace. It includes all local execution, custody, retirement,
normalization data and decoding; HTTP/SSE framing and physical-driver forwarding
remain explicit adapter exclusions. No required algorithm may move there to
escape measurement. This is the complete local runtime, not the entire SDK or
an estimate of downloaded application size.

Pinned Node 22.23.2 / esbuild 0.25.9 / gzip 9 measures the same roots at 39,671
bytes on exact foundation 1f9 and 62,624 in current WIP. An exhaustive 156-export,
28-module cross-check is 63,023; parsing the minified canonical output confirms
all methods of 21 edited/new exported classes survive. The 399-byte difference
is unused standalone helper exports. The earlier 54,140 generic-carrier result
omitted edited OfflineRuntime custody paths; 46,838 and 44,290 also omitted
required bodies. All remain historical incomplete measurements, not passes.
This superseding decision preserves required behavior and makes room for final
review repairs; it changes no runtime resource ceiling or Exact 2 deferral.
The final frozen source must be measured again using these same roots and must
pass runtime, native, durable-store and independent review qualification.
[Boundary manifest](../benchmarks/runs/2026-09-06-clique-improvement/evidence/search-byte-decision/boundary-manifest.md)
and its adjacent exact entry, measurements, method-retention and excluded-input
records establish what is counted. No final capability is claimed here.

**Architecture allocation amendment, 2026-09-07.** Under the user's explicit
commission to refine and implement LLP 1018.000, Root adopts an **82,000-byte
gzip ceiling and 80,000-byte working target** for the same five-root entry.
The canonical toolchain is **Node 24.18.0 / esbuild 0.25.9 / gzip level 9**.
The historical 62,624 figure above used Node 22.23.2; it is not a controlled
subtraction from these Node 24 measurements.

Exact same-toolchain measurements are 77,571 before forwarding (`3253187d2`),
79,272 at `c5c562667`, and 79,207 after Words retirement and intervening
integration fixes (`527861e673`; 244,019 minified bytes). The last measurement
fails the old 66,000 ceiling. The 65-byte decrease is an observed integrated
delta, not an isolated causal saving from Words. The revised ceiling adds
16,000 bytes (24.2%) and leaves **2,793 bytes for remaining integration/review
repairs**; the working target is 793 bytes above the measured candidate. The
reserve cannot silently fund another feature, and exceeding 82,000 still fails.

The separately measured complete `client.ts` source entry grows from
103,794 to 110,485 gzip with forwarding, then to 110,520 at `527861e673`.
Both earlier numbers reproduce exactly alongside the latest result. These
isolated complete-source measurements retain the same two optional SDK
imports, `expo-file-system` and `expo/fetch`, as runtime imports; installed
Expo/React Native SDK code is outside this source-footprint comparison. A
warm-checkout attempt that bundled those SDKs failed on their Flow/module
syntax and produced no measurement. Neither entry estimates an app download.

No measured alternative establishes a safe route back to 66,000. Unicode
packet/codec experiments grew; replacing inverse indexes with scans loses
bounded work; retaining only surviving answers loses durable guards and
historical key proofs. A tagged proof design still needs global, answer and
transaction ownership, reverse lookups, interning, rollback and exact slot
charges; it established no substantial deletion. This is evidence for a
footprint trade, not proof of global optimality. Public Words and the old
Quarry data frontend are retired within the commissioned simplification.
No required payload moves outside the entry, no dependency/gate is added,
and the 1M-step/4MiB-closure/8MiB-heap/1MiB-output limits stay.

The [Sol allocation review](./reviews/1018.000-runtime-allocation.sol.md) and
[Grok allocation review](./reviews/1018.000-runtime-allocation.grok.md) both
mark the same frozen amendment READY. Root accepts that allocation under
the current delegation. This does not qualify unfinished code, latency,
Web/Expo behavior, publication, or the published-package bars. Final
integration and review repairs must be measured again against 82,000.

Keep one indexed store per open principal/program/schema generation. Cold open
constructs it once; warm evaluation consumes an incrementally maintained atomic
snapshot, not whole-history `coverage()` cloning. Immutable rows and a prediction
journal maintain FIFO overlay contributions per row. Removing/rejecting/retiring
an overlay recomputes effective rows/postings; authoritative absences, tombstones,
expiry and applicable revocations dominate stale overlays. Queued intent IDs,
arguments and point/verdict replay traces remain fixed. Ranges still re-execute
against current state at server replay and are not snapshot-compared.

A maintained readable-source scope directory includes delivered-history rows
even when membership downloads are partial. Their existing hidden-case
readability remains; explicit purges still remove them. Until-revoked rows need
current authority evidence. Missing required authority remains partial with no
computed result or continuation; index presence grants nothing. Eligible global
search receives a compiler-certified held execution descriptor only when lane
discovery enumerates the source rule's authorization scopes without extra
application filters or side effects. It may enumerate that source directory
locally without fabricating membership rows/verdicts. Ordinary scope arguments
still filter; arbitrary merges keep normal replay.

`held` means exact over locally readable held rows in the requested scope when
local enumeration is whole but server coverage is not. Directory overflow,
truncated discovery or exhausted execution bounds remain `capped`; covered
queries retain ordinary complete/capped page rules. Complete source scopes
cover unseen terms; complete term-search ranges never imply whole source scopes.
No result claims more than its authority/coverage proves.

Local `h1` cursors bind the exact non-cursor query values (word bindings by
normalized meaning), operation/page descriptor, partition, program/schema,
fresh store incarnation and authority/effective-row/overlay revisions plus the
ordinary suffix. Their byte bound follows declared arguments; current server
cursor identity and 4,096-byte payload limit stay. Changes reject a local cursor
and restart paging. Server preflight rejects `h1` before any discovery; clients
never send it after reconnect. It cannot move a drain watermark, retire an
overlay or prove server progress. Cold reopen has a fresh incarnation.

Before this integration qualifies: measure the complete twin, actual 100-lane
whole media-bearing message closure and max-width operations under the existing
1M-step/4 MiB closure/8 MiB heap/1 MiB output limits; prove warm never-queried and
cold process-kill search, partial memberships/history, authority/retention,
negative-overlay dominance and cursor fences; measure phone cold-build peak and
the full-engine 10%/50%/100% latency curve. The foundation's Unicode conformance
is evidence for its primitive, not those integration claims.

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

**Recovery surface (2026-09-05 review fixes).** `outbox.status(op?)` and the
React outbox/mutation hooks expose readiness, a reason (`ready`, `sealed`,
`grant-missing`, `grant-expired`, `ids-exhausted`, `program-missing`), the
next action (`none`, `login`, `resume`, `load-program`), queued count, and
fence state. New admission agrees with readiness when a grant has expired;
existing queued writes still await the server's verdict. `drain()` and
`settled()` return `{ stopped, remaining }`, with `stopped: false` for a
drained queue or `fence | transport | authority | offline | pending` for a pause.
Transport stops are observable and preserve byte-identical retries.
Recovery is explicit through `online()`/`drain()`; a subscription reconnect
alone makes no automatic replay promise. Both chat composers show the
recovery reason and a Sync now action, keep refused drafts, and distinguish
a predicted preview from a server-confirmed message.

For a web follower, the same status surface reports `writer-discovery`,
`writer-capacity`, `writer-unresponsive`, or `ready`; `follower` remains the
hard refusal when the carrier cannot forward. A writer acknowledgment reports
durable admission, not settlement. If no answer arrives within two seconds
after send, mutation returns `{ state: "admission-unknown", recovery }` and
keeps its bounded pending slot until acknowledgment or expiry. The opaque
token binds the operation/argument digest and exact account, auth epoch,
carrier scope, expiration, and durable partition incarnation. Calling
`client.recoverMutation(ref, args, recovery)` either reproduces the receipt's
original `intent` and `ids`, returns the same unknown outcome while the writer
is unreachable or an expired receipt is absent, or refuses a mismatching
scope without a write (LLP 1018.000 §8).

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

The live session is checked first. Stored terminals are then looked up
using the stable replay-envelope digest before current operation lookup,
kind checking, or schema-dependent trace decoding. Removing an operation
or changing a traced schema cannot strand an already settled intent;
new intents still undergo all current-program validation.

**Replay.** After a resume succeeds (§8), the client drains the outbox in
FIFO order, one intent per request, waiting for each receipt. A transport
failure mid-drain leaves the intent `queued` and stops the drain; the next
attempt is the same envelope. A rejection settles that intent only; the
drain continues. An intent whose grant is past the fence is not replayed
before a resume has succeeded and is replayed after one, whatever its age;
the server's thirty-day grant rule (`E_OFFLINE_INTENT_EXPIRED`) is the only
expiry, and the client's clock never judges a write (author ruling,
2026-09-04 afternoon, replacing revision (b)'s local expiry).

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
settles only its own intent; a grant past the fence settled `expired` locally
until the afternoon ruling (lane F removed that; its record follows);
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
drains a held queue even when no resume can be built. *Revision (f)'s open question
is ruled (2026-09-04 afternoon):* the local expiry of intents whose grant is past the
fence discarded writes the server would still accept for thirty days and would
validate by trace; the client now replays after a successful resume and lets the
server judge, keeping the fence for prediction and the `stale` label only (lane F).

**Cancellation follow-up (2026-09-06).** Resume-owned transport awaits race the
resume signal, including replay responses/bodies and the log-tail fetch. Cancellation
unwinds the existing serialized drain without waiting for transport cooperation;
the durable intent stays queued. Replacement recovery retries that exact envelope
before later intents, even if the old request already committed at the owner.
The ledger provides exactly-once execution and the old signal fences late results
before they can settle intents, advance the drain, or change the client snapshot.
The same cancellation applies to mutation-owned and explicit outbox drains on
offline, close, an auth transition, or terminal expiry. Expiry cancels sibling
drains while the request that observed the terminal keeps its original refusal;
it neither rereads a sealed store nor enqueues a new call behind an older intent
after that terminal. This includes typed HTTP 200 `rejected`/`refused` session
terminals: the JSON boundary applies the same captured-custody expiry as HTTP
401 before replay settlement, resume admission, or log-tail decoding. The
exact durable envelope stays queued, including after an owner commit whose
tail refused; fresh same-principal login retries it through the ledger. Ordinary
intent refusals remain local to that intent. A tracked mutation lends its captured
authority to its drain, so it cannot wait on the transition that is waiting for
that write. Cancellation keeps the durable intent and releases the serialized
drain; fresh recovery still retries the identical envelope.

**Implementation record (lane F and its fix round, 2026-09-04).** Replay eligibility is
per intent and per partition: an intent whose grant is past the fence, or that was
enqueued past it, replays only after a successful resume of *its* partition since the
fence was crossed; a fresh login grant never releases older queued work; missing trust
waits, and nothing expires on the client's clock. The resume trust anchor is cleared on a
partition change, seal, wipe, close, and coverage reset. A partition holding a grant and
queued intents but no coverage facts recovers by a receipt query that supplies facts and
then the owner's logless resume; when no query can supply them, `online()` refuses
`E_OFFLINE_RESUME` and keeps the queue. `drain()` and `settled()` return
`{ stopped: "fence" }` past the fence; `ready()` means a current grant (the fence does not
gate it) and `useOutbox().fence` is `inside | past`, which the chat composer renders as
"Queued until the next sync". An intent enqueued past the fence carries no trace and is
marked unpredicted with `reason: "fence"`: the server commits it with no OCC (the O1b
record's empty-trace rule), so past the fence the program's own `require`s — the recipe's
compare-and-set `edit` — are the only conflict rule, which the real-owner journey proves
(a stale past-fence edit is rejected by the program's `CONFLICT`). Empty-trace commits
are therefore routine after a long absence, not rare; an app that needs stronger
protection writes its `require`. The client still sends no `remaining`, so the real owner
mints a grant on every resume; the grantless path is proven against a fake that omits the
grant.

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
under another id than the server's is pinned by the three-member group journey; the
author accepted this deviation on 2026-09-04 afternoon); an
unheld engine-maintained aggregate target does not block it, and the omitted target names
ride the prediction and the outbox entry (`omitted`); authoritative evidence at or after
the commit seq for any ordinary row retires the mutation's ordinary write group, including
fan-out rows whose server ids differ, while each engine-maintained target waits for its own
row or negative evidence. A proven page of a drained op or the bounded miss rule retires
what remains. This keeps a maintained target's predicted value until its own authoritative
row arrives instead of exposing a transaction assembled from an arrived source row and a stale aggregate. An
unrelated answer still retires nothing, and with no watermark and no matching delivery the
overlay stays. An uncovered point read, an uncovered rule input, or a local
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

**The retirement rule as landed (lane T1, three review rounds, 2026-09-04; maintained-target
amendment, 2026-09-07).** A committed prediction retires its ordinary write group on
authoritative evidence for any ordinary member — the arrival of a predicted non-deleted row,
or a primary point absence or tombstone at or after its commit seq for a predicted id that no
newer held row supersedes, including evidence saved while the intent was still queued. This
group rule covers server fan-out ids that differ from the twin's viewer-only fan-out; row-body
similarity never proves identity. Engine-maintained target rows remain independently until
their own evidence arrives. The remaining overlay can also retire, for predictions with
non-deleted rows, on a non-empty held page of the
selected log strictly beyond its persisted commit snapshot, reached through currently held
next-links recorded at or after that seq; the chain's query identity uses the store's one
canonical serializer, an ambiguous link or a cycle keeps only the proven prefix, and an
evicted progress page re-anchors at the nearest surviving consumed position. Otherwise a
proven forward mark of the selected log or a successful resume strictly after the commit
consumes at most one miss per swap, with consumed positions and the snapshot's cursor name
persisted across a reopen, and two misses remove the overlay and clear `predicted` while the
replay entry stays `committed`.

Maintained rows add an authority dependency to that lifecycle. A source-row insertion,
deletion, group move, or sum-input change at sequence *s* withdraws any older target row,
primary absence, or target-table range that could otherwise supply a stale aggregate; this
is missing authority, never a manufactured zero. Target-specific retirement leaves an
admitted mutation's predicted target over that hole until target authority at *s* arrives. If the
bounded miss rule retires it first, the query is partial rather than exposing the pre-commit
target. An answer or row version already held at prediction admission cannot confirm that
prediction, even when its sequence equals the commit sequence. Confirmation needs accepted
evidence that advances the original admission, or a newly ordered authoritative answer;
the unchanged baseline must not remove a predicted count while its target refresh is pending.
Arrival can run in the other order: a changed maintained target marks every older
named answer that references it `partial/maintained-coherence`. That marker and the answer's
authorized history survive a cold reopen, and a global-pool rerun cannot promote the record;
owners that proved sparse zero by a point absence or target range are fenced too. Only a new
delivery for that named query publishes another usable complete/capped value. A later overlay
cannot prove that an earlier remote sibling arrived; partial history can still show its local
prediction without presenting a count or preview. Unrelated source-field updates whose
maintained contribution is unchanged withdraw no target authority.

**Retirement follow-up (2026-09-06).** Reset also clears each overlay's saved primary
absences and tombstones: these are coverage facts, so a delayed terminal cannot use a
negative from the former generation. The intent, overlay, and replay bytes survive;
fresh evidence in the new coverage can retire it at the same data sequence. A retained
answer, including a denied delivery presented as its previously complete history,
cannot supply either arrival or a continuation link. The client state reducer and
the range store now import the same canonical serializer. The real-owner regression
uses minted cursors and validates the recorded cursor name's precedence over a stale
metadata fallback; the owner refuses the wrong spelling. Scalar-field projections
of a returned page remain supported, including after cold reopen. An outer object
wrapper (`return { entries: page }`) has no certified `result_pages` in the current
contract and is refused as a resume log; the follow-up's alleged object-tail defect
was not reproducible through that contract. This changes no supported projection
shape and does not add wrapped-page cursor semantics.

**The supersession and reset rule as landed (lane T2, three review rounds, 2026-09-04).** Any
delivery under a generation or schema other than the held program's is never installed: the
caller still receives its live rows, but coverage is marked superseded and serves nothing
until reset. Reset drops all coverage — rows, answers, watermarks, and generation-scoped
negative evidence, never the outbox, its overlays, or viewed custody — adopts the live
program's custody first, then rebuilds with fresh authenticated reads (a detached,
cancellable flight; three rotations before a durable refusal), while every outbox
settlement is fenced to its coverage revision so a stale tail stays queued and retries
byte-identically; `ready()` and `ready(op)` are false on a sealed partition, React readiness
is bound to client, authentication, and operation identity, and the fence boundary and grant
expiry notify subscribers on a timer. Residuals are filed in the supersession follow-ups
ticket of 2026-09-04.

## 8. The delivery envelope, the validator, and resume

A public maintained Count query may deliver an empty full-group range together
with a separately verified canonical primary-ID absence (LLP 1001 §4). The
existing carrier and twin consume these independent facts for maintained-row
uniqueness and starting value, respectively. Cold reopen preserves the pair;
subsequent predicted counts still obey the cap. This is not authority inferred
from a stale cached scalar, and it does not widen alternate-index absence
export or permit receipt-only clients to mint new group coverage.

A trusted prediction records its original row-specific admission basis and
sequence in the existing per-intent ledger, atomically with the intent and
overlay. A creation requires an exact held primary absence that preceded
admission. An update or deletion can instead use an already held positive row
whose version is newer than any primary negative. The runtime-wide sequence
counter cannot provide this authority: unrelated queries can advance it, and
cold reopen can restart it at zero.

The original basis remains fixed while later accepted evidence advances.
An absence-created prediction is contradicted by a later authoritative row or
negative, or by an explicit same-sequence tombstone. A row-admitted field or
full-image assignment continues to replay over newer positive bases; a primary
negative at or after its admission version revokes that old assignment.
Contradiction remains durable even after a later positive row, answer collection,
or cold reopen. A single atomic swap must preserve an intervening revocation
as well as its newest positive evidence. Only facts actually admitted by the
coverage transaction can contradict an intent; ignored raw frames cannot.

Equivalent same-sequence absence refreshes and answer replacement or collection
alone do not erase an uncontradicted admission. Changing only this ledger still
invalidates the affected projection. Coverage reset clears it with the existing
negative ledger. Extent-hole, viewed-row and revocation protections remain.
Receipt arrival cannot retroactively authorize an unadmitted prediction, and
neither a cached zero nor a larger process-wide counter grants an exception.
Admission seeks the existing carrier absence index; no second receipt-owner
index or memory-only proof chronology is retained.

The package build emits two distinct declaration products. The compiler loads
the private `authoring-lib.d.ts` ambient module while checking authored effects,
seeds and journeys. The shipped `index.d.ts` is an ordinary external module: it
combines strong generated API types with the SDK's real runtime re-exports and
copies their private evaluator/compiler declaration dependencies beneath
`dist/`. The standalone offline-protocol leaf remains a separate declaration.
Every import in that installed graph is relative and self-contained; no test
maps declarations back to workspace source.

The actual copied-package consumer checks the complete graph with
`skipLibCheck` both true and false, including the public and standalone
offline-protocol forms. A boolean-to-number negative assignment must remain an
error. Preparation candidate `367d263b8` correctly identified one redundant
ambient `declare`, but the integrated graph exposed the larger root/module
split recorded in LLP 1018.001 §6. The self-contained external graph is the
packaging rule.

Package consumer regressions additionally check the root and standalone forms
with `skipLibCheck: false`, including all library diagnostics, root/standalone
type compatibility, and preservation of standalone modifiers. This declaration
packaging rule changes no wire types.

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
  readTime?: number;       // the owner's execution read time, only when the certificate reads the clock (2026-09-07)
}
```

**Clock-reading programs (2026-09-07).** A query whose certificate carries
`read_time_granularity_ms` re-executes at one durable `seq` with a different
answer, because `now` moved. The owner stamps such deliveries with the
execution read time it pinned; the client orders same-`seq` deliveries of that
op by the stamp: a later execution installs, an older one arriving late is
stale and stays out, and the same stamp with different bytes — or a delivery
without one — is the equivocation §8 refuses. The stamp is outside the
validator and the fingerprint: an answer's identity is its bytes, the stamp
only says which execution is later. Found on the published 0.0.10 by the
independent verification (`clock.serverNow` refused on its second read,
warm and cold, on Node and the Expo carrier).

Rows appear once, in the pool; `data` and the receipt reference them by
`(table, id)` through engine-tracked provenance — never by body equality, so two
identical rows in two tables keep their identities — and an application value
that happens to be shaped like a reference is escaped as
`{ "$row": { "$value": … } }`; the client expands before exposing `data`.
Network expansion, held-answer expansion, and reference collection share
the same escape rules, so application literals do not acquire false row
dependencies on persistence or reopen.
Schema-owned maintained addresses follow LLP 1001#maintained-addresses through
public delivery, held rows, byId absences and cursor suffixes. Structural wire
decode preserves the exact address string; schema preparation validates its
declared target and canonical grouping tuple before it becomes held authority.
A row-pool record's address must equal its body id, and a long maintained row
must reproduce its tuple from its grouping fields. Shared Ref/Optional/List
validators grant no exception to authority principals or untyped ids. Cursor
use binds the current schema/index/order/suffix and retains the 4,096-byte limit.

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
`{ state: 'unchanged', seq, validator }` on equality. The client answers an
`unchanged` from the held envelope re-shaped to the plain wire form: `next`
only on a page (`complete`/`capped`), never on a replayed `denied` or
`partial`, whose envelope carries `next: null` (2026-09-06: the second ask of
a denied room threw `E_WIRE_SHAPE` on 0.0.10).
`GET /api/subscribe?…&validator=` opens with an `unchanged` first frame on
equality, which ends the reconnect double-execution (`live.rs:117-146`).

**Conditional refresh and full re-delivery (2026-09-06).** A held answer's
`seq` can advance on `unchanged` while its duplicate-delivery fingerprint
still binds the original full envelope's sequence. That original sequence
is already persisted as `nextSeq`. A full delivery at the refreshed `seq`
must match every fingerprinted field with only the sequence normalized to
`nextSeq`; a changed body, row pool, receipt, validator, cursor, state,
reason, or rule still refuses. Once matched, install the full delivery
normally, binding its rows, fingerprint, and continuation evidence at the
new sequence. `unchanged` alone never renews a continuation link; a repeated
full delivery after installation is idempotent. No stored fingerprint is
discarded or recomputed from potentially changed held rows.
The real-owner reconnect reduction reproduced the false conflict on
`21b21abd3` for a joined inbox, its alias alternative, and a plain page:
only `seq` differed, and the queued send remained pending. The fix covers
finding 5 in `issues/20260904-snapback2-overlay-retirement-followups.md`.
The retained published 0.0.6 M6 observation lacks response bodies, so its
exact historical field difference and the proposed query-shape diagnosis
remain unconfirmed; the reduction proves this independently present defect.

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
→ 413 E_OFFLINE_RESUME { reason: "limit", which: "mounted", cap }
→ 413 E_OFFLINE_RESUME { reason: "unsupported-log", which: "log", op, shape }
```

Only a structured mounted-count limit can trigger one smaller retry; no
unsupported/unclassified refusal is repaired by dropping `log`. An ordinary
mounted query remains mounted, never an implicit stand-in log. A restored
backward watermark stays in requests and keeps `online()` rejected and its
drain visibly refused across reopen. The failed sync renews no replay trust.
Separately requested `outbox.drain()` may use independently valid grants/fence;
a known unsupported log is omitted only from settlement-tail fetching, with
its watermark and sync refusal retained. Write settlement does not claim log
synchronization. Past-fence work still needs successful reauthorization.

The server, in order, on the owner thread at one `seq`: authenticate;
compare `authEpoch` (stale → seal, no data) and `generation`/`schemaHash`
(mismatch → `E_OFFLINE_RESET`); admit the log shape; mint a grant if remaining ids are low; run
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
default 256 MiB, LRU by the byte entry's own last-read time. Asset delivery checks
authority and cancellation after complete byte conversion and each cache await,
including uncached reads and cache hits, before returning public bytes. **Once rows
never enter the byte cache**, even before viewing. LLP 1006 §2a.1 implements
server one-use images: `image <=N once` comes from the manifest / program
schema, replacing the deleted client `viewOnce` option. Offline their media
reads `null` and the twin never predicts their fetch. Consumption is per
authenticated principal under the owning row's rule, durably recorded on
full-body 200; prior views are unrecorded when an existing column gains `once`.

**Implementation record (L11, 2026-09-05; supersedes O4's client stand-in).**
Ordinary bytes are keyed `(assetId, width|null)` and evicted least-recently-read
by each entry's own stamp under the store's logical clock. A read stamps in
memory and the next swap persists the order. Schema custody and viewed image
IDs persist in the same carrier swap as coverage. The local viewed set keeps
per-row, per-image consumption; an image list remains available until each
image has been viewed. A fully viewed row reads `null`, is excluded from
coverage as a `byId` absence, and a new byte consumer refuses `E_ASSET_VIEWED`.
The mounted viewing instance retains its original image in session memory,
including across width changes; seal, wipe, and principal change clear it.
A successor adding `once` purges existing byte leases in the schema swap.
The drain and resume tail key the cursor by the manifest's `Cursor` argument.
The file carrier orders payloads, state rename, and removals, then sweeps on
open; IndexedDB uses one transaction.

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
+ 1); online();` then the owner's `expireMessage` schedule firing
`purgeMessage` (LLP 1016 D5, amended 2026-09-05; there is no client
`purgeExpired`) and a resume, and the held log no longer contains the body. `snapback2 why <query>` gains one line from
certificate facts it already has: "offline: N uniform ranges held as
coverage, M primary point reads; a held answer replays exactly".

**The witness** (scheduled; the bar's durability evidence), split by lane:

- **O2, browser:** seed; drain the log; open three chats; **enqueue one
  message while offline**; kill the browser profile **once during a
  `commit`** (a harness barrier inside the swap) and once at rest; cold
  start with the backend stopped: the inbox, the three chats, and the
  queued message are there, and a chat never opened online renders its held
  rows and prediction; boot
  with the carrier refused and see `E_OFFLINE_CARRIER`; start the backend;
  inject a 503 after the commit of the first replay: exactly one row on the
  server, the bubble does not move; the second message commits in order; a
  Unicode indexed search is warm and cold, publishes the prediction, and drops
  a message revoked while offline after resume. Two tabs: the second follows
  the writer (LLP 1018 §3), no longer `E_OFFLINE_LOCK`.
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
| 6. Local token index | **taken**, 2026-09-06 session-delegated search scope; shared Unicode/key foundation first | engine/compiler/held-twin integration and qualification follow |
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

**Amendment 2026-09-05 (LLP 1016 D5, lane J2):** the `purgeExpired` dependency
is discharged by the engine, not a recipe: M5 acceptance 1 is the template's
`expireMessage` schedule (§3), fired by the owner with no client connected.

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
and records the move. **2026-09-06 session-delegated amendment:** Exact 2 now
waits until Unicode prefix search qualifies on React web and Expo; this funds
the local token index and coherent online/offline path. The user delegated these
implementation choices in the current session; they are not a retroactive
claim about the earlier author ruling. The hosted target stays where it was.

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
  landing 6 (19,717 at landing 5), the engine alone 16,898, under the author's
  30 KB ceiling, recorded in `snapback2/metrics/twin.jsonl` with the
  method; NOT-DOING's 9.7 KB is re-baselined to the measurement.

The 2026-09-07 architecture allocation sets the current complete local-runtime
ceiling to 82,000 bytes, with 80,000 as the working target (§"Indexed held search"). The historical
measurements above do not measure the complete search implementation. Record
its integrated whole-entry size, phone index/cold-build storage and full-engine
search curve when those lanes execute; no additive-prototype headroom claim.

## 15. Diagnostics

Runtime, family `offline`, each with a site, a rewrite, and the page
`snapback2 guide offline`: `E_OFFLINE_CARRIER` (carrier unavailable),
`E_OFFLINE_STATE` (preserve and inspect persisted state),
`E_OFFLINE_DELIVERY` (inconsistent delivery; retry an authenticated read),
`E_OFFLINE_LIFECYCLE` (sealed, closed, or unopened; sign in or reopen),
`E_OFFLINE_LOCK`,
`E_OFFLINE_RESET`, `E_OFFLINE_RESUME`, `E_OFFLINE_INTENT_EXPIRED`,
`E_OFFLINE_INTENT_REUSE`, `E_OFFLINE_ID_BLOCK`, `E_OFFLINE_AUTHORITY` (a local
principal or auth-epoch mismatch; coverage is kept; another generation supersedes the
coverage instead), `E_OFFLINE_CONFLICT` (the
refusal a `run()` throws when its intent settles `conflict`); a conflict is a mutation
state (`rejected`, `reason: 'conflict'`, with the site) on the wire, not a code.
`E_ASSET_VIEWED` belongs to `assets`, with a delivery site, a new-image rewrite,
and the Quarry page; HTTP delivery refuses 410 for an already consumed image.
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
