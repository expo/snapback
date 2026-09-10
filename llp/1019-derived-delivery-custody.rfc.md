# LLP 1019: `deliver` — per-recipient custody derived from a declaration, not authored as a table

**Type:** RFC
**Status:** Accepted (author, 2026-09-10: "ok commit those then implement all of the RFCs"; implementer: codex gpt-6-astra lanes under the orchestrator, program directory `~/projects/snapback-ri-20260910`, plan and briefs there; date 2026-09-10; per `rules/RULES.md` it binds lane by lane as each lane's code lands, and the implementation record below names each landing.) Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** the engine's schema, writer, and row-change lifecycle (`snapback2/crates/snapback2-core/src/{schema,successor,timers}.rs`, `engine/{mod,runner_ops,timers}.rs`, `snapback2/crates/snapback2/src/{writer_resume,writer_replay,writer_ledger}.rs`), the certificate (`certificate.rs`, `certificate/page.rs`, `certificate_policy/{fanout,visibility}.rs`), the Quarry front end (`snapback2/packages/compiler/src/quarry/{parser,catalog,bound-schema,bound-project}.ts`), the evaluator twin and range store (`snapback2/packages/evaluator/src/{certificate-identity,runner}.ts`, `snapback2/packages/snapback2/src/{drain,offline,tombstones}.ts`, `store/range-store.ts`), the `chat` template and its seed and tests, the guide (`offline.md`, `migrations.md` for the successor rules, `quarry.md`, `grammar.md`), `guide/families.source.json`
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** 2026-09-10 (revision (d), from the custody-a r2 reviews: the bootstrap bound is summed over every log one installation bootstraps; the audience bound is read loudly and the manifest never publishes `deliver` without it; the D2 handoff on the bound being an estimate; the Summary no longer says `A` refuses a successor; the runtime ceiling is 85,000); 2026-09-10 (revision (c), from the custody-a r1 reviews and the orchestrator's rulings: the audience bound `A` is engine-recorded — `max(target cap, largest stored delivered audience)`, recomputed at every installation, persisted as an engine fact, shown in the manifest, outside the schema hash — so lowering the cap is admitted and `E_SUCCESSOR_AUDIENCE` is deleted; the pinned group is the cap whose `by` equals the prefix and the cap needs its enforcement index at the compiler too; `bootstrap` is a trailing word, bounded to 8,192 events (`E_SUCCESSOR_BOOTSTRAP`), and its incarnation convention is recorded; event identity carries a per-commit ordinal; the raw-schema codes keep their families and page on `check --ir`; §2 lists `audience: int`; §8 lists `to`; `tombstones` stays until D6 with its deletion set recorded; the log materializes before maintains); 2026-09-10 (revision (b): P0 decided — native derived writes at the shared row-change lifecycle; the log's `byRow` index becomes `(row, kind, recipient)` and historical fan-out seeks `(row, 'delivered')`; the raw `Engine::seed` fixture helper is closed for delivered tables; install/bootstrap/remove and twin identity notes from the spike folded into §2, §3, §7); 2026-09-10 (Accepted; implementer and date assigned); 2026-09-09 (revision (a): a blind gpt-6-astra review at maximum reasoning, `llp/reviews/1019-derived-delivery-custody.r1-astra.md`, returned NOT READY with seven blocking findings, all folded: the log is durable custody, not a rebuildable projection; a served cursor is not a receipt, so receipts are opt-in and built from durable client acknowledgements; the historical audience carries its own bound and successor admission; the log's authorization is table-wide and receipts are a separate engine-owned table; edits append `changed` events (LLP 1012 requires them); joiners read prior history from the content table, which the brief requires; three evidence sentences corrected. Both spelling questions and the update question are resolved by the review's rulings)
**Related:** LLP 1012 §3 (the model on one page; the per-recipient log as a program shape; §3's implementation record on current-member fan-out), §5 (retention, revocation, the fence; swap rules 1–4), §"resume" (events for edits and removals; the last tail is live), ruling 2 ("copy the answers, not the mailbox"); LLP 1001 §4 (successors; queued intents across generations) and §"containment"; LLP 1018.003 §3 (`tombstones`) and §5 (the thread projection); LLP 1018.006 (declared partial custody: the thread's fallback); LLP 1017 (cap; the certified fan-out; nonuniform scans and the reserve); LLP 1016 D5 (schedules on the owner's clock); LLP 1011 revision "one spelling" (the word inventory; row reads versus maintain's scalar reads); LLP 1020 §A3 and §"What this does not do" (projection ownership does not cover custody); LLP 1021 (sibling); `issues/20260906-snapback2-no-delivered-ack-primitive-from-the-delivery-log.md`; `benchmarks/briefs/social-messenger.md` M3 (recipient set at send time; full prior history on join; departed members keep history), M5, M6

## Summary

Every private-messaging app on Snapback 2 must hand-write its own custody:
a per-recipient event table with three indexes, a `tombstones` line, a
`retain` word, a fan-out `proc`, and a call to it from every mutation that
writes, edits, deletes, or expires a message. In the chat template that is
27 lines that exist for no product reason and seven call sites that must
not be forgotten — and the template's own fan-out reaches current members
rather than the send-time audience, so a departed member never receives
the tombstone for an unsent body and learns by point absence.

This RFC proposes one schema declaration on the content table:

```q
table messages:
  conversationId: conversations
  ...
  deliver to memberships[.conversationId] as deliveries [with receipts]
  retain delivered-history
```

from which the engine derives **durable per-recipient custody**: an
engine-owned log named by `as` that records, for every content row, its
send-time audience and three kinds of event — `delivered` at commit,
`changed` when the row's content is updated, `removed` when the row is
deleted by a mutation, a job, or a schedule — each to the row's **original
recipients**, not to whoever is a member later. The log is custody, not a
projection: it is never rebuilt from current membership, its audience
bound is engine-recorded and never refuses a successor, and removing the
declaration is a destructive plan. With `with receipts`, the first-party
SDK acknowledges delivery events it has durably accepted, through ordinary
certified writes, and `received` becomes a readable fact in an engine-owned
receipts table under a table-wide rule. A new member reads prior history
from the content table under its live rule, the way the brief requires,
through a declared fallback the SDK already has.

The app's `deliveries` table, `proc deliver`, every `deliver(...)` call, and
the `tombstones` declaration are deleted. The twin changes only where it
must predict the sender's own event. LLP 1012's security argument is kept
whole: the client never computes a fact a receipt did not cover; the engine
computes one more engine-owned table, under a fixed rule, from a
declaration.

## Evidence

- **Custody is authored by ruling, and the ruling's reasons were about the
  client.** LLP 1012 ruling 2: "Copy the answers, not the mailbox. The
  result cache stays; no replica. 'Every message on the phone' is the
  per-recipient delivery-log program shape, published as a recipe and
  adopted by the `chat` template." §3: "one immutable table, one row per
  recipient per event … Delete, expiry, and edit are further log rows: the
  log is the app's revocation channel." The "no replica" argument (§3,
  lines 153–156) is that the *client* "never computes a fact the receipt
  did not cover". Nothing in it requires the *app* to author the log; it
  requires the log to be a program the receipt covers.
