//! Writes and server-arrival ordering.
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

If `messageId` in `writeForms` addresses retained history from a room the
writer has left, the call still predicts. Reads hide the updated message
because current membership is absent, while readable inserts remain visible.
Unknown reaction authority also hides that provisional reaction.
See `guide prediction` for authorization on each device read.

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
An online `createApp` journal separately preserves ids retired after a store
change, including sent ids displaced to make room for retirement receipts,
so reopening cannot replay those writes on the replacement store:
evicted bodies return `E_WRITE_RECEIPT_EXPIRED` without dispatch. It keeps up to
4,096 compact retirement ids; saturation durably blocks new admissions until
the application reconciles prior outcomes and explicitly replaces that journal,
rather than forgetting ids automatically. Already-admitted intents remain
recoverable as pending while their outcomes are unresolved.
Online intent records its dispatch store before transmission. A failed receipt
save preserves the known terminal outcome for mutate, lookup and notification;
reopening may resend that intent only to the acknowledging store, whose replay
record prevents double execution. Persisted terminal receipts are not reposted.
A replacement retires old-store intent with an unknown-outcome refusal; an old
unbound intent may replay only to the first store its journal has seen.
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
An expiring cap counts unswept physical rows, which live snapshots omit.
Occupancy-increasing writes queue without predicted rows and settle on the
server even after full acquisition; updates within a cap group can still predict.
Replacing an expired same-id row also queues: the server may have swept it and
refilled the cap before sync reaches the device. A held live row can still
support an update within its cap group.

NOT_FOUND means a point write has no target, or a write to an unreadable target
was refused without disclosing its existence. It is also the conventional
application code for `row ! else NOT_FOUND`. Check a readable target and retry;
do not infer absence from a refused blind write.

An alternate-key delete of a missing row refuses `NOT_FOUND` locally when the
synced group proves absence; otherwise it queues for server resolution.

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

E_INPUT means an argument or row value does not fit its declared type.
Correct the named field or its declaration. A typed reference checks the id's
shape; use `require exists t[id] else CODE` to require a visible target.

E_CONFLICT means a conditional update found that the row changed.
The refusal carries the current row only when its read rule admits the viewer.
Read it and retry with a fresh edit.

E_QUARRY_WRITE_TESTS means a write target includes tests beyond its unique
key. For a readable row, write `require exists members[org, viewer, role =
'admin'] else NOT_ADMIN`, then `update members[org, viewer] { role: 'member' }`.
Choose the refusal code for your application. This explicit check refuses a
hidden or missing row and grants no write authority; the compiler does not
insert it automatically.

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
Delete targets and insert/if-absent collision lookups also reserve authorization
before resolving a row, including expired rows. The allowance covers the read
rule's worst case, including probes that could short-circuit; execution still
charges the rule work once.


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
device store; a serialized record over 64 KiB is not journaled. Unavailable,
throwing or full localStorage, an unidentified backend store,
exceeded journal limits, or browser storage clearing leave unawaited navigation
best-effort: that write can still be lost before IndexedDB commits. A destination must open
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
A reference column checks the id's shape, not that
its target exists: when a mutation needs a visible target, guard first —
`require exists prompts[promptId] else PROMPT_NOT_FOUND` — a metered point
read that is false for an absent or hidden row; deleting a target neither
deletes nor refuses the rows that reference it, so a lifecycle is the
application's, in its mutations and rules.

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
the server. Declare an engine sequence. A client-supplied integer can pin
the history forever by writing the largest value; `sequence by` refuses
such values with E_SEQUENCE_SUPPLIED, including on updates and upserts.

