//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Writes

Mutations insert, update and delete rows in one transaction.
Rules and constraints apply before that transaction commits.

```quarry
mutation writeForms(roomId: rooms, messageId: messages, postId: posts, body: text <=4000):
  a = insert messages { roomId, authorId: viewer, body, at: now }                   -- the row; the id is minted unless given (`id: new`, or one you hold)
  b = insert reactions { postId, principal: viewer, direction: 1 } if absent        -- the row, or null on a unique clash
  update messages[messageId] { body, editedAt: now }                                -- by id: NOT_FOUND when the row is missing
  update messages[a] { editedAt: now } if .editedAt = null                          -- a row as the key; `if` makes it conditional: E_CONFLICT with the current row when false
  upsert reactions[postId, viewer] { direction: -1 }                                -- insert or patch; the key names the row
  delete reactions[postId = postId, principal = viewer]                             -- a full unique key, positional or named
  return { a: a.id, b }
```

`insert` creates a row; `if absent` returns null on a readable key collision.
`update` patches one row; its `if` condition tests the old row.
`upsert` inserts or patches, and `delete` removes the named row.
Any refusal rolls back the entire mutation.
Keep one minted write id with each intent when retrying.

## Limits

- Hidden targets do not disclose refusal details: NOT_FOUND.
- A conditional update can conflict: E_CONFLICT.
- A write target must name its unique key without extra tests: E_QUARRY_WRITE_TESTS.
- Reusing a known id for changed intent is refused: E_WRITE_ID_REUSE.

## Details

Mutations insert, update and delete rows in one transaction.
Rules and constraints apply before that transaction commits.

If `messageId` in `writeForms` addresses retained history from a room the
writer has left, the call still predicts. Reads hide the updated message
because current membership is absent, while readable inserts remain visible.
Unknown reaction authority also hides that provisional reaction.
See `guide prediction` for authorization on each device read.

Writes that do not predict show pending with `usePendingWrite(op)` from
`snapback4/react`: `run(args)` submits, `pending` covers submission through
terminal `sent` or `failed`, and `last` is the Write. Keep its mutation id in
view state; `usePendingWrite(op, savedId)` resumes observation after reload
without submitting again. `client.write(id)` reads the kept outcome (undefined
for an unknown id or an evicted id that has left the outbox); `onWrite` reports
later terminal changes. The ordinary in-memory history retains at most 256 terminal outcomes.
Failed receipt saves retain known summaries separately until persistence or close. The local client reads the device's one atomic window of the last
256 server terminal receipts and its current outbox directly, so another native
owner's settlement cannot leave a stale pending outcome. Reads and repeated
flushes do not refresh the window. Queued terminal writes emit at most once
per client: their event ids stay remembered until the outbox entry leaves.
Local receipts survive reopen. Before deleting an adopted web tab's store,
its terminal receipts enter a shared server/viewer window bounded to 256 in
recovery order. Existing shared ids keep their outcome and position. Openers
and `client.write(id)` read it alongside the device's own 256 receipts;
reads neither copy nor refresh it, so another tab's adoption cannot hide a
receipt from a reload. Outbox ownership stays exclusive: a held Web Lock is
never taken; a queued background lock request wakes recovery when its owner
releases it, and closing cancels the wait. Unidentified journals wait for a
matching open or sync signal. Persistence failures get at most three retries,
after 1, 2 and 4 seconds; later opens or sync signals can try again. Receipt
lookups do not create the shared window before adoption. Storage clearing or eviction
from both windows can make an id unknown. Recovered success carries `replayed: true`
and no result; recovered failure keeps code/family and `write refused: CODE`.
Refusals before durable admission, the raw online tier and mock remember ordinary
outcomes for their client lifetime only, up to 256 terminal outcomes.
Close completes after local work without waiting for the network. A mutation or
action keeps a response received before close completes; otherwise its caller
receives pending with its id. Late responses are consumed and discarded.
`createApp` and device mutation intent recover on reopen; raw online callers
retain their retry id, and action callers collect the same server action id.