- **The template pays for it.** `templates/chat/snapback/schema.q:80-94`
  (the `deliveries` table), `:71` (`retain delivered-history`),
  `access.q:7-9` (`proc deliver`), `messages.q:4` (the import) and seven
  `deliver(...)` calls (`messages.q:35,44,50,56,62,71,76`): 27 lines, plus
  five that read the log and would change shape.
- **The fan-out reaches the wrong audience, and that is now a template
  choice.** LLP 1012 §3's implementation record (lines 253–264) says
  tombstone and edit rows "reach the conversation's *current* members, not
  every original recipient", and attributes it to two language limits of
  the time. One of them is gone: the uniformity analysis now proves an
  `or` true when any arm is decided true
  (`certificate_policy/visibility.rs:65-67`, recorded at LLP 1012 line
  251). The other — no list from a range — stands
  (`issues/20260904-quarry-no-list-from-range.md`). The engine, which
  writes every delivery, knows the send-time audience exactly.
- **`retain` and `tombstones` do nothing on the server beyond identity.**
  `schema.rs:129-165` carries `RetentionPolicy` and `Tombstone`; retention
  reaches the certificate (`certificate.rs:754`) and the manifest
  (`writer_ledger.rs:350`); the behavior is the twin's swap rules 3 and 4
  (`range-store.ts:1194-1206`, `tombstones.ts:38-53`). The server records
  nothing per recipient: the resume path takes the *client's* watermark and
  serves the tail (`writer_resume.rs:32-38`, `:269-330`); a replay "low
  watermark" (`writer_replay.rs:55`) is about intents, not delivery.
- **The brief's semantics.** `social-messenger.md` M3 (lines 500–510):
  receipts go `sent → delivered (fetched by the recipient's client) →
  read`; "the recipient set is membership at send time, and members who
  leave or are removed before reaching a state drop out of the aggregate
  requirement"; "New members see the group's full prior history on join";
  "Removed members immediately stop receiving new messages but keep their
  local copy of history from before removal." M5 acceptance 1 and M6
  acceptance 1–2 are the expiry and offline cases.
- **Edits must be events.** LLP 1012 (line 559): "the application log must
  append events for edits and removals. The last tail is live, not every
  historical page." The client's drain subscribes to the final tail only
  (`drain.ts:184`); an old row edited while its thread is unmounted is
  refreshed by nothing else. The template emits `'edit'` today
  (`messages.q:71`).
- **The receipt the product needs exists at the wrong layer — and a
  served cursor is not it.** Both Clique builders wrote receipts as app
  rows; "under Playwright's offline toggle the recipient's client never
  sent its delivered ack, so the choreography stalled" (the ticket of
  2026-09-06). Serving a response does not establish that the client
  received it: a dropped response, a 51-event commit paged at 50, or a
  metadata-only read all leave rows the server "served" and the recipient
  never held. Cursors are unsigned positions, not proofs of traversal (LLP
  1011 line 167).
