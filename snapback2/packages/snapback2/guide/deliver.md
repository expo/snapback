# Delivery custody: `deliver`

`deliver to T[.keys] as name` on a content table derives an engine-owned
per-recipient log. Shape/rules: `guide offline`; installation and audience A:
`guide successor`.

Inserts and seeds deliver once per principal in the group at that write.
Changed updates/upserts and deletes append to original recipients, even departed
members. Omitted optionals are null; equivalent writes add nothing;
rollback removes events. E_DELIVER_INCARNATION refuses a deleted id: insert
with required fields and a fresh id. Receipt-only replay derives no events.
Private probes are contained before reading and traced outside receipts.

Reserve: insert N+1, update/delete A, upsert max(N+1,A). User nonuniform
scans cannot spend it. Named jobs use owner structural pages and separately
price delivery with retained A; specialization may refuse. E_BOUND names the
dominant deliver term; loop-dominated steps keep E_STEPS. Historical-A replay
and `then` refusals settle durably. Receipt upserts price two maintained
applications per row, including final probes, derivation and timers.

E_SCHEMA_DELIVER refuses `deliver` on a maintain: declare it on the authored
source. Maintains can count logs and receipts.

## Reads and prediction

```q
query inbox(c: cursor ?):
  return deliveries[viewer] after c first 50 by byRecipient { *, message: messages[.row] }
```

Drain every kind with `{ drain: true }`. `changed` refreshes the shared body,
with authored `editedAt` and held search outside the live tail; `removed`
tombstones it. Both survive offline restart. A thread selects
`deliveries[viewer, conversationId, 'delivered']` by byRecipientGroup, so edits
add no bubble. New members read history under the content rule; delivery never
rewrites the original audience.

A queued insert predicts only the sender's delivered event after successful
`require exists memberships[conversationId, viewer]`, including a proc or
binding. Held audiences prove nothing; membership writes
invalidate the proof. No changed/removed events are predicted. Drain replaces
provisional own-event ids with server identities; local audience/incarnation
are zero and seq/at use the prediction clock until replacement.

## Receipts

`with receipts` adds deliveriesReceipts: one row per original recipient,
initially `received: false`. Every index inherits the content read rule;
body changes refresh its copied rule fields. Enabling receipts initializes
false rows from retained delivered events for live bodies, never new members.
Receipt backfill examines at most 8,192 log rows per installation, sharing that
budget with bootstrapped events. E_SUCCESSOR_BOOTSTRAP refuses more work:
remove `with receipts` from the enabling lines and `bootstrap` from new logs.

```q
query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require exists memberships[msg.conversationId, viewer] else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }
```

The SDK acknowledges durable accepted pages disclosing a delivered/changed
event and its body. Cursors, metadata and dropped responses acknowledge nothing.
`_delivery.deliveries.ack` uses ordinary certified
outbox intents of at most 50 event ids; transport retries preserve their bytes.
Missing/exhausted grants remain visible in outbox readiness and remaining work;
resume retries admission. Owner-rejected/expired acknowledgements retry as fresh
intents under a fresh grant on the next accepted page redelivery. Successful
marks survive compaction.

The acknowledgement reserve is 50 × (N+1) membership candidates plus ordinary
point reads and receipt updates, with one membership page live at a time.
Missing original events or failed probes refuse with a trace. Departed recipients
stay false; unavailable local authority stays partial. Only acknowledgement
sets true and its first commit seq, independently per principal across devices.
It never renews the fence or removes product writes. Seen/read stays authored.
