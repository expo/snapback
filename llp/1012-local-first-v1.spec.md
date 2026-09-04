# LLP 1012: Local-first v1 — the client store, the outbox, retention, and the offline bar

**Type:** Spec
**Status:** Review (the thirteen author rulings of 2026-09-04 are folded in §2
and are decided; the text that spells them out has not been panel-reviewed;
per `rules/RULES.md` it binds lane by lane as each lane's code lands, and
nothing in it binds before the loop bar is met)
**Systems:** `snapback2/packages/snapback2` (client, React, the range-store
carriers, the `chat` template, the recipes), `snapback2/packages/evaluator`
(the twin, lane O3), `snapback2/packages/compiler` (`retain`, the certificate's
retention line), `snapback2/crates/snapback2` (the wire: the receipt on the
stream, `/api/resume`, id blocks, intent age), `snapback2/crates/snapback2-core`
(retention policies in the certificate; `ClientStore` as the reference replay),
LLP 1006's asset client (the device byte cache, §9), `rules/NOT-DOING.md`
**Author:** Claude Fable 5.1, at the author's direction and rulings, 2026-09-04
**Date:** 2026-09-04
**Revised:** —
**Related:** LLP 0329.014.004 §5 dimension F and §7 (the contract this
implements), LLP 0329.014.007 F8 and F11 (the assessment; "not a replica"),
LLP 0329.014.008 (the eight worked candidates — §11 says which this takes and
which wait), LLP 1001 (engine: `ClientStore`, `new_ids`, receipts, absences),
LLP 1002 §4 (wire) and §9 (client states; `queued` reserved), LLP 1006 §9b
(bytes on the device), LLP 1007 §4a (the two-bar pattern), LLP 1009 (shelved by
the trade, §13), `benchmarks/briefs/social-messenger.md` M5–M6,
`issues/20260830-snapback2-wire-evaluator-into-public-client.md`,
`issues/20260806-expo-file-carrier-process-kill-witness.md`,
`guide/sync/offline-and-retention.md` (Snapback 1's four mechanisms — what
not to rebuild), `rules/NOT-DOING.md`

## Summary

A WhatsApp-shaped app keeps its messages on the phone and reads them with no
network. On 2026-09-04 the author said Snapback 2 must do this well. This spec
is the implementing form of the design's local-first contract (LLP
0329.014.004 dimension F and §7), narrowed to what a messenger needs and no
further, with every choice ruled by the author the same day (§2).

The model in one paragraph. The client stays what the design says it is — *a
result cache plus cursor state plus an outbox, never a relational replica*
(LLP 0329.014.007 F11) — and gains a **durable, per-principal range store**
that keeps every certified result the server delivered, under a **per-table
retention policy** (`until-revoked` by default, `delivered-history` for
message tables). Reads offline replay stored answers first (lane O2) and are
re-run locally by the twin second (lane O3), exact or honestly `partial`,
never invented. Writes offline go to a **FIFO outbox** of named mutations,
replayed after reconnect and settled by the server's optimistic concurrency
check, with `queued`, `committed`, `rejected`, and `expired` as the states.
Reconnect is **digest-checked re-authorization** of every held range at one
version — unchanged ranges cost a hash on the wire. "Every message on the
phone" is a *program shape*, a per-viewer delivery log, not platform
machinery (§3). The fence `maxOfflineAge` bounds **trust**, never
**reading** (§5). Asset bytes cache under the owning row's lease (LLP 1006
§9b). The evidence is a **physical process kill and cold start** on the iOS
simulator and a real browser, with the backend stopped (§10).