- **There is no delete hook.** The only `after` form is `after insert <-
  exists …`, an assertion (`parser.ts:273-280`). Expiry today is
  `schedule expireMessage on messages at .expiresAt: purgeMessage(.id)`;
  `purgeMessage` is a mutation that exists only to fan out `'expired'` and
  delete (`messages.q:74-81`) — schedule targets are excluded from the
  client API (`quarry/bound-project.ts:79`), so it is app plumbing, not a
  public operation.
- **The drain is by shape, not by table.** `certificate/page.rs:105-150`
  admits any ascending, `take ≤ 50`, one-cursor page as a resumable log;
  `drain.ts:24-38` follows it to its watermark. A derived table with that
  shape needs no client change.

## Design

### 1. The declaration

```
deliver to <table>[<prefix keys>] [by .<principal column>] as <name> [with receipts]
```

is a table-block line on the **content** table. It names a range on a
**target** table whose rows carry the recipients:

- The prefix keys are expressions over the content row (`.conversationId`),
  as in a rule; they must pin a group of the target table that carries a
  `cap N by <those columns>` (LLP 1017 §2.1): the cap whose `by` tuple
  **equals** the prefix column names, never the first cap of the same
  arity (two caps of one arity may share a stored type, and the wrong one
  would bind an unrelated `N`). The cap must have its enforcement index —
  an index led by those columns — and the compiler checks it before the
  engine does. Without the cap the declaration refuses `E_DELIVER_UNBOUNDED`
  (family `bound`, site the `deliver` line, rewrite `cap 50 by
  conversationId`, page `offline`); without the index, the same code with
  the index line to declare.
- The target table must have exactly one `principal` column, or the
  declaration names it with `by .principal`; otherwise `E_DELIVER_PRINCIPAL`
  (family `schema`, same site, rewrite naming the columns, page `offline`).
- `as <name>` is required and names an engine-owned **row table** in the
  existing schema namespace (`quarry/catalog.ts:7`); a collision refuses at
  the declaration with `E_QUARRY_UNKNOWN` and a rename rewrite, the
  existing duplicate-name path (`catalog.ts:23`). The table keeps ordinary
  row-valued point and range reads; it does not inherit maintain's scalar
  reads or projection-rebuild semantics. One content table carries at most
  one `deliver`.
- `with receipts` opts into §6. Without it the declaration creates no
  receipt state and no acknowledgement traffic.

