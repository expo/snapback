//! Writes and server-arrival ordering.
pub(super) const CARD: &str = r##"# Writes

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

For replay adapters and retry-safe intents, pass a `mintId()` you stored with
the intent or fixture; arbitrary fixture strings still need an application ledger.
Pass it as `{ id }`; a retry returns the original outcome and never applies twice:
`client.mutate(api.send, args, { id })`. The id must have the `mintId()` form:
26 uppercase Crockford base32 digits (0123456789ABCDEFGHJKMNPQRSTVWXYZ), with
the first digit 0–7; malformed ids return local `failed` with `E_WRITE_ID`.
Mint once and keep the id with the intent. It identifies the write, not a row;
prediction still mints separate row ids through `new_ids`.
A retry of a pending write on the same client returns the same Write object;
a settled retry returns its retained receipt, without historical result values.
Online, web and native clients share this rule; a recovered queued write is
reused before prediction or admission. Already-open owners of one device store
compare and admit under its transaction: equal input reuses the original entry
and row ids, and conflicting input changes nothing, even during a send. `client.write(id)` and
`usePendingWrite(op, id)` observe that same id.

Reusing an id with different operation names or JSON arguments returns local
`E_WRITE_ID_REUSE` while the client knows the input: unresolved submissions,
its last 256 terminal input identities, or its recovered outbox. Object key
order does not matter. This refusal does not replace the original write or emit
a terminal event for it. A receipt recovered after reopen holds no arguments,
so it returns the original outcome without comparing inputs. When neither
outbox nor receipt knows an id, the request reaches the server: its record is
keyed by principal and mutation id, and an existing record wins even if the
operation or arguments differ. Use a new id for a new intent. A client remembers
used ids for its lifetime (ids only after the bounded input/receipt window);
if a known id has lost its receipt and left the outbox, it refuses
`E_WRITE_RECEIPT_EXPIRED` instead of admitting it again. Reopen to recover that
outcome through the server. The server guarantee belongs to that backend store.
For a caller-supplied id with no local outcome, a prediction or validation refusal
queues the write without a row so the server can answer from its replay record.
The journal preserves this replay eligibility through navigation. If the server
has no record, it executes or refuses the write against its current state.
Separate live web tabs have separate outboxes; the server deduplicates their
requests under the same principal and id. Different principals may use the same
id independently.

Writes that do not predict show pending with `usePendingWrite(op)` from
`snapback4/react`: `run(args)` submits, `pending` covers submission through
terminal `sent` or `failed`, and `last` is the Write. Keep its mutation id in
view state; `usePendingWrite(op, savedId)` resumes observation after reload
without submitting again. `client.write(id)` reads the kept outcome (undefined
for an unknown id or an evicted id that has left the outbox); `onWrite` reports
later terminal changes. The online client retains at most 256 terminal outcomes
in memory. The local client reads the device's one atomic window of the last
256 server terminal receipts and its current outbox directly, so another native
owner's settlement cannot leave a stale pending outcome. Reads and repeated
flushes do not refresh the window. Queued terminal writes emit at most once
per client: their event ids stay remembered until the outbox entry leaves.
Local receipts survive reopen; adopting a
closed web tab fills only spare capacity, with destination receipts newest and
winning id collisions. Recovered success carries `replayed: true`
and no result; recovered failure keeps code/family and `write refused: CODE`.
Refusals before durable admission, the online tier and mock remember outcomes
for their client lifetime only, up to 256 terminal outcomes.

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

`upsert` set-state writes (likes, reactions and votes) predict updates of
rows the device holds. A missing row predicts an insert only when its synced
group is held with no horizon, both the key and the materialized insert image
prove readability, and the device holds every row that can collide on a
secondary unique index or count toward an affected cap. Defaults are part of
that image. Otherwise it queues without a predicted row, including in a left
group. See `guide prediction` for the conditions and a set-membership recipe.

For `after insert <- exists t[key]`, a local hit satisfies the postcondition.
A local miss predicts `E_CONSTRAINT` only when the key proves readability
and its synced group is fully held without a horizon. Otherwise either an
ordinary insert or an upsert queues without a predicted row; the server
decides the postcondition when the write arrives.

Defaults fill missing insert columns on the writing host, including the insert
branch of `upsert`; updates and existing-row upserts never reapply defaults.
`upsert` inserts or patches: on an existing row, unnamed columns keep their
values. An incomplete insert patch answers `NOT_FOUND`. An explicit null
clears an optional column. Omitted asset columns keep their placement; an explicit
asset id on a row you cannot read must be your own upload, even if it equals the
retained id. The update
rule runs before asset diagnostics. Conditional `if` sees old only inside
the engine; neither old nor the merged image is a program binding.