Of LLP 0329.014.008's eight candidates this takes none whole. It takes the
*shape* of candidate 4 (bytes under the row's lease) and a cheaper cousin of
candidate 3 (digest-checked resume instead of per-row versions). Hold sets, the
dependency-aware outbox, per-row delta resume, the local token index, per-field
`unheld`, the store budget, and cancel/`asOf` wait for a brief whose number
asks for them (§11). The trade that pays for this on the doing-list is LLP 1009,
observability, shelved (§13).

## 1. Where offline stood on 2026-09-04

Checked against `origin/main` at `42a7a4e3d`:

- **The shipped client is in-memory.** `packages/snapback2/src/client.ts`
  reconnects SSE with backoff and keeps the last delivery as `stale`; there
  is no durable store, no outbox (`queued` is reserved and never claimed, LLP
  1002 §9), and no local evaluation. The server sends a full result per
  delivery; the subscribe path has no resume.
- **The twin exists and is unwired.** `packages/evaluator` is conformant with
  the Rust engine on the corpus; the public client never imports it
  (`issues/20260830-snapback2-wire-evaluator-into-public-client.md`). The Rust
  `ClientStore` (`snapback2-core/src/client.rs`) hydrates an in-memory engine
  from a closure receipt as a test harness — the S1 spike's descendant.
- **Quarry has no retention spelling**; `snapback2-core/src/retention.rs` is
  cost estimation, not lifecycle (LLP 1009 §5).
- **The design is on paper.** Dimension F and §7 of LLP 0329.014.004 define
  the contract; LLP 0329.014.008 works eight extensions. The evidence is one
  in-process spike. There is **zero real-device evidence**, on either side —
  the same hole Snapback 1 never closed (`issues/20260806-…`).
- **Governance read it as fully deferred.** `rules/NOT-DOING.md` excluded
  "offline beyond retention v1", a phrase defined nowhere; LLP 1001 §"Deferred",
  LLP 1002 §9, and LLP 1007 §7 each treated *all* offline as after the bar. The
  brief's offline obligations sit at M5 (warm-offline search) and M6
  (cold-start reads, offline writes in order, on the iOS simulator), outside
  both the loop bar and the capability bar. The line's own trigger — "if the
  benchmark asks for them" — was already met.

## 2. The rulings (author, 2026-09-04)

Thirteen decisions were put to the author with a recommendation and a
confidence each; the author ruled on all thirteen. Recorded here as decided.

1. **The fence bounds trust, never reading.** Past `maxOfflineAge` the client
   neither predicts nor replays queued writes without a fresh
   re-authorization, and every view is `stale` with an age. Delivered rows
   stay readable until the device syncs a revocation. Tables that must go
   dark on their own clock use the per-table lease the design already has
   (not in v1). Default 7 days, app-declarable up to 30. Queued intents older
   than the fence settle `expired` instead of replaying. (§5)
2. **Copy the answers, not the mailbox.** The result cache stays; no replica.
   "Every message on the phone" is the per-viewer delivery-log program shape,
   published as a recipe and adopted by the `chat` template. (§3)
3. **Offline reads are staged.** Lane O2 builds the range store, stored-answer
   replay, and the outbox on the row-per-range shape the twin needs; lane O3
   wires the twin for local evaluation and prediction. (§6)
4. **Offline writes.** A durable FIFO outbox per device; replay after resume;
   each intent settles on its own (a rejection does not cancel later intents);
   the server's OCC is the only conflict rule (`merge` modes and `sequence`
   deferred); `predicted` when the twin's reads are covered, else the app
   renders the intent from its arguments; intents older than the fence expire. (§7)
5. **Reconnect is watermark resume on ordered ranges plus full re-delivery
   elsewhere; general delta resume deferred.** Refined in §8 without changing
   the ruling: every held range is re-authorized at one version, and a range
   whose digest is unchanged costs a hash, not a page. Reconnect bytes for the
   Clique inbox are measured so the deferral carries a number. (§8)
6. **Offline search is the app filtering held rows**, labeled "results in
   downloaded messages". Online search is a separate engine item (a text
   index, which the engine does not have); the local token index waits. (§6)
7. **Asset bytes cache under the owning row's lease**, designed into LLP 1006
   now as §9b and built in lane O4. (§9)
8. **Two retention policies ship:** `until-revoked` (default) and
   `delivered-history`. `purge-on-block` and `all-owned` wait for a brief. (§5)
9. **No store budget in v1.** Measure the store at ten thousand messages and
   record the number. (§14)
10. **Carriers:** IndexedDB on the web, expo-sqlite on Expo, one interface,
    per-principal partition, wipe on sign-out, **no encryption claim** in v1,
    stated plainly. The author expects the Exact 2 arm will also want SQLite,
    through `snapback2-core` directly, and holds that as probable rather than
    ruled while Exact 2 evolves. (§10)
