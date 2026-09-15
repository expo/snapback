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

`upsert` set-state writes (likes, reactions and votes) predict only updates of
rows the device holds; a missing row queues without a prediction. See
`guide prediction` for a predictable insert/delete set-membership recipe.

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
hidden sends only the oldest unconfirmed write with keepalive when no ordinary
send is in flight. A blocked or oversized head is never skipped; clients share
the browser's 64 KiB body budget. Unsent/unconfirmed writes stay durable for retry on reopen with
the same mutation id, so replay cannot apply a write twice.
A missing `upsert` predicts its insert when the synced group has no horizon
and the key proves readability (public rows, or a viewer-keyed rule); otherwise
a device write-target miss queues without a predicted row and still sends `/m`.
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