For update/upsert, "readable" means the read rule admits the old row in the
pre-write state, before the patch or any of its effects. The engine resolves
id and unique-key targets privately; the update rule judges old and next.

| Target before the write | Refusal details |
| --- | --- |
| Readable | `E_RULE`; `E_CONFLICT` with a read-rule `current`; named `E_CONSTRAINT`; `E_INPUT` |
| Unreadable or absent | `NOT_FOUND` for rule denial, an `update` condition, secondary unique clash, or an incomplete insert patch; no row, index, column or branch detail |

A hidden collision on ordinary insert or `insert ... if absent` stays
`E_RULE`; a readable collision names its index (if-absent returns null).
An update or upsert-patch colliding with a different hidden row returns generic
`E_RULE` when its target is readable and `NOT_FOUND` when its target is unreadable.
Use `upsert counters[recipient] { count: 1 }` under an `update` rule to
write another principal's row. Success discloses the admitted row's existence
and the update rule predicates. It grants no extra stream or snapshot row.
A condition belongs on `update`; an upsert inserts or patches. A condition
needs a row you can read; a blind patch needs none. On a row you cannot read,
immutable columns in a patch are ignored. A readable immutable mismatch still
names the column. Before target lookup, the engine reserves room for the rule
probes and the largest merged image allowed by the schema and supplied patch;
if it cannot fit, `E_BOUND` refuses equally for a hidden or absent target.


The table names are the language card's. A final write is the implicit
return; bind one to use its row (`row = insert ..`). Writes check the rule,
then unique indexes, caps, immutable columns, text formats and `after
insert` postconditions; any refusal rolls the whole mutation back, and a
maintained aggregate is written through its source rows. Every written row
fans out to its partitions (guide sync). A mutation applies at most once
per client-minted id and principal. Valued updates/upserts and conflict
`current` are ordinary read-rule gets (null or withheld when hidden), evaluated
at the read's state; a write that grants read authority may return its row.
The recorded body is the replay body, with value-free diagnostic messages
and no `result` or `current`. Retries return only
execution identity (`sent`/`failed`, `seq`/`why`, `replayed`), withholding
historical `result` and `current`, including scalar results after a lost reply.
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
With an exclusive Web Lock, the web device records the mutation id, operation,
arguments and minted row ids synchronously in localStorage, in call order,
before `mutate` returns its promise. Same-origin navigation can therefore leave before IndexedDB admission
commits: the next client admits those records before new writes, then sends
through the ordinary outbox with the original ids. A closed tab's records are
adopted by the next device that opens the store, under the outbox's Web Lock.
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
device store; a serialized record over 64 KiB is not journaled. Unavailable,
throwing or full localStorage, missing Web Locks, an unidentified backend store,
exceeded journal limits, or browser storage clearing leave unawaited navigation
best-effort: that write can still be lost before IndexedDB commits. A destination must open
a client to recover a record that never reached the outbox; keepalive remains
best-effort and sends only admitted writes.
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
A reference column checks the id's shape, not that
its target exists: when a mutation needs a visible target, guard first —
`require exists prompts[promptId] else PROMPT_NOT_FOUND` — a metered point
read that is false for an absent or hidden row; deleting a target neither
deletes nor refuses the rows that reference it, so a lifecycle is the
application's, in its mutations and rules.

## Server-arrival order within a conversation

`at` has millisecond ties; client-minted ids order creation, not arrival at
the server. Keep a per-conversation ordinal in the same mutation as the
message insert. Transactions serialize the increment, so committed ordinals
order accepted writes within that conversation; they do not order groups.

```quarry
table conversations:
  lastOrdinal: int default 0
  public 'shared conversation counters'
  insert <- allow
  update <- allow
  online only

table messages:
  conversationId: conversations
  ordinal: int
  body: text <=200
  at: time
  by byConversationOrdinal: conversationId, ordinal, id
  immutable conversationId, ordinal
  public 'shared message history'
  insert <- allow
  online only

mutation createConversation():
  insert conversations {}

mutation send(conversationId: conversations, body: text <=200):
  conversation = conversations[conversationId] ! else NOT_FOUND
  ordinal = conversation.lastOrdinal + 1
  upsert conversations[conversationId] { lastOrdinal: ordinal }
  insert messages { conversationId, ordinal, body, at: now }

query history(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 by byConversationOrdinal
```

Pass the returned `next` as `c` to page newest first by ordinal. Reusing the
mutation id on retry neither increments again nor inserts twice. This short
shared-history example is online-only; private conversations need membership
rules. If you sync and predict it, a local ordinal is provisional until the
server commits and reconciles concurrent sends.
"##;