11. **The proof is a physical process kill plus cold start** on the iOS
    simulator and a real browser reload, backend stopped, scripted; scheduled
    rather than in the sixty-second blocking set; the bar is not met until it
    is green. (§10)
12. **A third bar, spec now, build after the loop bar.** The offline bar is
    M5 acceptance 5, M6 acceptance 1 and 2, and the witness; LLP 1012 is the
    implementing spec with codex as implementer; the first lane is the
    evaluator-wiring ticket's prerequisite work; the build runs alongside the
    Expo arm since they share the carrier. (§12)
13. **The trade: observability slides.** LLP 1009 leaves the doing-list for
    now and returns when the offline bar is met. (§13)

## 3. The model on one page, and the program shape

**What the client is.** A result cache: for every `(op, args)` the app ever
ran, the store keeps the server's certified answer — the result, its `seq`,
and its **closure receipt** (LLP 1001 §"Receipts": the rows it holds, the
ranges it covers with their `(site, prefix, lo, hi)`, the absences it proved,
and the rule verdicts it relied on). Rows are stored once per `(table, id)`
and referenced by the ranges that hold them, so two pages that share a row
share it. The store is at **one version**: every change to it is a generation
swap at a server `seq`, never a partial write. It is partitioned per
principal; sign-out wipes the partition.

**What it can and cannot answer.** It can re-show any answer it holds
(lane O2) and re-run any named program whose reads fall inside held ranges
(lane O3). It cannot answer a question the model did not name, and it never
computes a fact the receipt did not cover — a read outside coverage is
`partial` at that site, never invented (LLP 0329.014.004 §7). This is the
security argument of the whole design and it is why there is no replica.

**The program shape for "everything on the phone."** WhatsApp's server keeps a
per-device queue of deliveries and the device drains it. The same shape in
Quarry is a per-viewer delivery log: one table, one write per recipient per
message, one query that pages it by `(recipient, at, id)`. One subscription,
one long range, drains everything the viewer is owed, and the app opens any
chat from held rows. In the `chat` template's dialect (to be verified by
`snapback2 check` in lane O2, and re-checked by the Clique paper exercise for
whether one range covers every messenger screen and whether the fan-out fits
the certificate's write bound):

```q
table deliveries:
  recipient: principal
  conversationId: conversations
  messageId: messages
  kind: enum('message', 'edit', 'delete')
  at: time
  by byRecipientAt: recipient, at, id
  immutable recipient, conversationId, messageId, kind, at
  retain delivered-history
  read <- .recipient = viewer
  insert <- exists memberships[.conversationId, viewer]
  update <- deny
  delete <- deny
```

```q
mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  row = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    insert deliveries { recipient: m.principal, conversationId, messageId: row.id, kind: 'message', at: now }
  return { id: row.id }

query inbox(c: cursor ?):
  page = deliveries[viewer] after c first 200 by byRecipientAt
  return page { ., message: messages[.messageId] }
```

Edits and deletes are further log rows (`kind: 'edit' | 'delete'`), which is
how a phone learns of them without re-reading every page: the log is the
app's revocation channel for message content, and `delivered-history` on
`messages` keeps what was delivered when membership ends. The recipe states
the alternative for small apps — one subscription per conversation — and
when it stops being small. The `chat` template adopts the log in lane O2.

**Multi-device is free.** The server is authoritative and the log is per
recipient, not per device; a second phone resumes from its own watermark.
There is no device-to-device sync and nothing here adds one.

## 4. The range store

One interface, two carriers, one version.

```ts
interface RangeStore {
  open(partition: PrincipalId): Promise<void>        // per-principal; E_OFFLINE_CARRIER if it cannot
  wipe(partition: PrincipalId): Promise<void>        // sign-out, E_AUTH_SESSION terminal
  swap(gen: Generation): Promise<void>                // apply one resume/delivery atomically at a seq
  answer(op, args): Promise<Held | undefined>         // stored result + receipt + seq + deliveredAt
  rows(table, keys[]): Promise<Row[]>                 // lane O3: the twin's read path over held rows
  ranges(table, index, prefix): Promise<HeldRange[]>  // lane O3: coverage for a scan site
  outbox: OutboxStore                                 // §7
  assets: ByteCache                                   // §9, lane O4
}
```