`useAcquisition()` reports `{ acquired, rows, tables }` as snapshot pages commit.
Keep the UI usable through server fallback while it prepares offline access.
`client.acquired` and `useAcquired()` report completed snapshot and catch-up
for the current store, stay true offline, and reset with invalidated acquisition.
The online tier has no partition and reports false. In an opener, use
`if (client.link() === "online") await client.sync()` before exposing a screen
that needs immediate offline predictions; skip the wait on an offline cold start.
If sync loses the link or the partition is refused, acquisition can remain false.
Network fetch failures resolve `sync()` without a value and set the link offline;
return the open client. Close and rethrow only unexpected opener exceptions.
A Write queued without a row before acquisition carries
`reason: "queued without a row: not acquired yet"`; other missing local evidence
says `queued without a row: local data does not justify prediction`.
Predicted rows carry pending; a pending Write has no predicted result.

On the web, admission waits for the IndexedDB commit; pagehide or becoming
hidden sends only the oldest unconfirmed write with keepalive, including a retry
of that same head if an ordinary send is in flight when the page exits.
A blocked or oversized head is never skipped; clients share
the browser's 64 KiB body budget. Unsent/unconfirmed writes stay durable for retry on reopen with
the same mutation id, so replay cannot apply a write twice.
If an exit response has not finished after one second, ordinary flushing
retries that same durable head before advancing; an unknown outcome never
skips a write. `close()` stops waiting immediately without cancelling the
keepalive request.
An admission that finishes while the page is suspended rechecks the exit
transport after its commit; on reopen, a matching server store identity and
non-regressed head allow unknown writes to replay before the first sync finishes.
With an exclusive persistence claim, the web device records the mutation id, operation,
arguments and minted row ids synchronously in localStorage, in call order,
before `mutate` returns its promise. Same-origin navigation can therefore leave before IndexedDB admission
commits: the next client admits those records before new writes, then sends
through the ordinary outbox with the original ids. A closed tab's records are
adopted by the next device that opens the store, under the outbox's exclusive claim.
Adoption runs with that device's first sync, so a receipt from a closed tab
answers `client.write(id)` once that sync completes, not at the moment it opens.
Recovery and new admissions take submission numbers from the same device counter;
already-queued writes precede recovered orphan records. A matching orphan waiting
for backend adoption installs the destination's authenticated backend first. An
orphan missing its kept backend or store identity is skipped with its journal
intact until a later matching open can establish ownership; a broken orphan does
not prevent healthy stores from opening.
Recovered records stay bound to their original backend store identity; a
replacement retires them without sending them to the new backend.

The journal allows at most 32 records and 256 KiB of UTF-8 keys and values per
device store, and 64 KiB per record. A browser call that cannot synchronously
keep its intent refuses `E_ADMISSION` with a site and rewrite: no new intent
is accepted. Its promise is already fulfilled with `failed`, and exposes
`state`, `id` and `why` in the calling stack. Missing restored identity,
unknown backend identity, unavailable/full storage, an exhausted journal, or
an app without a durable web device therefore cannot silently lose a click.
Use `webDevice()` and `localStorageSessionStore()`, wait for readiness or repair
storage, then retry the original id. Browser storage clearing after admission
can still erase the journal.

A destination must open
a client to recover a record that never reached the outbox; keepalive remains
best-effort and sends only admitted writes. Built-in IndexedDB requires Web
Locks and refuses opening without them. Custom persistence must provide an
exclusive claim and discoverable alternate stores; see the client reference.
Recovered executable records keep successful predictions, but local refusals
queue for the server to decide, so stale rows cannot permanently cancel them.
For programmatic navigation, `await client.mutate(...)` before navigating
is the strongest durable boundary; handle a `failed` outcome before leaving.
`pending` means IndexedDB admission is durable and the server outcome still
needs confirmation. A write-specific admission refusal returns the ordinary failed
outcome and removes its journal record, replaces it with a non-executable
cancellation, or acknowledges it in IndexedDB. If both stores reject cancellation,
the recovery outcome is indeterminate: the executable record can survive and a
later recovery can admit it if the authored condition changes. The returned
refusal alone does not guarantee preserved cancellation in that case.
A device write-target miss that cannot prove the insert conditions above
queues without a predicted row and still sends `/m`.

