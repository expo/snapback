# LLP 1019: `deliver` — per-recipient custody derived from a declaration, not authored as a table

**Type:** RFC
**Status:** Draft — proposal, binds nothing (`rules/RULES.md`: only implemented specs bind; implementer and date unassigned, the author's call). Written on the author's request of 2026-09-09 ("write up 3 LLPs or sub-LLPs to address 1 and 2 and 3") after the elegance assessment of 2026-09-08.
**Systems:** the engine's schema and writer (`snapback2/crates/snapback2-core/src/schema.rs`, `engine/`, `timers.rs`, `writer_resume.rs`), the certificate (`certificate.rs`, `certificate/page.rs`, `fanout.rs`), the Quarry front end (`packages/compiler/src/quarry/{parser,bound-schema}.ts`), the twin (`packages/snapback2/src/{offline,tombstones}.ts`, `store/range-store.ts`), the `chat` template, the guide (`offline.md`, `quarry.md`, `grammar.md`), `guide/families.source.json`
**Author:** Claude (Fable 5.1), for the author
**Date:** 2026-09-09
**Revised:** —
**Related:** LLP 1012 §3 (the model on one page: the per-recipient delivery log as a program shape), §5 (retention, revocation, the fence), ruling 2 ("copy the answers, not the mailbox"); LLP 1018.003 §3 (`tombstones`) and §5 (the certified thread projection); LLP 1017 (cap and the certified fan-out); LLP 1016 D5 (schedules on the owner's clock); LLP 1011 revision "one spelling" (the word inventory); `issues/20260906-snapback2-no-delivered-ack-primitive-from-the-delivery-log.md`; `issues/20260904-quarry-uniformity-does-not-hoist-prefix-pinned-or.md`; `benchmarks/briefs/social-messenger.md` M3, M5, M6

## Summary

Every private-messaging app on Snapback 2 must hand-write its own custody:
a per-recipient event table with three indexes, a `tombstones` line, a
`retain` word, a fan-out `proc`, and a call to it from every mutation that
writes, edits, deletes, or expires a message. In the chat template that is
27 lines that exist for no product reason, seven call sites that must not
be forgotten, and one known hole — a departed member never receives the
tombstone for an unsent body and learns by point absence instead, because
the language could not express the fan-out any other way.

This RFC proposes one schema declaration on the content table:

```q
table messages:
  conversationId: conversations
  ...
  deliver to memberships[.conversationId] as deliveries
  retain delivered-history
```

from which the engine derives the per-recipient log (`deliveries`, an
engine-owned table like a maintain target), writes one `delivered` event per
recipient at commit, writes one `removed` event to every recipient who was
delivered when the row is deleted by a mutation, a job, or a schedule, and
maintains per-recipient drain watermarks so `received` is a readable fact.
The fan-out is certified by the target group's `cap` exactly as LLP 1017
certifies a mutation's `for`. The app's `deliveries` table, `proc deliver`,
every `deliver(...)` call, and the `tombstones` declaration are deleted.
The client changes nothing: the derived log has the resumable-log shape the
twin already drains.

LLP 1012's security argument is kept whole: the client still never computes
a fact a receipt did not cover; the engine computes one more engine-owned
table, under a fixed rule, from a declaration.

## Evidence

- **Custody is authored by ruling, and the ruling's reasons were about the
  client.** LLP 1012 ruling 2: "Copy the answers, not the mailbox. The
  result cache stays; no replica. 'Every message on the phone' is the
  per-recipient delivery-log program shape, published as a recipe and
  adopted by the `chat` template." §3: "one immutable table, one row per
  recipient per event, two indexes … Delete, expiry, and edit are further
  log rows: the log is the app's revocation channel, and the mutation that
  removes a body writes the rows in the same commit." The argument for "no
  replica" (§3, lines 153–156) is that the *client* "never computes a fact
  the receipt did not cover". Nothing in it requires the *app* to author
  the log; it requires the log to be a program the receipt covers.
- **The template pays for it.** `templates/chat/snapback/schema.q:80-94`
  (the `deliveries` table), `:71` (`retain delivered-history`),
  `access.q:7-9` (`proc deliver`), `messages.q:4` (the import) and seven
  `deliver(...)` calls (`messages.q:35,44,50,56,62,71,76`): 27 lines, plus
  five that read the log and would change shape.
- **The fan-out has a hole the language forced.** LLP 1012 §3
  implementation record (lines 253–264): "Tombstone and edit rows reach the
  conversation's *current* members, not every original recipient. Two
  private spellings were tried and refused by the language as it exists
  (the uniformity analysis collects every field in both arms of an `or`
  (`E_STRUCTURAL_COUNT`), and a `recipients` list on the message row cannot
  be built because Quarry has no way to make a list from a range read) …
  A departed member's copy of an unsent body is therefore evicted by §5 rule
  1, the point absence its inbox page records when that page next
  revalidates, not by a tombstone." The engine, which writes every
  delivery, knows the delivered set exactly.
- **`retain` does nothing on the server.** `schema.rs:129-153` carries
  `RetentionPolicy { UntilRevoked, DeliveredHistory }`; its only consumer is
  `certificate.rs:754`, into the manifest; the behavior is the twin's swap
  rule 4 (`range-store.ts:1194-1206`). `tombstones` is likewise a schema
  field evaluated by the twin (`tombstones.ts:38-53`, `offline.ts:822-825`).
  The server records nothing per recipient: `git grep watermark` over both
  crates hits only `writer_resume.rs`, where the *client* sends its
  watermark and the server serves the tail (`:32-38`, `:269-274`,
  `:296-330`).
- **The receipt the product needs exists at the wrong layer.** The ticket
  of 2026-09-06: both Clique builders wrote delivered/read receipts as app
  rows; "under Playwright's offline toggle the recipient's client never
  sent its delivered ack, so the choreography stalled". Its premise that
  the engine "already tracks per-recipient delivery" is wrong today (see
  above) — which is the point: the fact should exist, and it should exist
  in the engine.
- **The brief's semantics are exactly a delivery set at commit time.**
  `social-messenger.md` M3 (lines 500–510): receipts go `sent → delivered
  (fetched by the recipient's client) → read`; "the recipient set is
  membership at send time"; "Removed members immediately stop receiving
  new messages but keep their local copy of history from before removal."
  M5 acceptance 1 and M6 acceptance 1–2 are the expiry and offline cases.
- **There is no delete hook.** The only `after` form is `after insert <-
  exists …`, an assertion (`parser.ts:273-280`). Expiry today is
  `schedule expireMessage on messages at .expiresAt: purgeMessage(.id)`,
  and `purgeMessage` is a public mutation whose only job is to fan out
  `'expired'` and delete (`messages.q:74-81`).
- **The drain is by shape, not by table.** `certificate/page.rs:105-150`
  admits any ascending, `take ≤ 50`, one-cursor page as a resumable log;
  `drain.ts:24-38` follows it to its watermark. A derived table with that
  shape needs no client change.

## Design

### 1. The declaration

```
deliver to <table>[<prefix keys>] [by .<principal column>] as <name>
```

is a table-block line on the content table (the table whose rows are
delivered). It names a range on a **target** table whose rows carry the
recipients:

- The prefix keys are expressions over the content row (`.conversationId`),
  as in a rule; they must pin a group of the target table that carries a
  `cap N by <those columns>` (LLP 1017 §2.1). Without the cap the
  declaration refuses `E_DELIVER_UNBOUNDED` ("`deliver to memberships[.conversationId]`
  fans out over an unbounded group; declare `cap N by conversationId` on
  memberships").
- The target table must have exactly one `principal` column, or the
  declaration names it with `by .principal`; otherwise `E_DELIVER_PRINCIPAL`.
- `as <name>` names the derived log. The name is a table name in the
  schema's namespace (a collision is `E_SCHEMA_DUPLICATE`, the existing
  code). One content table may carry at most one `deliver`.

### 2. The derived log

The engine owns a table named by `as`, with the shape:

```
table deliveries:                       -- engine-owned; not authorable
  recipient: principal
  row: messages                         -- reference to the content table
  <the prefix key columns, copied>      -- conversationId: conversations
  kind: enum('delivered', 'removed')
  seq: int                              -- the commit that wrote this event
  at: time
  by byRecipient: recipient, seq, id
  by byRecipientGroup: recipient, <prefix keys>, seq, id
  by byRow: row, recipient
  immutable *
  read <- .recipient = viewer
  insert <- deny / update <- deny / delete <- deny
```

It is a maintained target in every mechanical sense that already exists:
it is in the schema and the manifest, its identity is in the certificate,
successors rebuild it transactionally when the declaration changes (LLP
1001 §4's maintain rule), `data` and `why` see it, and a program reads it
like any table. `byRow` is readable under the **content** table's read rule
(a member who may read the message may read who it was delivered to); the
other two indexes are readable only by their recipient.

### 3. What writes it

- **Insert** of a content row: for each target row in the pinned group at
  commit time, one `delivered` event. This is "membership at send time".
- **Delete** of a content row — by a mutation, a job, or a schedule — one
  `removed` event to every recipient that holds a `delivered` event for
  that row (read through `byRow`), not to the group's current members. A
  departed recipient gets the tombstone. The `removed` event is the
  tombstone: the engine's schema carries the equivalent of `tombstones
  messages[.row] if .kind = 'removed'` for the derived log, so the twin's
  swap rule 3 (LLP 1012 §5) applies with no declaration.
- **Update**: no event. Edits change the row in place and the held row
  updates through its identity (LLP 1018.003 §5, "an edit changes the
  message row in place, so no edit event is needed for display").
- **Successor**: when `deliver` is added to a table with rows, the log is
  built from the current group membership for every existing row (the
  transactional rebuild); when it is removed, the log is dropped as an
  engine-owned target. Neither is a destructive plan (LLP 1020 §2).

The writes are engine-owned like maintain writes (LLP 1001: "engine-owned
seed/closed maintained writes"); no program can insert into the log.

### 4. Certification

The fan-out is priced where the cap is: every insert site into a delivered
table reserves `N` examined rows, `N` index entries, and `N` write rows per
call, where `N` is the target group's cap — the same reservation LLP 1017
§2.4 makes for a capped insert, applied once more for the log. A delete
site reserves the same against `byRow`. A mutation whose reservations exceed
a ceiling refuses `E_BOUND` with the sourced product, naming the `deliver`
line as the term. A `schedule` that deletes prices the same way per fired
row. The write-rows ceiling (2,048) bounds a bulk delete job exactly as it
bounds any sweep.

### 5. Reads

The log is read with the ordinary range forms, and the two the template
needs have the resumable-log shape:

```q
query inbox(c: cursor ?):
  return deliveries[viewer] after c first 50 { *, message: messages[.row] }

query thread(conversationId: conversations, c: cursor ?):
  require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
  return deliveries[viewer, conversationId] after c last 50 { *, message: messages[.row] }
```

`inbox` is the drain (`useQuery(api.messages.inbox, {}, { drain: true })`,
unchanged); `thread` is the certified thread projection of LLP 1018.003 §5
(one event per live message; a deleted body is a null nested read the
screen drops). `conversationView` composes exactly as today.

### 6. Receipts

When the writer serves a resume for a drain of a derived log (the path in
`writer_resume.rs` that already computes the delivery watermark), it
records `(recipient, log, seq)` in an engine-owned watermark row — one row
per recipient per log, overwritten monotonically. The log gains a derived
column `received: bool` = `watermark(recipient) ≥ seq`, readable through
`byRow`:

```q
query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require isMember(msg.conversationId, viewer) else MEMBERSHIP_REQUIRED
  return deliveries[messageId] first 50 by byRow { recipient, received }
```

That is the brief's `sent → delivered` transition without an app table and
without a client ack that can be dropped offline: the fact is the
recipient's own drain reaching the row. `read` (seen) stays a product
mutation; it is a human act, not a transport fact. The watermark row is
under the resume path's existing authorization; it is written on a read
path, once per resume, and is the one place this RFC lets a read write.

### 7. What is deleted

- The template's `deliveries` table, `proc deliver`, its import, all seven
  calls, `purgeMessage`, and the `'edit'`/`'expired'` kinds. The schedule
  becomes `schedule expireMessage on messages at .expiresAt: delete .`,
  which needs `delete` admitted as a schedule body (today a schedule names
  a mutation; the one-line form is a small parser change and the natural
  spelling once nothing else needs to run).
- The `tombstones` declaration leaves the grammar: its only use was the
  authored log. The word inventory (LLP 1011 revision "one spelling", B5)
  loses `tombstones` and gains `deliver` and `as`; the `rules/NOT-DOING.md`
  § Moves line records the trade.
- LLP 1012 §3's "current members, not every original recipient" record is
  superseded by §3 above and marked so.

The chat backend loses about 30 lines and one whole concept.

## What this does not do

- No back-fill on join: a member added after a message was delivered does
  not receive it. (A product that wants it writes a mutation that inserts
  into the content table; the engine delivers. The brief does not ask.)
- No per-device delivery: `recipient` is a principal. Devices are below the
  wire.
- No `seen`/`read` receipts, no typing, no presence: those are mutations
  and channels.
- No cross-table delivery (`deliver` names one target range), no delivery
  of maintains or channels, no delivery to a computed list.
- No change to the twin's swap rules, the fence, or `retain`'s meaning. The
  departed-member case simply gets the tombstone it was owed.

## Acceptance

1. The chat template compiles with the `deliveries` table, `proc deliver`,
   `purgeMessage`, and `tombstones` deleted; `snapback2 test` passes the
   same 30 checks; `api.d.ts` still names `messages.inbox`, `thread`,
   `conversationView` with unchanged result types (`message` nested,
   nullable).
2. The offline-bar journeys pass on the derived log: a never-opened chat
   renders offline from the drained log; an offline send is predicted into
   it; unsend removes the body offline and survives a cold restart; an
   expiring message is purged by the owner's schedule with every client
   closed.
3. New journey: a member is removed, then a message they had received is
   unsent; the departed member's twin evicts the body by tombstone (swap
   rule 3), not by point absence, and keeps every other pre-removal body
   under `retain delivered-history`.
4. New journey: the receipts query flips `received` for a recipient only
   after that recipient's drain resumes past the row, including from an
   offline start.
5. Corpus cases: insert fan-out, delete fan-out to a departed recipient,
   the successor that adds and removes `deliver`, and the `E_DELIVER_*`
   refusals, with engine and twin agreeing.
6. `check --cost` (LLP 1020 §6) shows the `deliver` term on every write
   site of a delivered table.

## Implementation (proposed lanes; sizes are the orchestrator's estimate)

| lane | scope | size |
|---|---|---|
| D1 | schema: `Deliver` on `Table`, the derived log's shape and identity, manifest, successor rebuild | medium |
| D2 | writer: insert/delete fan-out inside the commit; schedule `delete .`; certificate pricing | medium–large |
| D3 | compiler: the `deliver … as` line, `E_DELIVER_*`, `byRow` rule inheritance, delete `tombstones` | medium |
| D4 | receipts: the watermark row on the resume path, `received` | medium |
| D5 | template, guide (`offline.md`, `quarry.md`, `grammar.md` within budget), families, LLP 1012 §3 supersession, NOT-DOING move | small |

D1–D3 land together (the schema without the writes is nothing); D4 and D5
follow. Two blind reviews per lane under LLP 1002's loop.

## Open questions (author)

1. Should `received` be always on, or opt-in (`deliver … with receipts`)?
   Proposed: always on — the watermark row is one row per recipient per
   log, and a product that does not want to show receipts does not read
   them. Delivery visibility is membership information the reader already
   holds.
2. Is `as <name>` the right spelling, or should the log be addressed as
   `messages.delivered` without a name? Proposed: `as`, so the log has an
   ordinary table name in `api.d.ts`, `data`, and `why`, and so two content
   tables in one app can each name theirs.
3. Should an **update** to a delivered row emit an event when a declared
   column changes (a badge for "edited")? LLP 1018.003 §5 says display
   needs none; proposed: no, until a brief asks.