- **Carriers.** `snapback2/react` exports exactly one, IndexedDB.
  `snapback2/expo` exports exactly one, expo-sqlite. The Node test carrier is
  a file store used only by the harness. The no-WASM rule
  (`rules/NOT-DOING.md`) excludes SQLite in the browser; the Exact 2 arm, when
  it starts, most likely runs `snapback2-core` over real SQLite and needs no
  TypeScript carrier at all (author expectation, not ruled).
- **Loud, not silent.** A client constructed with a `store` whose carrier
  cannot open — private browsing that refuses IndexedDB, a missing native
  module — refuses with `E_OFFLINE_CARRIER` and a rewrite naming the carrier
  to install. It never falls back to memory and reports durable. Snapback 1's
  Expo arm did exactly that fallback (`guide/sync/offline-and-retention.md`,
  "expo-sqlite-carrier-pending-qualification") and it read as a retention
  bug for a month.
- **One version.** A swap writes rows, ranges, receipts, and the outbox's
  settled states in one carrier transaction. IndexedDB gives this per
  object-store transaction; SQLite gives it natively. A crash mid-swap leaves
  the previous generation intact, which the kill witness (§10) asserts.
- **Partition and sign-out.** The partition key is the principal id, never
  the bearer. Sign-out and a terminal `E_AUTH_SESSION` wipe it before the
  successor authority becomes observable (LLP 1002 §9's fences already order
  this; the store joins the same serialized custody queue).
- **No encryption claim.** A key the page can read protects nothing against
  code in the page; on iOS the OS already encrypts files at rest. v1 says
  "partitioned per principal, wiped on sign-out" and nothing more. If the
  Expo carrier is to encrypt at rest, that is a dependency choice (SQLCipher
  through op-sqlite) made when the Expo arm starts, not a claim made now.

## 5. Retention, revocation, and the fence

**Per-table policy, one line in Quarry.** `retain until-revoked` is the
default and needs no line. `retain delivered-history` is the only other word
in v1; anything else refuses `E_RETAIN_POLICY` with a rewrite listing the
two. The certificate records the policy per table; the receipt carries it per
range so the client applies it without a second source of truth.

| Policy | On a resume that returns the range in full | On a resume that returns `denied` for the range | On a receipt absence for a held row |
|---|---|---|---|
| `until-revoked` | rows not in the fresh result are evicted | every row the range held is evicted | the row is evicted |
| `delivered-history` | rows not in the fresh result are evicted **only on a receipt absence**; a row merely missing from the result is kept as history | rows are kept as history; the range is marked `denied` and stops resuming | the row is evicted |

The one semantic the engine-core review must check: `delivered-history`
depends on the receipt distinguishing *absent* (no row exists there) from
*hidden* (a row exists the viewer may not see), which LLP 1001 states for
point reads and absences and says range facts do **not** disclose under
non-uniform rules. If a hidden row cannot be told from a deleted one in some
receipt shape, `delivered-history` keeps it — keeping is the policy's whole
point — and the resume marks the range so the next read shows the age.

**Eviction is coverage shrinking and nothing else.** An evicted row leaves
every range that held it; a program whose read falls there is `partial` with
`reason: 'evicted'` (lane O3). There is no ninth state (LLP 0329.014.008 §7's
correction stands).

**Disappearing messages** are the server refusing expired content plus the
client purging on sync: an expired message is an absence on the next resume
of every range that held it, and the delivery log's own `delete` row tells the
app before that. Both are `until-revoked` behaviour; no new mechanism.

**The fence.** `maxOfflineAge` is a client option, `fence: { days: 7 }`,
bounded to 1..30 (`E_OFFLINE_FENCE`). It bounds **trust**: past it, the client
does not predict (lane O3), does not replay the outbox before a resume has
succeeded, and labels every view `stale` with `age`. It never makes a held
row unreadable. The server enforces one hard rule regardless of the client's
number: an intent whose `issuedAt` is older than 30 days is refused
`E_INTENT_EXPIRED`, never applied. The 24 h / 7 d / 30 d question open in LLP
0329.014.004 §5 and §9 since v1.2 is closed by this section.

## 6. Reads offline

