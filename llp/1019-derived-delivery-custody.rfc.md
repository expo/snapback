# LLP 1019: `deliver` — per-recipient custody derived from a declaration, not authored as a table

**Type:** RFC
**Status:** Accepted (author, 2026-09-10: "ok commit those then implement all of the RFCs"; implementer: codex gpt-6-astra lanes under the orchestrator, program directory `~/projects/snapback-ri-20260910`, plan and briefs there; date 2026-09-10; per `rules/RULES.md` it binds lane by lane as each lane's code lands, and the implementation record below names each landing.) Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** the engine's schema, writer, and row-change lifecycle (`snapback2/crates/snapback2-core/src/{schema,successor,timers}.rs`, `engine/{mod,runner_ops,timers}.rs`, `snapback2/crates/snapback2/src/{writer_resume,writer_replay,writer_ledger}.rs`), the certificate (`certificate.rs`, `certificate/page.rs`, `certificate_policy/{fanout,visibility}.rs`), the Quarry front end (`snapback2/packages/compiler/src/quarry/{parser,catalog,bound-schema,bound-project}.ts`), the evaluator twin and range store (`snapback2/packages/evaluator/src/{certificate-identity,runner}.ts`, `snapback2/packages/snapback2/src/{drain,offline,tombstones}.ts`, `store/range-store.ts`), the `chat` template and its seed and tests, the guide (`offline.md`, `quarry.md`, `grammar.md`), `guide/families.source.json`
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** 2026-09-10 (Accepted; implementer and date assigned); 2026-09-09 (revision (a): a blind gpt-6-astra review at maximum reasoning, `llp/reviews/1019-derived-delivery-custody.r1-astra.md`, returned NOT READY with seven blocking findings, all folded: the log is durable custody, not a rebuildable projection; a served cursor is not a receipt, so receipts are opt-in and built from durable client acknowledgements; the historical audience carries its own bound and successor admission; the log's authorization is table-wide and receipts are a separate engine-owned table; edits append `changed` events (LLP 1012 requires them); joiners read prior history from the content table, which the brief requires; three evidence sentences corrected. Both spelling questions and the update question are resolved by the review's rulings)
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
projection: it is never rebuilt from current membership, it carries its
own audience bound with its own successor admission, and removing the
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
  `cap N by <those columns>` (LLP 1017 §2.1). Without the cap the
  declaration refuses `E_DELIVER_UNBOUNDED` (family `bound`, site the
  `deliver` line, rewrite "declare `cap N by conversationId` on
  memberships", page `offline`).
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
the same refusals.

### 2. The custody log

The engine owns a table named by `as`, with the shape:

```
table deliveries:                       -- engine-owned; not authorable
  recipient: principal
  row: messages                         -- reference to the content table
  incarnation: int                      -- the content row's commit seq at insert (§3)
  <the prefix key columns, copied>      -- conversationId: conversations
  kind: enum('delivered', 'changed', 'removed')
  seq: int                              -- the commit that wrote this event
  at: time
  by byRecipient: recipient, seq, id
  by byRecipientGroup: recipient, <prefix keys>, kind, seq, id
  by byRow: row, recipient
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
  the successor also says `bootstrap from current members`, which writes
  one `delivered` event per current target row per existing content row,
  bounded by the audience cap times the row count, is recorded in the
  successor log as an approximation of send-time audiences, and is priced
  under the installation budget LLP 1020 Part B defines (until then, it is
  a job the refusal pastes).
- Removing `deliver` is a **destructive plan** (`Drop::Table` of the log);
  changing its target or prefix keys is destructive too. Custodial data is
  never silently dropped.
- The log's audience bound (§4) is a successor-admitted number that may
  only rise while any stored audience exceeds the new value.

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

`schedule expireMessage on messages at .expiresAt: delete .` is admitted
by lowering it ahead of time to a private mutation target with the
schedule's existing admission, settlement, and rejection reporting
(`timers.rs:175`, `engine/timers.rs:153`); the one-line spelling is sugar
over that target, not a new runtime path.

### 4. Certification

- **Insert** sites into a delivered table reserve `N` examined rows, `N`
  index entries, and `N` write rows per call, where `N` is the target
  group's cap — LLP 1017 §2.4's reservation, applied once more for the log
  — and the nonuniform-scan protection of the fan-out reserve
  (`certificate_policy/fanout.rs:93`) applies unchanged.
- **Update and delete** sites reserve against the log's **audience bound**
  `A`, a per-log number in the schema that starts at the target group's
  cap when `deliver` is installed and may only be raised by a successor
  while any stored audience exceeds the new value (§2). A membership cap
  lowered from 50 to 2 does not shrink the historical audiences; `A`
  stays 50 until no stored audience needs it, and the successor log says
  so. Every generated read and write site is priced on every meter the
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
fields today). The twin **predicts** only the sender's own `delivered`
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
- The `tombstones` declaration leaves the grammar: its only use was the
  authored log. The word inventory (LLP 1011 revision "one spelling", B5)
  loses `tombstones` and gains `deliver`, `as`, `with`, `receipts`,
  `bootstrap`; the `rules/NOT-DOING.md` § Moves line records the trade
  with its offset.
- LLP 1012 §3's "current members, not every original recipient" record is
  superseded by §3 above and marked so.

The chat backend loses about 30 lines and one whole concept; the complete
local runtime is measured against its 84,000-byte ceiling after §7 lands
(deleting template lines saves nothing there).

## Mechanism (to be settled by a prototype before D1)

Two implementations satisfy this design; the r1 review preferred the
first:

1. **Ahead-of-time expansion.** The compiler expands `deliver` into
   ordinary private tables and certified IR, and admission enforces the
   generated writes at every content-write path (mutations, jobs,
   schedules, seeds, replay), so the twin gets executable writes rather
   than a second implicit mutation system.
2. **Native derived writes.** The engine writes the log at the shared
   row-change lifecycle (`runner_ops.rs:165`), like maintain writes.

Either way the invariant is the same — custody cannot be omitted by any
write path — and the prototype's job is to show which representation
keeps the twin honest with the least new machinery. Neither needs a
general trigger language.

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
   Bob; add Carol; lower the membership cap; change the declaration
   (refused as destructive); then unsend and expire old messages — Alice
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
   84,000-byte runtime ceiling).

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

- 2026-09-10 — P0 decision branch (not a landing): Mechanism/§3 insert-delete/§7 spikes compare AOT IR and native lifecycle writes; native recommended; 11 Rust witnesses and 3 twin experiments; report `REPORT-proto.md` records the byRow bound correction, raw-seed closure, and verification limits.
