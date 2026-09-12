# Delivery custody: `deliver`

`deliver to T[.keys] as name` derives an engine-owned per-recipient log.

The chat line is `deliver to memberships[.conversationId] as deliveries with
receipts` on `messages`, beside `retain delivered-history`.

The keys pin a target `cap N by` group with a leading enforcement index
(E_DELIVER_UNBOUNDED: declare the cap and index). The target needs one principal
column, or name it with `by .column` (E_DELIVER_PRINCIPAL). `as name` is required
and must be free. One declaration per content table; no authored log or fan-out.
The generated log has recipient, row, incarnation, prefix keys, kind
(delivered/changed/removed), audience, seq and at; indexes byRecipient,
byRecipientGroup and byRow. Every index reads only `.recipient = viewer`;
programs cannot write it, including system programs (E_SCHEMA_DELIVER).
Installing empty, trailing `bootstrap`, destructive removal/retargeting and the
engine-recorded audience bound A: `guide successor`.

Inserts and seeds deliver once per principal in the group at that write.
Changed updates/upserts and deletes append to original recipients, even departed
members. Omitted optionals are null; equivalent writes add nothing;
rollback removes events. E_DELIVER_INCARNATION refuses a deleted id: insert
with required fields and a fresh id. Receipt-only replay derives no events.
Private probes are contained before reading and traced outside receipts.

Reserve: insert N+1, update/delete A, upsert max(N+1,A). User nonuniform
scans cannot spend it. Jobs price owner pages and retained A; specialization may refuse. E_BOUND names the
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
tombstones it. Both survive offline restart. `schedule expireMessage on messages at .expiresAt: delete .` also emits removed events to the original audience, with all clients closed. A thread selects
`deliveries[viewer, conversationId, 'delivered']` by byRecipientGroup, so edits
add no bubble. `messages.history` reads `messages[conversationId] after c last 50 by byConvTime`
under `require isMember(conversationId, viewer)`. New members read prior history
under the content rule without acquiring original-recipient events; delivery
never rewrites audience. The template's `conversationView` composes live content history, count and
preview, so a joiner sees prior messages online. Its shared `withHistory` items
binding falls back to the delivered `thread` under partial offline custody.
An empty log is complete, so it cannot itself activate a partial-only fallback.
Coverage resets, including clock resets, preserve delivered custody. When a
client adopts a different program schema, content images it cannot represent
leave the store; fitting images and delivery anchors stay. History shows the
entry with its body absent under the same missing-row rule; current members
re-read live. Cold preparation still rejects corrupt rows.

A queued insert predicts only the sender's delivered event after successful
`require exists memberships[conversationId, viewer]`, including a proc or
binding. Held audiences prove nothing; membership writes
invalidate the proof. No changed/removed events are predicted. Drain replaces
provisional own-event ids with server identities; local audience/incarnation
are zero and seq/at use the prediction clock until replacement.

## Receipts

`with receipts` adds deliveriesReceipts: one row per original recipient,
initially `received: false`. Every index inherits the content read rule;
body changes refresh copied rule fields. Enabling receipts initializes
false rows from retained delivered events for live bodies, never new members.
Receipt backfill examines at most 8,192 log rows per installation, sharing that
budget with bootstrapped events. E_SUCCESSOR_BOOTSTRAP refuses more work:
remove `with receipts` from the enabling lines and `bootstrap` from new logs.

```q
query receipts(messageId: messages):
  msg = messages[messageId] ! else NOT_FOUND
  require isMember(msg.conversationId, viewer) else MEMBERSHIP_REQUIRED
  return deliveriesReceipts[messageId] first 50 by byRow { recipient, received }
```

The SDK acknowledges durable accepted pages disclosing a delivered/changed
event and its body. Cursors, metadata and dropped responses acknowledge nothing.
`_delivery.deliveries.ack` uses ordinary certified
outbox intents of at most 50 event ids; transport retries preserve their bytes.
Missing/exhausted grants stay visible in outbox readiness/work;
resume retries admission. Owner-rejected/expired acknowledgements retry as fresh
intents under a fresh grant on the next accepted page redelivery. Compacted marks stay only with held log events; evicted events can
acknowledge idempotently again. Account change, logout or seal cancels admission.
Removing `with receipts` drops marks on adoption and logs once; admitted intents
keep replay/dismissal rules.

Acknowledgements price 50 × (N+1) membership candidates, point reads and receipt
updates; one membership page is live.
Unreadable content, missing receipts/originals or departed membership refuse
with a trace. Missing/unreadable submitted events remain no-ops. Departed recipients
stay false; unavailable local authority stays partial. Only acknowledgement
sets true and its first commit seq, independently per principal across devices.
It never renews the fence or removes product writes. Seen/read stays authored.