**Lane O2 — stored-answer replay.** `useQuery(op, args)` with the backend
unreachable resolves to the held answer: state as delivered (`complete`,
`capped`, `partial`, `denied`), `live: false`, `connection: 'offline'`, and
`stale: { since, age }` computed from the answer's `deliveredAt`. A query the
store has never held is `hydrating` with `connection: 'offline'`, exactly as
today. Cursored pages are held per `(op, args)`, so a chat scrolled online
scrolls offline page by page, and the delivery log's pages are held as they
were drained.

**Lane O3 — local evaluation.** The twin (`snapback2-evaluator`) runs the
certified program over `rows()` and `ranges()`; a read inside coverage is
exact, a read outside is `partial` at that site with `reason: 'never-held' |
'evicted' | 'computed-key'`. A view that combines held ranges — the inbox
page's `messages[.messageId]` point reads over rows held by other ranges — is
exact where every read is covered. The evaluator-wiring ticket's "done when"
list is lane O3's acceptance verbatim: generation-bound certified program on
the wire, receipt custody, successor and auth-generation fences, canonical
hashing, and the five outcome classes proven against the server.

**Search offline.** A search op is a named query; a new term has no held
answer. The recipe: the app replays the delivery log locally and filters in
JavaScript, labeling the result "in downloaded messages". At messenger scale
this is milliseconds. When the engine gains a text index for online search,
LLP 0329.014.008 §6's `held` completeness label is the follow-on; not v1.

## 7. Writes offline

**The outbox.** `useMutation(...).run(args)` with the backend unreachable, or
with the fence's trust intact after a transport failure, appends an intent —
`{ id, op, args, issuedAt, ids[] }` — to the partition's durable outbox and
resolves `last: { state: 'queued', id }`. The intent is written in the same
carrier transaction as any prediction (lane O3), so a crash never leaves a
predicted row without its intent or the reverse. The state machine is:

`queued → committed | rejected | expired`, with `predicted` an orthogonal flag
on `queued` (lane O3) meaning "its local effect is visible in held views".

**Ids.** Mutations that `insert` need ids before the server assigns them, and
a later intent may reference one (create a group, then send to it). On every
successful resume the server allocates the session a **bounded id block**
(`E_ID_BLOCK` if exhausted; the client asks for another when a resume
succeeds). Intents consume from the block; on replay the server applies the
intent with its pinned ids through the hook LLP 1001 §8 already names
("deterministic replay contexts may inject their pinned ids directly"),
refusing an id outside the session's block. The twin consumes the same queue,
so a prediction and its commit mint the same ids.

**Replay.** After a resume succeeds (§8), the client replays the outbox in
FIFO order, one intent per request, waiting for each receipt. `committed` and
`rejected` are the server's receipt and nothing else — a transport failure
mid-replay leaves the intent `queued` and stops the drain, because a 503
after a commit must never look like a rejection (LLP 1002 §9). A rejection
settles that intent only; the drain continues. An intent whose `issuedAt` is
past the fence at replay time is settled `expired` locally without being
sent; the server's 30-day rule is the backstop.

**Conflicts.** The server's OCC over the authoritative trace is the only
rule. Sends are inserts and never conflict. Reactions are idempotent toggles
(the brief requires it) and replay cleanly. An offline edit to a row someone
else edited comes back `rejected` with the ordinary refusal envelope, which
the app shows; the re-read closure and the dependency cascade of LLP
0329.014.008 §2 are not built.

**Prediction (lane O3).** On enqueue the twin runs the mutation over held
rows. If every read is covered, the write's rows enter the store as a
**predicted overlay** — visible to local evaluation, excluded from resume
digests, discarded when the intent settles (replaced by the server's rows on
`committed`, dropped on `rejected` or `expired`). If a read is uncovered the
intent is `queued` without `predicted`, and the app renders it from `args`,
which the React hook exposes as `pending[]`. Without hold sets some sends
will be unpredicted where the membership row is not held; the recipe says to
hold it by shaping the inbox query to include it, which is app code.

## 8. Resume

On every reconnect, and on cold start when the network is present, the client
sends one request:

```
POST /api/resume
{ epoch, held: [{ op, args, seq, digest }], want: 'receipt' }
→ { seq, epoch, idBlock: { from, count },
    ranges: [ { op, args, unchanged: true } | { op, args, ...queryResponse, receipt } ] }
```

