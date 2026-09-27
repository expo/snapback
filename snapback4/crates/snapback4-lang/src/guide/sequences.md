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
query whatDidIMiss(member: members):
  return missed[member]
```

## Receipt-gap progress

Use `ordinal: sequence by conversationId` and `unique conversationId, ordinal`.
The engine assigns positions; bounded unique ordinal probes skip expired holes.
E_STRUCTURAL_FANOUT refuses a mutation page over expiring messages, even
`first 1`: an expiry backlog can make that page walk unboundedly many rows.
A unique probe names one position instead of scanning the expiring population.

This standalone recipe advances only across absent positions before a known
live message. It does not acknowledge that message or any other live message.
Use the helper inside `guide receipts`' delivered-run merge; keep disjoint runs
until they meet the prefix. The member must be authorized to read every message
in the conversation, so a hidden message cannot be mistaken for an expired hole.

The loop stops at the first live message or after 1,024 probes. Keep the
returned prefix and resume later if a longer gap remains; the ordinary work
meter can still refuse the transaction. Never infer delivery from a positive
ordinal alone. `sequence by` is dense across all participating columns:
membership joins also take positions, and deleted or expired rows leave holes.
Use settled positions for receipt acknowledgement; predicted ordinals can move.

The row-keyed count answers the badge question without one application probe
per position. It excludes expired messages even before their physical sweep.
It does not prove a received run or replace the receipt merge. For an unread
badge, use the member's read position instead of `deliveredOrdinal`; see
`guide maintains` for tombstones, private member fields and offline count coverage.

The older manual allocator compiles too, but needs a conversation update on
every send and every writer must obey it. This public example isolates the
allocation difference; retain the membership rules above in a private app:

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

The bounded probe loop is already the paved receipt-gap form; `sequence by`
removes this manual allocation and refuses supplied or patched ordinals.
It does not make the probe loop constant cost. Do not change an existing
populated integer column into a sequence casually: `check --store` assesses
adoption, and a sequence change requires an empty table. Use this schema for
a new conversation model, or preserve the existing allocator while adopting
the probe recipe.
