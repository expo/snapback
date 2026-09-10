# Delivery custody: `deliver`

`deliver to T[.keys] as name` on a content table derives an engine-owned
per-recipient log. The declaration, the log's shape, receipts, and refusals are
`guide offline` (Custody); installing, bootstrapping, removing, and the audience
bound `A` are `guide successor`. This page is what a write does to the log.

Inserts and seeds deliver to the group at that write, one event per principal.
Changed updates/upserts and deletes append to the original recipients, departed
members included; omitted optionals are null and equivalent writes add nothing;
rollback removes the events. A deleted id cannot be reused
(E_DELIVER_INCARNATION: insert into that table with its required fields and a
fresh id). Receipt-only replay derives no events; private audience probes are
traced outside receipts. Reserve: insert N+1, update/delete A, upsert
max(N+1, A); user nonuniform scans cannot spend it. Named jobs read as owner:
their scans use the structural page reserve and separately price delivery,
including retained A in the plan; specialization can refuse the plan. E_BOUND
names a dominant deliver term; loop-dominated steps keep E_STEPS. A replay or
`then` refused by historical A settles durably.

`deliver` on a maintained content table refuses E_SCHEMA_DELIVER: put the
declaration on its authored source. A maintain can still count the log.

## Reads and prediction

An ascending inbox reads every event kind and the corresponding body:

```q
query inbox(c: cursor ?):
  return deliveries[viewer] after c first 50 by byRecipient { *, message: messages[.row] }
```

Drain it with `{ drain: true }`. `changed` refreshes the shared body and
`removed` tombstones it, including after an offline restart. A thread selects
`deliveries[viewer, conversationId, 'delivered']` by byRecipientGroup, so edits
add no duplicate entry. New members read prior messages under the content
table's live rule; delivery never rewrites the original audience.

A queued insert predicts only the sender's own delivered event when a
successful `require exists memberships[conversationId, viewer]` (including a
proc or binding) proves membership. A declaration or held audience alone
proves nothing. Membership writes invalidate that proof. The twin predicts no
changed or removed events. Provisional own-event ids are replaced by the
drained server identity; local audience/incarnation are provisional zeros and
seq/at use the prediction clock until that replacement.

## Receipts

`with receipts` adds deliveriesReceipts: one row per original recipient,
initially `received: false`. Its table-wide read rule inherits the content
rule on every index; body changes keep its copied rule inputs current.
Enabling receipts later initializes false rows for live bodies from retained
delivered events, without adding current members to the original audience.

```q
query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }
```

With a durable offline store, the SDK acknowledges only validated, accepted
pages disclosing a delivered/changed event and its body. A cursor, metadata,
or a dropped response acknowledges nothing. Pending identities persist with
the page. `_delivery.deliveries.ack` admits at most 50 event ids per ordinary
certified outbox intent; retries keep the same bytes across restarts. Clients
acknowledge independently; the fact is per principal. The reserve is 50 ×
(N+1) private membership candidates plus the ordinary event/content/receipt
reads and receipt updates, with one membership page live at a time.

Only acknowledgement changes false to true, at its commit seq; repeats leave
it unchanged. A removed recipient stays false. Unknown local receipt authority
is partial. Acknowledgement never renews the outbox fence or removes queued
product writes. Seen/read remains an authored product mutation.