The server re-executes every held `(op, args)` in **one read transaction** at
one `seq` — it must, because re-authorization is what revocation means — and
for each returns either `unchanged` when the fresh delivery's digest equals
the client's (the digest the subscription machinery already computes, LLP
1000 "state-aware digests"), or the full query response with its receipt. The
client applies the response as **one generation swap**: rows, ranges,
receipts, evictions per §5, `deliveredAt = now` for unchanged ranges too. Only
then does the outbox drain, and only then do mounted subscriptions reopen.

Cost is one bounded scan per held range on the server and a hash per
unchanged range on the wire; changed ranges cost a page. This is decision 5
as ruled, with the unchanged-range case made cheap. It is **not** LLP
0329.014.008 §3: there are no per-row versions, no tombstone log, no horizon,
and the `_commits` retention question (LLP 1001 author decision 1) is untouched.
The measurement in §14 says whether that candidate is ever needed.

**The receipt on the wire** (lane O1). `POST /api/query` and
`GET /api/subscribe` gain `receipt=1`; when present, every response and
frame carries the closure receipt beside `data`. Clients without a store
never ask and see no change. The receipt is the design's "closure receipt
drives the client" (LLP 0329.014.004 §7) and the custody the evaluator ticket
says the wire lacks; putting it on the wire in lane O1 is what makes lane O2's
store row-per-range rather than an opaque blob per answer.

## 9. Asset bytes on the device

Specified in LLP 1006 §9b (author ruling 2026-09-04) and summarized here. The
asset client caches the bytes it actually fetched — the widths the components
asked for, never originals — keyed `(assetId, width)`, in the partition's
`ByteCache`, **under the owning row's lease**: when a row leaves the store
for any reason in §5 (eviction, absence, `denied` under `until-revoked`,
sign-out) its bytes go in the same swap. Nothing is cached that the receipt
did not deliver a reference to. The fence does not touch bytes, exactly as it
does not touch rows. A total ceiling `maxAssetBytes` (client option, default
256 MB) is enforced LRU by the owning row's recency — the one place v1 has a
budget, because bytes are large and rows are not. Rows whose delivery is not
cacheable — one-use delivery when it lands; anything served under a fenced
audit — refuse the cache at the row, not the byte. Lane O4.

## 10. Carriers qualified, and the proof

The Expo carrier ships **qualified on the iOS simulator**, or it does not
ship: Snapback 1 wrote an expo-sqlite carrier, never qualified it, and shipped
memory instead (§4). The witness, scripted and scheduled:

1. Seed a Clique-sized project; run the web client in a real browser and the
   Expo client on the iOS simulator; drain the delivery log; open three
   chats; view two images.
2. Stop the backend. **Kill the process** (browser tab discarded; simulator
   app terminated), not `close()`.
3. Cold start with the backend still stopped: the inbox, the three chats,
   and the two images render from the store; a message queued before the kill
   is still `queued`; a chat never opened is `hydrating`.
4. Send two messages; both `queued`; start the backend; both `committed` in
   order; the resume evicts a message expired while offline and the app no
   longer finds it in its local search.

It runs on the schedule (`rules/RULES.md`: nothing slower than sixty seconds
blocks a push) and files a bounded ticket when red; the offline bar (§12) is
not met until it is green on a published package.

## 11. What v1 does not do, and what would reopen each

| Candidate (LLP 0329.014.008) | Not in v1 because | Reopens when |
|---|---|---|
| 1. Hold sets, `offline: 'required'` | the recipe holds the membership row by query shape; `partial` sends render from args | a brief's `partial` rate is measured and hurts |
| 2. Dependency-aware outbox | FIFO with independent settlement and pinned ids covers the messenger; the server refuses a dependent honestly | a brief with multi-step offline transactions |
| 3. Delta resume by range version | digest-checked resume (§8) makes unchanged ranges a hash | §14's reconnect bytes for changed ranges exceed what a phone tolerates |
| 4. Bytes under the lease | **taken**, narrowed: fetched widths, one ceiling (§9) | — |
| 5. Per-field `unheld` | no held/unheld join shapes in the messenger | a brief with cross-principal joins offline |
| 6. Local token index | the engine has no text index; app-side filter is honest at scale | online search lands |
| 7. Store budget and priority | messengers keep everything; §14 measures | the measurement or a device quota complaint |
| 8. Cancel queued; `asOf` | unsend-while-offline is an app-level `delete` intent | a brief asks |
| `purge-on-block`, `all-owned` | blocking is out of the brief; `all-owned` is photo-library search | a brief asks |
| `merge` modes, `sequence` | OCC rejections are the messenger's honest answer | collaborative editing |
| Encryption at rest | no honest claim on the web; OS at-rest on iOS | the Expo arm chooses SQLCipher |
| Device-to-device sync | server authority makes multi-device free | never, by design |