The raw-schema form (the compiler's IR) admits the same declaration under
the same refusals, and refuses a generated table that is not the engine's
exact shape, an authored look-alike, or a program that writes one, as
`E_SCHEMA_DELIVER` (family `schema`, page `offline`). On `check --ir` each
of these keeps its own code, family, page, and the declaration's site
(`schema.tables.<content>.deliver`); none is folded into `E_SCHEMA`.

### 2. The custody log

The engine owns a table named by `as`, with the shape:

```
table deliveries:                       -- engine-owned; not authorable
  recipient: principal
  row: messages                         -- reference to the content table
  incarnation: int                      -- the content row's commit seq at insert (§3)
  <the prefix key columns, copied>      -- conversationId: conversations
  kind: enum('delivered', 'changed', 'removed')
  audience: int                         -- the send-time audience count (§3, §4)
  seq: int                              -- the commit that wrote this event
  at: time
  by byRecipient: recipient, seq, id
  by byRecipientGroup: recipient, <prefix keys>, kind, seq, id
  by byRow: row, kind, recipient      -- historical fan-out seeks (row, 'delivered'); an all-kind scan is unbounded by A
  immutable *
  read <- .recipient = viewer
  insert <- deny / update <- deny / delete <- deny
```

The rule is **table-wide**: a recipient reads only their own events, on
every index. `byRow` exists for the engine's own fan-out on delete and
change (§3) and for the receipts table (§6); it grants no reader anything
the table rule does not. The log is in the schema, the manifest, and the
certificate; `data` and `why` see it; a program reads it like any table.

It is **custody, not a projection**. The maintain rebuild's safety argument
(LLP 1001 §4, LLP 1020 §A3) does not transfer: current membership cannot
reconstruct a send-time audience, and a deleted content row cannot
reconstruct its history at all. So:

- Adding `deliver` to a table with rows installs an **empty** log unless
  the line also says `bootstrap` (a trailing word; it acts once, when the
  log is installed, and is inert afterwards), which writes one `delivered`
  event per current target row per existing content row, deduplicated by
  principal, inside the installation transaction, and is recorded in the
  successor log as an approximation of send-time audiences. It is bounded
  per installation: the sum of `cap × content rows` over every log the
  installation bootstraps may not exceed 8,192 events (the successor's
  128-row batch × 64); above it the successor refuses
  `E_SUCCESSOR_BOOTSTRAP` (family `successor`, site the first such
  declaration, page `migrations` — the wire label is `successor/migrations`,
  family/page) naming the total and each log's share, and the rewrite is
  every such line without the word — no program may write the log, so no
  job can be pasted; the priced installation path is LLP 1020 Part B's.
- Removing `deliver` is a **destructive plan** (`Drop::Table` of the log);
  changing its target or prefix keys is destructive too. Custodial data is
  never silently dropped.
- The log's audience bound `A` (§4) is an engine fact recomputed at every
  installation; it is never spelled and never refuses a successor.

### 3. What writes it

Every write is engine-owned, inside the content write's transaction, at
the shared row-change lifecycle (`engine/runner_ops.rs:165`) so that no
content-write path — mutation, job, schedule, seed, upsert, offline
replay — can omit it:

- **Insert** of a content row: one `delivered` event per target row in the
  pinned group **at commit time**, deduplicated by principal. A target row
  inserted in the same transaction counts if it is visible at the content
  row's write; the audience is fixed at that instant and recorded as the
  row's `audience` count. This is "membership at send time".
- **Update** that changes the content row: one `changed` event to every
  principal holding a `delivered` event for `(row, incarnation)`, read
  through `byRow`, in the same transaction. Repeated updates append
  repeated events. Product metadata such as `editedAt` stays authored; no
  changed-column list is introduced.
- **Delete** — by a mutation, a job, or a schedule — one `removed` event to
  every such principal. A departed recipient gets the tombstone. The
  `removed` event **is** the tombstone: the log's schema carries the
  equivalent of `tombstones messages[.row] if .kind = 'removed'`, scoped
  to `(row, incarnation)`, so the twin's swap rule 3 applies with no
  declaration and an old tombstone can never evict a recreated body.
- **Upsert** with an existing id follows the update path; **id reuse**
  after a delete on a delivered table is refused (`E_DELIVER_INCARNATION`,
  family `rule`, the write site) so tombstone targets stay unique — the
  `incarnation` column is the engine's record, not a program input.
- **Seeds** deliver like inserts. **Rollback** of the enclosing transaction
  rolls the events back with it; there is no partial delivery.
- **Bootstrapped events** carry `incarnation` = the installation's commit
  seq, not the content row's original one: the store keeps no per-row
  insert seq (`_commits.writes` is a per-table count, pruned past 10,000
  commits), so the log is a row's incarnation of record. D2 reads a live
  row's incarnation from its `delivered` events through `byRow`, never from
  a separate per-row record, and bootstrapped and live rows agree by
  construction.
- **Event identity** is `digest(row, recipient, kind, seq, ordinal)`, where
  `ordinal` counts the events one commit writes, so repeated `changed`
  events for one row in one commit are distinct rows (§7).
- **The bootstrap bound is an estimate, not a post-write count** (handoff
  to D2). `E_SUCCESSOR_BOOTSTRAP` refuses on `Σ cap × content rows`,
  computed before any event is written; nothing counts the events actually
  inserted, and the estimate is conservative only while every group's
  membership is within its cap. `Engine::seed` is an uncapped membership
  path until D2 closes it, so D2 must not treat the bound as a ceiling on
  rows written, must continue the per-commit `ordinal` inside a content
  commit rather than assume bootstrap's counter, and must not treat this
  transactional bootstrap as LLP 1020 Part B's priced job.

`schedule expireMessage on messages at .expiresAt: delete .` is admitted
by lowering it ahead of time to a private mutation target with the
schedule's existing admission, settlement, and rejection reporting
(`timers.rs:175`, `engine/timers.rs:153`); the one-line spelling is sugar
over that target, not a new runtime path.

### 4. Certification

- **Insert** sites into a delivered table reserve `N+1` examined rows,
  index entries, and write rows per call (the bounded overflow probe),
  where `N` is the target group's cap — LLP 1017 §2.4's reservation, applied once more for the log
  — and the nonuniform-scan protection of the fan-out reserve
  (`certificate_policy/fanout.rs:93`) applies unchanged.
- **Update and delete** sites reserve against the log's **audience bound**
  `A`: an engine-recorded number, never spelled in the schema and never the
  live cap. `A = max(target cap, largest stored delivered audience)`,
  recomputed at every installation (successor, migration, open), persisted
  in the store beside the installed schema, disclosed in the manifest as
  `deliver.audience`, and reported in the successor log. A membership cap
  lowered from 50 to 2 is an ordinary successor; the historical audiences
  keep `A` at 50 until every 50-audience row is gone, and the next
  installation follows the cap. `A` is outside the schema hash, so the
  certificate binds the compiler's schema and the twin agrees; D2 prices
  update and delete sites against `A` as the engine holds it; upserts
  reserve `max(N+1, A)`. Every
  generated read and write site is priced on every meter the
  certificate has; a `schedule` that deletes prices per fired row; the
  runtime's containment (`runner_ops.rs:1230`) guards the full reserve.
- A mutation whose reservations exceed a ceiling refuses `E_BOUND` with the
  sourced product naming the `deliver` line as the term.

### 5. Reads

```q
query inbox(c: cursor ?):
  return deliveries[viewer] after c first 50 by byRecipient { *, message: messages[.row] }

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return deliveries[viewer, conversationId, 'delivered'] after c last 50 by byRecipientGroup { *, message: messages[.row] }

query history(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return messages[conversationId] after c last 50 by byConvTime
```

`inbox` names its index because two recipient-prefixed indexes match, and
it drains every event kind (`useQuery(api.messages.inbox, {}, { drain:
true })`); `changed` and `removed` events refresh or evict the shared body
through the row's identity without creating thread entries. `thread` is
the certified thread projection (LLP 1018.003 §5), pinned to `delivered`
so a thread holds one event per live message; it is descending and not a
resumable log, which it need not be. `history` is the **joiner's** read:
the content table under its live membership rule, the way the brief
requires ("full prior history on join"), bounded and online; it is the
declared fallback of LLP 1018.006 behind `thread`, so a new member's
screen reads history through the same items binding and custody begins
with their first delivered event. Nothing rewrites send-time recipients.
`conversationView` composes as today.

### 6. Receipts (`with receipts`)

Serving a response or accepting a cursor acknowledges nothing. With
`with receipts`:

- The first-party SDK **acknowledges** delivery-event identities only
  after it has validated and durably accepted a page that disclosed the
  corresponding content row; acknowledgements are persisted with the
  accepted page and sent as ordinary certified, traced writes to an
  engine-owned mutation, in bounded idempotent batches, retried across
  restarts. Two clients of one principal acknowledge independently; the
  fact is per principal.
- The engine owns a second table, `<name>Receipts` (`row`, `recipient`,
  `received: bool`, `seq`), written only by that mutation, with a
  **table-wide** read rule inherited from the **content** table's read rule
  (a reader who may read the message may read who received it). Recipients
  who were removed before acknowledging stay `received: false`, and the
  brief's aggregate rule ("drop out of the aggregate requirement") is the
  app's `count` over current members, which it can express.
- `received: false` means unacknowledged; missing local authority on
  receipt-only replay remains `partial`, never a fabricated false.

```q
query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require isMember(msg.conversationId, viewer) else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }
```

`read` (seen) stays a product mutation; it is a human act, not a transport
fact.

### 7. The twin

The evaluator's certificate identity must admit `Table.deliver` and the
engine-owned tables (`certificate-identity.ts:113` rejects unknown
fields today): the declaration and ownership metadata are canonicalized in
Rust field order (`target, prefix, principal, log, receipts, bootstrap`;
`audience` is not a descriptor field and is refused if spelled) and hashed,
never stripped to make prediction work. The
prediction uses `runner.ts`'s narrow direct derived-write route (the one
maintains use), never a scan of a possibly incomplete held membership set.
The declaration alone does not imply the sender is in its target range, so
the own-event prediction is emitted only under a proved sender-membership
contract (the chat template's `require isMember` supplies it); otherwise
no event is predicted. Repeated edits in one commit need distinct event
identities; the provisional own-event identity is reconciled with the
server's commit `seq` on drain. The twin **predicts** only the sender's own `delivered`
event for a locally queued insert (it holds the sender's principal; it
does not hold the audience), and predicts no `changed` or `removed` events;
every other event arrives by drain. Receipt acknowledgements are ordinary
queued writes with the outbox's fence and replay rules (LLP 1012 §5, §7);
they never authorize replay early and never erase queued writes.

### 8. What is deleted

- The template's `deliveries` table, `proc deliver`, its import, all seven
  calls, `purgeMessage`, and the `'edit'`/`'expired'` kinds; the template's
  authored delivery seed rows (`seed.ts:26`) and the tests that assert
  `messageId`/`expired` are rewritten to the equivalent behavior.
- The `tombstones` declaration leaves the grammar at D6's template cutover:
  its only use is the authored log, and until D2's writes exist the shipped
  template's offline eviction rides on it (the D1/D3 landing kept it; the
  deletion set is under §Mechanism). The word inventory (LLP 1011 revision
  "one spelling", B5) loses `tombstones` and gains six words — `deliver`,
  `to`, `as`, `with`, `receipts`, `bootstrap`; the `rules/NOT-DOING.md`
  § Moves line records the trade with its offset.