## A constraint across rows you cannot read

An `exists` or `count` check sees only rows its viewer may read. It cannot
prevent a clash with another guest's private booking. E_STRUCTURAL_FANOUT
refuses a mutation domain whose read rule is not decided by its scope.
Use one row per occupied night and let `unique` enforce the constraint for
every writer. Insert the booking and its nights in the same mutation:

```quarry
table listings:
  host: principal
  public
table bookings:
  listing: listings
  guest: principal
  host: principal
  firstDay: int
  lastDay: int
  read <- .guest = viewer or .host = viewer
  insert <- .guest = viewer
table nights:
  listing: listings
  day: int
  booking: bookings
  unique listing, day else TAKEN
  public 'occupied dates and booking references are public; guest details stay private'
  insert <- created bookings[id = .booking, listing = .listing, guest = viewer]

mutation book(listing: listings, firstDay: int, lastDay: int):
  require firstDay < lastDay else BAD_DATES
  property = listings[listing] ! else NOT_FOUND
  booking = insert bookings { listing, guest: viewer, host: property.host, firstDay, lastDay }
  for day in range(firstDay, lastDay):
    insert nights { listing, day, booking: booking.id }
  return booking
```

`firstDay` and `lastDay` are calendar-day numbers in the app's chosen calendar;
the last day is excluded. A second guest reserving an occupied night gets
`TAKEN`, and the entire mutation rolls back, including any earlier free nights.
The normal write and work meters bound the loop; exceeding them also rolls
back the mutation. This example only books nights; cancellation must release
its nights in the same transaction as cancelling the booking.

The availability table is deliberately public: a named unique refusal applies
only when the clashing row is readable. A hidden collision stays `E_RULE`,
even with `else TAKEN`. Use this example only if occupied dates and booking
references may be public. Private booking details keep their own read rule.
If the product instead permits readable availability checks, an `exists` or
`count` domain over that public availability table has a uniformly readable
audience. Pinning a private guest merely narrows the check; it cannot enforce
a constraint across all guests.

## Server-arrival order within a conversation

`at` has millisecond ties; client-minted ids order creation, not arrival at
the server. Keep a per-conversation ordinal in the same mutation as the
message insert. Transactions serialize the increment, so committed ordinals
order accepted writes within that conversation; they do not order groups.

```quarry
table conversations:
  lastOrdinal: int default 0
  creator: principal
  public 'shared conversation counters'
  insert <- .creator = viewer
  update <- exists members[.id, viewer]
  online only

table members:
  conversationId: conversations
  principal: principal
  unique conversationId, principal
  public 'shared conversation membership'
  insert <- exists conversations[id = .conversationId, creator = viewer]
  online only

table messages:
  conversationId: conversations
  ordinal: int
  body: text <=200
  at: time
  immutable conversationId, ordinal
  public 'shared message history'
  insert <- exists conversations[id = .conversationId, lastOrdinal = .ordinal]
  online only

mutation createConversation():
  c = insert conversations { creator: viewer }
  insert members { conversationId: c.id, principal: viewer }
  return c

mutation addMember(conversationId: conversations, principal: principal):
  insert members { conversationId, principal } if absent

mutation send(conversationId: conversations, body: text <=200):
  conversation = conversations[conversationId] ! else NOT_FOUND
  ordinal = conversation.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  insert messages { conversationId, ordinal, body, at: now }

query history(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId after c last 50 by .ordinal
```

Pass the returned `next` as `c` to page newest first by ordinal. Reusing the
mutation id on retry neither increments again nor inserts twice. This short
shared-history example is online-only and only members can advance its counter;
private conversations also need membership read rules. If you sync and predict it, a local ordinal is provisional until the
server commits and reconciles concurrent sends.

"##;
