# Sequences: receipt gaps in expiring messages

Use `sequence by` for server-assigned conversation positions and bounded unique
ordinal probes for receipt gaps in expiring messages. A row-keyed count answers
what this member missed.

```quarry
table conversations:
  creator: principal
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  online only
table members:
  conversationId: conversations
  principal: principal
  joinedAt: sequence by conversationId
  deliveredOrdinal: int default 0
  unique conversationId, principal
  cap 50 by conversationId
  read <- .principal = viewer
  insert <- created conversations[id = .conversationId, creator = viewer]
  update <- .principal = viewer
  online only
table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  sender: principal
  expiresAt: time ?
  unique conversationId, ordinal
  immutable sender, expiresAt
  read <- exists members[.conversationId, viewer]
  insert <- .sender = viewer and exists members[.conversationId, viewer]
  expire at .expiresAt
  online only
table runs:
  conversationId: conversations
  principal: principal
  fromOrdinal: int
  throughOrdinal: int
  unique conversationId, principal, fromOrdinal
  cap 64 by conversationId, principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists members[.conversationId, viewer]
  delete <- .principal = viewer
  online only

view missed: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.deliveredOrdinal
    and .ordinal > m.joinedAt and .sender != m.principal

mutation createConversation():
  chat = insert conversations { creator: viewer }
  insert members { conversationId: chat.id, principal: viewer }
  return chat
mutation send(conversationId: conversations, expiresAt: time ?):
  return insert messages { conversationId, sender: viewer, expiresAt }

fn skipExpired_messages(scope: conversations, initialPrefix: int, low: int):
  prefix = initialPrefix
  for i in range(0, 1024):
    if prefix + 1 >= low:
      break
    if exists messages[conversationId = scope, ordinal = prefix + 1]:
      break
    prefix = prefix + 1
  return prefix

mutation skipExpiredBefore(next: messages):
  message = messages[next] ! else NOT_FOUND
  me = members[message.conversationId, viewer] ! else NOT_MEMBER
  prefix = max(me.deliveredOrdinal, me.joinedAt)
  prefix = skipExpired_messages(message.conversationId, prefix, message.ordinal)
  if prefix > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: prefix }
  return prefix
mutation delivered(conversationId: conversations, from: int, through: int):
  me = members[conversationId, viewer] ! else NOT_MEMBER
  anchor = messages[conversationId = conversationId, ordinal = through] ! else NOT_FOUND
  require 0 < from and from <= through else NOT_A_RUN
  prefix = max(me.deliveredOrdinal, me.joinedAt)
  if through <= prefix:
    return prefix
  low = from
  high = through
  for run in runs where .conversationId = conversationId and .principal = viewer and .fromOrdinal <= through + 1 and .throughOrdinal + 1 >= from:
    low = min(low, run.fromOrdinal)
    high = max(high, run.throughOrdinal)
    delete runs[run]
  prefix = skipExpired_messages(conversationId, prefix, low)
  if low <= prefix + 1:
    prefix = max(prefix, high)
  else:
    require count(runs where .conversationId = conversationId and .principal = viewer) < 64 else TOO_MANY_RUNS
    insert runs { conversationId, principal: viewer, fromOrdinal: low, throughOrdinal: high }
  if prefix > me.deliveredOrdinal:
    update members[me] { deliveredOrdinal: prefix }
  return prefix
query whatDidIMiss(member: members):
  return missed[member]
```

## Receipt-gap progress

E_STRUCTURAL_FANOUT refuses a mutation page over expiring messages, even
`first 1`: an expiry backlog can make that page walk unboundedly many rows.
Unique probes name individual positions.

`skipExpiredBefore` crosses absent positions before a readable live message;
it acknowledges no live message.
The helper's prefix justifies advancing a receipt only after the caller's own authority check (the membership check or this card's readable-message anchor).
Uniformity alone proves one read verdict for the conversation, which can be false.

Use the `delivered` mutation above to integrate the helper into `guide receipts`'
run merge: remove the early return for a run already covered by `held`, retaining
only `if through <= prefix`. Merge and delete the overlapping saved runs, run
the helper, then either join the merged run to the prefix or reinsert it and
save partial prefix progress. Keep disjoint runs until they meet the prefix.
For `[1027,1027]` with initial prefix 0 and only holes before it, the first call
saves prefix 1024 and that run; a second call with the same receipt reaches the
helper again and joins the run at 1027. Submit that second call as a new mutation
invocation: reusing an at-most-once mutation id replays its original result.

The loop stops at the first live message or after 1,024 probes. Keep the
returned prefix and resume later if a longer gap remains; the ordinary work
meter can still refuse the transaction. Ordinals alone do not prove delivery. `sequence by` is dense across all participating columns:
membership joins also take positions, and deleted or expired rows leave holes.
Use settled positions for receipt acknowledgement; predicted ordinals can move.

The row-keyed count answers the badge question without one application probe
per position. It excludes expired messages even before their physical sweep.
It does not prove a received run or replace the receipt merge. For an unread
badge, use the member's read position instead of `deliveredOrdinal`; see
`guide maintains` for tombstones, private member fields and offline count coverage.

Manual allocation requires every writer to update the conversation on send.
This public example isolates allocation; private apps need the membership rules:

```quarry
table conversations:
  creator: principal
  lastOrdinal: int default 0
  public
  update <- .creator = viewer
  online only
table messages:
  conversationId: conversations
  ordinal: int
  sender: principal
  expiresAt: time ?
  unique conversationId, ordinal
  immutable conversationId, ordinal, expiresAt
  public
  insert <- .sender = viewer
  expire at .expiresAt
  online only
mutation manualSend(conversationId: conversations, expiresAt: time ?):
  chat = conversations[conversationId] ! else NOT_FOUND
  ordinal = chat.lastOrdinal + 1
  update conversations[chat] { lastOrdinal: ordinal }
  return insert messages { conversationId, ordinal, sender: viewer, expiresAt }
```

`sequence by` replaces manual allocation and refuses supplied or patched ordinals.
It does not make the probe loop constant cost. Do not change an existing
populated integer column into a sequence casually: `check --store` assesses
adoption, and a sequence change requires an empty table. Use this schema for
a new conversation model, or preserve the existing allocator while adopting
the probe recipe.