- LLP 1012 §3's "current members, not every original recipient" record is
  superseded by §3 above and marked so.

The chat backend loses about 30 lines and one whole concept; the complete
local runtime is measured against its 90,000-byte ceiling (the author's
ruling of 2026-09-10, LLP 1012 §"Bytes — frozen allocation") after §7 lands (deleting template lines
saves nothing there).

## Mechanism — decided by P0 (2026-09-10)

Lane P0 built both representations on one content table and measured them
(`REPORT-proto.md` on branch `s2/ri-proto`, spike code under
`snapback2-core/src/engine/delivery_spike*.rs` and `delivery_aot_spike.rs`,
not landed). **Decision: native derived writes at the shared row-change
lifecycle (`Runner::finish_row_change`, reached from `runner_ops.rs` insert
mode, upsert, and delete), with the declaration and the generated tables
compiled ahead of time.** Confidence 90 in the representation. Reasons:

- The native hook reaches product seeds (`Runtime::seed` → certified
  upserts), conditional inserts, upserts, job chunks, schedule targets, and
  authoritative offline replay without expanding each program; the AOT
  spike's expansion admission was a test harness, and `seed_program` is
  synthesized in Rust after the TS compiler, so a compiler-only expansion
  misses it.
- Pricing: the native insert certifies at 4 examined / 4 index entries for a
  cap-3 fixture; the AOT expansion paid 14 (ordinary lookahead plus an N×N
  probe over a "trusted cap view" that is not sound production metadata).