```quarry
table conversations:
  creator: principal
  public 'shared conversation'
  insert <- .creator = viewer
  online only

table members:
  conversationId: conversations
  principal: principal
  joinedAt: sequence by conversationId
  unique conversationId, principal
  public 'shared conversation membership'
  insert <- exists conversations[id = .conversationId, creator = viewer]
  online only

table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  body: text <=200
  public 'shared message history'
  insert <- exists members[.conversationId, viewer]
  online only

mutation createConversation():
  c = insert conversations { creator: viewer }
  insert members { conversationId: c.id, principal: viewer }
  return c

mutation addMember(conversationId: conversations, principal: principal):
  insert members { conversationId, principal } if absent

mutation send(conversationId: conversations, body: text <=200):
  return insert messages { conversationId, body }

query history(conversationId: conversations, c: cursor ?):
  return messages where .conversationId = conversationId after c last 50 by .ordinal
```

Clique's `messages.ordinal` and `members.joinedAt` draw from one counter
per conversation, starting at 1. Allocation is dense across the participating
columns, rather than within messages alone: membership insertion takes the
next position too. Each successful insertion takes a position; deletion does
not reuse it. A rolled-back transaction, an `if absent` no-op, or retry of the
same write id consumes no position. An `if absent` retry on a unique key without
a sequence column still returns null at counter exhaustion. Bulk seeds capture
engine-assigned ordinals in maintained reference paths even when the referring
row comes first. Different conversations have independent counters. Multiple
sequence columns in one inserted row allocate in column-name
order. Sequence inserts require read authority established independently of
the assigned ordinal. A blind or insert-only principal whose new row is
unreadable gets generic E_RULE (NOT_FOUND for an upsert insert arm). An
independent insert denial runs before hidden read-witness lookups; a deferred
allocation denial normalizes its authorization work, including at meter
boundaries. A read rule that depends on the ordinal cannot authorize insertion.
For a self-readable candidate, a sequence-key upsert returns the same NOT_FOUND
and logical meters whether the target is absent or unreadable and refused;
an owned target keeps its ordinary update diagnostic. A directly supplied
ordinal in an insert or patch is E_SEQUENCE_SUPPLIED before lookup.
A successful readable insert exposes its assigned ordinal, which reflects the
shared counter. A hidden grant may establish read authority and permit success;
an independently denied insert cannot use it as a witness oracle.
`nextExpiry` is the earliest instant at which removing every row expiring then
changes the complete bound rule's current verdict, considering all matching
witness alternatives within the rule's allowance.
A later matching grant, permanent ownership or a correlated `A or not A`
branch prevents an irrelevant earlier deadline; denied rows publish none.


Two limits are accepted: (a) a cap group containing an unreadable occupant returns
generic E_RULE before cap constraint text. Compared with an empty group, this
can disclose “someone unreadable is here”, but no occupant identity, ordinal,
count or values. Ignoring those occupants would let a caller bypass the cap.
One request's authorization work shares a single 8,192-row physical allowance,
including nested witnesses, expired rows and maintained-source walks, and
exhaustion fails closed with generic E_RULE without hidden-dependent logical
charges.
(b) A caller's row behind at least the separate 8,192-candidate walk bound
of unreadable siblings is unreachable by paging in that direction. The page
is empty with no cursor, identically in every world beyond that bound.
The generated harness compares hidden siblings, witnesses and counter history
across refusals, logical meters, expiry deadlines, pages/cursors, sync images and watermarks, and
device prediction, admission, reopened outboxes and settlement. It separately
checks successful assignments and these limits; it does not promise identical
outcomes when the caller's actual authority changes. Authorization-dependent
scans prepay a fixed logical allowance from their schema and requested page size before examining occupants. This applies to cap
checks on insertion and upsert, unique collisions, counter reads, rule witnesses,
and pages with simple or compound read rules. Every effect prepays its whole
rule before its first witness, so short-circuiting compound write rules cannot
change the caller's probe allowance or budget refusal. Within the walk bound,
hidden candidates cannot change logical meters, budget refusals, returned rows or cursors by changing their
payload or position. For `first 1 by .ordinal` and `last 1 by .ordinal`, a denied
sibling before or after the readable row adds no examined charge or visible cut.
The same page protection applies to ordinary integer columns. Private scans
prepay their allowance once per page and share the request's physical walk ceiling, also during word discovery; the logical meter does not expose
how many denied candidates were traversed. A device still queues if its separate
prediction work allowance is exhausted. `check --json` includes the same sequence-counter
descriptions as text `check` under `sequences`.
Ordinals and their parent reference are immutable; listing the ordinal
in `immutable` is accepted and redundant.