## 12. The offline bar, and the lanes

**The offline bar** (the third bar; `rules/NOT-DOING.md`). A fresh agent, with
the installed package and `benchmarks/briefs/social-messenger.md`, has **M5
acceptance 5** (warm-offline search over synced messages), **M6 acceptance 1**
(cold-start offline: history and viewed media render, a view-once photo does
not), and **M6 acceptance 2** (two messages sent offline flush in order and
reach `read`) green on the Expo iOS simulator and React web, plus §10's
process-kill witness, on a **published** package. It starts when the loop bar
is met, and it runs alongside the capability bar's Expo arm, which shares the
carrier.

Implementer for every lane: **codex gpt-5.6-sol (xhigh)** under the standing
roster, orchestrated and landed by Claude. `T` is the day the loop bar is met
on a published package; dates are targets, and a lane that slips returns here.

| Lane | Content | Systems | Target |
|---|---|---|---|
| O1 | `retain` in Quarry, compiler, certificate, receipt; `receipt=1` on query/subscribe; `POST /api/resume` with digests at one seq; session id blocks and pinned-id replay; `E_INTENT_EXPIRED` at 30 d; the `offline` diagnostics family with its page | `packages/compiler`, `snapback2-core`, `snapback2` | T+10 |
| O2 | `RangeStore` + IndexedDB and Node carriers; stored-answer replay; retention and eviction per §5; the outbox, FIFO drain, `queued`/`expired`; client and React states; the delivery-log recipe; the `chat` template adopts it; the browser kill witness | `packages/snapback2` | T+10 (parallel with O1 against a stub) |
| O3 | the twin wired: local evaluation over `rows()`/`ranges()`, prediction overlay, `partial` reasons; the evaluator ticket closed | `packages/evaluator`, `packages/snapback2` | T+17 |
| O4 | `ByteCache` under the row's lease (LLP 1006 §9b); the expo-sqlite carrier qualified on the simulator; the simulator kill witness | `packages/snapback2`, the Expo package | with the Expo arm |

Each lane lands under two-family blind review (LLP 0005), and the spec's
status moves to **Implemented** lane by lane in a record appended here.

## 13. The trade

`rules/RULES.md`: nothing moves onto the doing-list without something coming
off. The author's ruling: **LLP 1009, observability and analytics, slides off
for now** and returns when the offline bar is met. `rules/NOT-DOING.md` is
amended in the same change to name the offline bar, to replace the undefined
"retention v1" line with §11's list, and to record the move. The Exact 2 arm
and the hosted target stay where they were.

## 14. Measurements to record

Each lands as a line in `snapback2/metrics/` with the landing that produces
it, so every deferral in §11 carries a number:

- store bytes, Clique at ten thousand messages across fifty conversations
  (decision 9, candidate 7);
- reconnect bytes and time-to-fresh, fifty conversations after one hour with
  two hundred new messages in five, unchanged ranges versus changed
  (decision 5, candidate 3);
- cold replay time to first inbox paint from the store, web and simulator;
- the twin's gzip size before and after lane O3 (the no-WASM line's number);
- the kill witness's pass, dated, per carrier.

## Non-claims

This spec does not claim offline works until the witness in §10 is green on a
published package. It does not change the wire for clients that do not ask
for receipts. It does not reopen the replica question, the WASM question, or
the one-language ruling. It does not make `partial` go away; it makes it
honest and rare for the messenger shape.

## Open questions (author)

None. The spellings `retain <policy>` (schema), `fence: { days }` and
`maxAssetBytes` (client options), and `POST /api/resume` are proposals the
panel should check for consistency with LLP 1010/1011; none of them changes a
ruling.