- Neither needs a trigger language; the invariant "custody cannot be
  omitted by any write path" is the hook's, and the existing containment
  rejects a certificate from which the delivery write site was removed and
  rolls the content row back with it.

Two corrections the spike forced on this RFC, both applied above: the log's
`byRow` index is `(row, kind, recipient)` and delete/change fan-out seeks
`(row, 'delivered')`, because the RFC's `(row, recipient)` would have made
the historical scan include unbounded `changed` events that the audience
bound `A` cannot bound; and the raw fixture helper `Engine::seed`
(`engine/mod.rs:340`, `INSERT OR REPLACE` plus reindex) bypasses the
lifecycle and produced zero events in the spike — D2 routes it through the
certified seed path for delivered tables or removes its production
availability, and the RFC no longer claims "every writer" until it does.
Native reserves `N + 1` per insert (a bounded overflow probe), as §4 specifies.

Successor notes from the spike, binding on D1: the log is an ordinary
durable table in the schema, **not** in `Schema.maintains`, so `plan()`
sees its addition and nothing populates it unless `bootstrap` is declared;
`bootstrap` is bounded at Σ cap × row count ≤ 8,192 events per installation,
summed over every log it bootstraps, inside the installation transaction
until LLP 1020 Part B prices it; `Drop::Table`
behavior is preserved for removal even when the history is nonempty and
every content body is gone; retarget or prefix changes force the same
destructive decision even when shapes happen to match; the audience bound
`A` persists independently of the target's current cap as an engine fact,
and the scan for the largest stored audience runs only when the cap falls
below the recorded bound (every stored audience is under it otherwise);
canonical schema shape and insertion authority for the generated tables are
enforced for raw IR and the system principal, since `insert <- deny` alone
does not stop the system principal.

`tombstones` stays in the grammar until D6 (P0 finding 6; the D1/D3 landing
record). D6's deletion set: `parser.ts` (`parseTombstones` and its branch),
`ast.ts` (`TombstoneDecl`, `TableDecl.tombstones`), `bound-schema.ts`
(`bindTombstones`, `validateTombstonePredicate`), the `tombstones: []` on
synthetic declarations in `catalog.ts`, `quarry/index.ts`, and
`bound-schema-checks.ts`, `quarry/diagnostics.ts` (`tombstone`),
`diagnostics.ts` and `ir.ts` (`E_QUARRY_TOMBSTONE`), `tombstone-checks.ts`,
the `families.source.json` row, `retain.md`, the `expiry.md` and
`schedule.md` sentences, the inventory pin, the template line
(`templates/chat/snapback/schema.q`) and `fixtures/quarry-chat/snapback/schema.q`.
The IR field `Table.tombstones` and `tombstone_issues` stay: they are the
engine's representation of the generated log's tombstone (§3).

## What this does not do

- No per-device delivery: `recipient` is a principal. Devices are below
  the wire.
- No `seen`/`read` receipts, no typing, no presence: those are mutations
  and channels.
- No cross-table delivery (`deliver` names one target range), no delivery
  of maintains or channels, no delivery to a computed list, no configurable
  changed-column triggers.
- No back-fill of custody on join: a joiner reads history live (§5) and
  holds offline only what was delivered to them.
- No change to the twin's swap rules, the fence, or `retain`'s meaning.

## Acceptance

1. The chat template compiles with the `deliveries` table, `proc deliver`,
   `purgeMessage`, and `tombstones` deleted; `snapback2 test` passes the
   equivalent thirty checks with revised assertions; `api.d.ts` names
   `messages.inbox`, `thread`, `history`, `conversationView`, `receipts`.