`first N by .ordinal` and `last N by .ordinal` give a total order within a
conversation. Pass the returned `next` cursor to continue as for any int column.
These public, online-only examples use membership to authorize writes;
private chats also need membership read rules and their sync declarations.
A predicted insert in a synced table takes a provisional value above every
held value for that parent, including other pending inserts. Its row carries
`pending: true`; the Write remains `pending` until the server settles it.
The settled image replaces the provisional ordinal and reorders local pages.
Two offline inserts keep their outbox order when they reach the server.
If no provisional value fits above the device's held integers, the write queues
without prediction; the server decides whether its counter has room.
A refusal after actually reading a provisional ordinal also queues without a
predicted row, including a rule, `require`, `check`, unique constraint or
`after insert` postcondition: the server's assigned value may satisfy it.
An indexed read consumes provisional ordinals when settlement could move a
pending row into or out of the selected range, including an empty result,
an upsert's sequence-key target, or an `after insert` lookup at a literal
ordinal. These dependent refusals keep their intent in the durable outbox
until the server accepts or refuses it.
A unique lookup that finds no collision, or a cap that passes, does not make
an unrelated later refusal provisional. A short-circuited rule arm does not
read its ordinal. Provisional ordinals in
write results, point rereads and pages carry `pending: true`.

## Write authority

`old` in a rule and the conditional update's `if` are evaluated inside the
engine. An update/upsert result and conflict `current` are read-rule gets,
never the merged patch image: null or withheld when hidden at that read.
A patch can grant read authority and then return its row. Omitted asset columns
keep their placement. An explicit asset id on a row you cannot read must be your
own upload, even if it equals the retained id. Update authority is checked
before asset diagnostics. A readable aggregate view is an explicit delta read channel;
`N_MAINTAIN_DELTA` notes potentially wider source update authority.
A missing `upsert` predicts its insert when the synced group is held with no
horizon, both the key and the materialized insert image prove readability,
and the viewer-readable partition covers every secondary unique lookup and
affected cap group. The image includes key columns, patch and defaults; a
whole-table cap needs the whole public table. Left groups and unproved
conditions queue without a predicted row and still send `/m` (guide prediction).
`check` calls an upsert with an unprovable insert arm `predicts: updates only`,
and lists that arm in its summary with the first failing horizon, rule or cap
coverage proof. `insert ... if absent` reports the same insert limitation.
An id supplied to `insert ... if absent`, including a parameter or helper result,
needs the `byId` absence proof too. Only an id minted by `new` during the call
(including an omitted id) can use a covered secondary unique key instead.
`check` preserves a local's `new` fact across unrelated requires, reads, emits
and writes. A direct assignment tracks the local's new value; a branch or loop
that may assign it discards its fact. Other locals keep their mint facts.
Membership-scoped reactions with `last 500` cannot prove absence outside that
window; removing it still leaves `(messageId, principal)` unable to decide
`exists members[.conversationId, viewer]`. A viewer-keyed read rule with no
horizon and caps grouped by that viewer predicts a first write but shows only
the viewer's own reactions. Full public sync covers a per-message cap but
makes every reaction public. Membership reads can predict without a horizon
when every unique key and cap group includes `conversationId` and the device
holds the deciding membership row; that acquires all reactions in the held
conversation. None of these means complete children of just the held messages.
If no shape fits the product, this write queues until the server answers;
show its pending state using the returned write's `state` and `client.onWrite`
(guide writes). Changing `upsert` to an existence branch does not supply absence
or cap coverage.
The at-most-once record stores the replay body, with value-free diagnostic
messages and no `result` or `current`. Replay returns
execution identity only, with `replayed: true`; historical `result` and
`current` are withheld, including after revocation or a dropped response.
The same operation id under another principal has no access to that receipt.
`delete` keeps its own existing rule and behavior."##;