2. The offline-bar journeys pass on the derived log: a never-opened chat
   renders offline from the drained log; an offline send is predicted into
   it (the sender's own event); unsend removes the body offline and
   survives a cold restart; an expiring message is purged by the owner's
   schedule with every client closed.
3. **Historical custody through evolution**: send to Alice and Bob; remove
   Bob; add Carol; lower the membership cap (admitted); change the
   declaration (refused as destructive); then unsend and expire old
   messages — Alice
   and Bob receive `removed` events by tombstone (not point absence), Carol
   reads prior history through `history` without becoming an original
   recipient, Bob keeps every other pre-removal body under `retain
   delivered-history`, and the audience bound `A` stays at the old cap
   until no stored audience needs it.
4. **Old edits outside the live tail**: drain several pages, leave the
   thread unmounted, disconnect, edit an early message, reconnect only the
   drain, restart offline, open the thread — the body and `editedAt` are
   current, search finds the new text, no duplicate bubble.
5. **Receipt truth** (with `with receipts`): 51 events in one commit paged
   at 50, a dropped response, a metadata-only read, an arbitrary cursor,
   two clients of one principal, acknowledgement retry across a restart —
   an unfetched body is never `received: true`; unavailable authority stays
   `partial`.
6. **Containment and the fence**: engine/twin corpus cases at the audience
   bound, mixed nonuniform scans, id reuse refused, job and schedule
   rollback, a queued intent across a successor; acknowledgements neither
   authorize replay early nor erase queued writes.
7. Successor cases: `deliver` added with and without `bootstrap`, removed
   (plan), retargeted (plan), `A` raised; the successor log lines.
8. Loop and runtime budgets measured after §7 (`measure --check`, the
   85,000-byte runtime ceiling).

## Implementation (proposed lanes; sizes are the orchestrator's estimate)

| lane | scope | size |
|---|---|---|
| P0 | the mechanism prototype (§Mechanism): one content table, insert and delete fan-out on both representations, the twin's identity check | small–medium |
| D1 | schema: `Deliver` on `Table`, the log's and receipts table's shapes and identities, manifest, audience bound, successor admission (install empty / `bootstrap`, destructive removal) | medium–large |
| D2 | writes at the row-change lifecycle: insert/change/delete fan-out, incarnation, id-reuse refusal, `schedule … delete .` lowering, certificate pricing on every meter | large |
| D3 | compiler: the `deliver … as … with receipts` line, `E_DELIVER_*` families with sites/rewrites/page, raw-schema admission, delete `tombstones`, inventory amendment | medium |
| D4 | twin: identity, the sender's own predicted event, drain of `changed`/`removed`, receipts as queued writes | medium |
| D5 | receipts: the SDK acknowledgement protocol, the engine-owned mutation and table, invalidation | medium |
| D6 | template (`inbox`/`thread`/`history`/`receipts`, seeds, tests), guide within budget, LLP 1012 §3 supersession, NOT-DOING move | small–medium |

P0 first; D1–D3 land together; D4 with them or immediately after; D5 and
D6 follow. Two blind reviews per lane under LLP 1002's loop.

**Sequencing** (from the r1 reviews, adopted): after the five-lane program
lands, publish, run the reduced loop bar and the Clique cold rerun; land
LLP 1020 Part A's certificate-soundness and enum work first; commission
this RFC on the cold rerun's evidence, with §3's historical-custody
semantics settled before any code, and never as a prerequisite for that
evidence.

## Open questions (author) — resolved

1. *Should `received` be always on, or opt-in?* **Resolved 2026-09-09 (r1
   review, confidence 94):** opt-in with `with receipts`, implemented by
   durable client acknowledgements through certified writes; a served
   watermark is not a receipt (§6).
2. *`as <name>` or an implicit `messages.delivered`?* **Resolved
   2026-09-09 (r1 review, confidence 97):** `as <name>` is required; the
   log is an ordinary row table in the existing namespace, with ordinary
   row reads, never maintain's scalar reads or rebuild semantics (§1, §2).
3. *Should an update emit an event?* **Resolved 2026-09-09 (r1 review,
   confidence 99):** yes — mandatory `changed` events to the original
   recipients, because the drain subscribes only to the tail and LLP 1012
   requires edit events; edit metadata stays authored; no changed-column
   trigger syntax (§3).

## Implementation record

- 2026-09-10 — commissioned; lanes and landings are appended here as each lands (the orchestrator, program `~/projects/snapback-ri-20260910/plan.md`).
- 2026-09-10 — P0 (lane `proto`, Claude-orchestrated codex spike on `s2/ri-proto`, not landed): native derived writes chosen; `byRow` index and `Engine::seed` corrections applied in revision (b).
- 2026-09-10 — D1 + D3 (lane `custody-a`, branch `s2/ri-custody`): `Table.deliver` (`snapback2-core/src/delivery.rs`: descriptor, canonical log and receipts shapes, raw-schema admission `E_DELIVER_UNBOUNDED`/`E_DELIVER_PRINCIPAL`/`E_SCHEMA_DELIVER`, static refusal of any program write to a generated table), successor custody (`successor/delivery.rs`: install empty, `bootstrap` once at installation, forced `Drop::Table` on removal/retarget, `E_SUCCESSOR_AUDIENCE` — `A` lowers only when no stored `delivered` audience exceeds it; replaced in r1 by the engine-recorded bound), manifest `deliver`, the Quarry line (`quarry/deliver.ts` materializes the generated tables ahead of the catalog; parser/binder/`api.d.ts`), the twin canonicalizes `deliver`; word inventory +6 (`deliver`, `to`, `as`, `with`, `receipts`, `bootstrap`), NOT-DOING move; tests: `tests/delivery.rs` (11), `delivery-checks.ts` (4), corpus 275→277 (`deliver-log-schema-identity`, `deliver-owned-write-refused`). §1–§2, §6 shape, §7 identity. Not done here, by finding (P0 §6): `tombstones` stays in the grammar until D6's template cutover; §2's log shape must list `audience: int`; the inventory also needs `to`; `E_SCHEMA_DELIVER`/`E_SUCCESSOR_AUDIENCE` are new codes. Report: `REPORT-custody-a.md`.
- 2026-09-10 — D1 + D3 fix round r1 (lane `custody-a`, branch `s2/ri-custody`, from the grok/muse blind reviews): the pinned group is the cap whose `by` equals the prefix (`delivery.rs::group_cap`, `quarry/deliver.ts`), the compiler requires the enforcement index; `A` is engine-recorded (`successor/delivery.rs::record_audience_bounds`, `_meta` `custody_audience:<log>`, `SuccessorReport.audience_bounds`, manifest `deliver.audience`; `Deliver.audience` and `E_SUCCESSOR_AUDIENCE` deleted); raw-schema codes keep their families and page on `check --ir` (`RuntimeError::SchemaDeliver`, `certification_family_guide`); deliveries materialize before maintains; `bootstrap` bounded (`E_SUCCESSOR_BOOTSTRAP`, 8,192 events) with the incarnation convention above; per-commit event ordinal in `event_row`; manifest emission tested. Tests: `tests/delivery.rs` (14), `check.rs` (`deliver_refusals_keep_their_codes_families_and_pages_on_the_ir_path`), `writer_ledger.rs` (`manifest_discloses_deliver_with_the_engine_recorded_audience_bound`), `delivery-checks.ts` (6), the evaluator identity golden; corpus regenerated (277). Revision (c) of this RFC. Report: `reports/final-custody-a.md` § Fix round r1.
- 2026-09-10 — D1 + D3 fix round r2 (lane `custody-a`, branch `s2/ri-custody`, from the r2 grok/muse blind reviews and the host measure): the complete local runtime paid its bytes by construction in `certificate-identity.ts` (the descriptor through `pick` inline, sibling bespoke reconstructions through the same walker, a dead `COLUMN_FIELDS` entry deleted) — 85,087 → 84,996 gzip against the 85,000 ceiling, `main` at the base measuring 84,994; `audience_bound` is loud on an unreadable record (`E_STORE_VERSION`) and the manifest refuses rather than publishing `deliver` without `A` (`writer_ledger.rs::manifest_table`); the `check --ir` fallback carries a `SchemaDeliver`'s code, family, page, rewrite, and site when the certify row is not located; the bootstrap bound is summed over every log one installation bootstraps (`bootstrap_refusal`); `E_SUCCESSOR_BOOTSTRAP`'s family and page agreement (wire `successor/migrations`, card `migrations`) pinned by test; §Summary, §2, §3 (D2 handoff), §Mechanism, §8 revised. Tests: `tests/delivery.rs` (16: `bootstrap_bound_is_summed_over_every_log_one_installation_bootstraps`, `audience_bound_is_loud_when_its_record_is_unreadable`), `check.rs` (`an_unlocated_deliver_refusal_keeps_its_labels_on_the_ir_path`; the located test gains the `E_DELIVER_PRINCIPAL` case), `protocol.rs` (`successor_bootstrap_has_one_family_and_page_on_the_wire_and_in_the_guide`), `writer_ledger.rs` (`manifest_refuses_a_custody_log_whose_audience_bound_is_unreadable_or_unrecorded`). Report: `reports/final-custody-a.md` § Fix round r2.
- 2026-09-10 — D2 (lane `custody-b`, working tree `s2/ri-custody-b`, ready for orchestrator commit): §3 native insert/changed/removed writes at `finish_row_change`, original audience/incarnation, commit ordinals, transactional rollback, certified fixture seeds and incarnation refusal; §4 N+1 insert reserve and engine-recorded A specialization with full containment; private `schedule …: delete .` lowering; §7 receipt-only skip preserved. Tests: 18 delivery integration additions, 2 core lifecycle units, 1 wire unit, 3 compiler additions; targeted lifecycle/cap/job/timer run 91 passed/1 ignored plus final named proof 5 passed; compiler 9 passed; corpus 277→288 (261 evaluator cases passed, 27 server-only); guide checks passed; complete runtime 84,996 gzip (+0). Scope, exact commands, RFC corrections, and inherited caps violation: `REPORT-custody-b.md`. RFC Status unchanged.
- 2026-09-10 — D2 fix round r1 (lane `custody-b`, merged base `5434af50be`, pending orchestrator commit): §3 optional-row normalization, pre-scan private containment/traces, durable replay/then specialization refusals, table-specific incarnation repair through direct/seed/replay/job/timer envelopes; §4 dominant-meter diagnostics, N+1/max(N+1,A) pricing text, raw chunk reserve protection; §7 receipt exclusion preserved; one statement-site spelling. Tests: affected delivery/cap/timer/job suites 104 passed/1 skipped; custody/certificate units 35 passed; real refusal wire 1 passed; frozen corpus 288 (261 evaluator/27 server-only), compiler 299 passed; runtime 84,946/85,000 gzip at this HEAD. Reports: `REPORT-custody-b.md`, writable `reports/final-custody-b.md` § Fix round r1; external canonical report and newer-main fetch blocked by filesystem sandbox. RFC Status unchanged.
